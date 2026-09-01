---
title: 'Аварийное восстановление etcd-кластера Kubernetes'
description: 'Аварийное восстановление etcd-кластера'
pubDate: '2026-06-22'
tags: ['linux', 'DevOps', 'sobes', 'etcd', 'k8s','kubernetes']
heroImage: ''
---


# Аварийное восстановление etcd-кластера Kubernetes

---

## 1. Первоочередная диагностика (Triage) — 4 команды по SSH

Предполагаем, что etcd запущен как static pod (стандарт kubeadm). Сертификаты лежат в `/etc/kubernetes/pki/etcd/`. Задаём алиас, чтобы не повторять флаги:

```bash
# На каждой master-ноде (начинаем с master-2, где ошибки наиболее явные):

# ① Жив ли контейнер etcd и в каком статусе?
crictl ps -a --name etcd
# (или `docker ps -a | grep etcd` на старых кластерах)

# ② Здоровье эндпоинтов и размер БД — самая информативная команда
ETCDCTL_API=3 etcdctl \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --endpoints=https://127.0.0.1:2379 \
  endpoint status --cluster -w table

# ③ Кто сейчас в member list и каково состояние каждого члена?
ETCDCTL_API=3 etcdctl \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --endpoints=https://127.0.0.1:2379 \
  member list -w table

# ④ Дисковое пространство — критично при "database space exceeded"
df -h /var/lib/etcd && du -sh /var/lib/etcd/member/snap/db
```

**Что мы ищем в выводе:**

| Команда | На что смотрим |
|---|---|
| ① `crictl ps` | Статус `Running` / `Exited`, количество рестартов |
| ② `endpoint status` | Колонки `DB SIZE`, `IS LEARNER`, `RAFT INDEX`, активные alarm'ы |
| ③ `member list` | Все ли 3 члена `started`, нет ли `unstarted` / дубликатов |
| ④ `df / du` | `db` файл > 2 ГБ = упираемся в дефолтную квоту; `df` > 90% = кончается диск |

---

## 2. Анализ симптомов — почему кластер мёртв

### Корневая причина: `database space exceeded`

etcd по умолчанию имеет **квоту backend = 2 ГБ** (`--quota-backend-bytes=2147483648`). Когда файл `/var/lib/etcd/member/snap/db` достигает этого предела, происходит следующее:

```
                    ┌─────────────────────────────────────┐
                    │  etcd активирует alarm NOSPACE      │
                    │  → кластер переходит в READ-ONLY    │
                    └──────────┬──────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
   Лидер не может       Followers не       Новые записи
   записать heartbeat   получают репли-    (в т.ч. lease,
   в Raft-лог           кацию              watch) отклоняются
              │                │                │
              ▼                ▼                ▼
   Followers считают    Каждые 5-10 сек    kube-apiserver
   лидера мёртвым       новые выборы       получает 503
              │                │                │
              └────────┬───────┘                │
                       ▼                        ▼
              "leader changed"          "context deadline
               в цикле                   exceeded"
```

### Почему master-1 не возвращается после перезагрузки

1. **NOSPACE блокирует любую запись.** При старте etcd на master-1 должен синхронизировать Raft-лог с лидером. Но лидер не может записать *ни одной* новой записи (включая записи о синхронизации), потому что alarm NOSPACE активен на master-2/3.

2. **Snapshot transfer невозможен.** Если master-1 сильно отстал, лидер должен отправить ему snapshot. Но snapshot — это тоже операция, требующая записи в Raft-лог (для фиксации факта отправки). Лог заблокирован → snapshot не уходит → master-1 висит в `unstarted` или циклически рестартует.

3. **Возможное повреждение WAL.** Если перезагрузка master-1 была нечистой (hard reset), его WAL-файлы (`/var/lib/etcd/member/wal/`) могут быть повреждены. etcd при старте не может прочитать собственный лог → crash loop.

### Почему master-2 и master-3 не выбирают стабильного лидера

Это **замкнутый круг Raft при NOSPACE**:

- Кандидат выигрывает выборы → становится лидером → пытается записать `noop`-запись в Raft-лог (обязательный шаг по Raft-протоколу для подтверждения лидерства) → **запись отклонена** (NOSPACE) → лидерство не подтверждено → через election timeout (1–5 сек) начинается новый раунд выборов.
- `leader changed каждые 5-10 секунд` — это прямое следствие: выборы проходят, но лидерство не удерживается.

---

## 3. План восстановления (Disaster Recovery)

### Фаза 0: Подготовка и фиксация состояния

```bash
# На ВСЕХ master-нодах — сохранить текущее состояние для постмортема
mkdir -p /root/etcd-recovery-$(date +%F)
cp -a /var/lib/etcd /root/etcd-recovery-$(date +%F)/etcd-backup-$(hostname)
journalctl -u kubelet --since "2 hours ago" > /root/etcd-recovery-$(date +%F)/kubelet.log
```

### Фаза 1: Снять блокировку NOSPACE (увеличение квоты)

Это **наименее деструктивный** путь. Проблема в квоте, а не в реальном диске (проверили в triage).

**На master-2** (нода с наиболее актуальными данными, судя по Raft index):

```bash
# 1. Отредактировать static pod manifest
vi /etc/kubernetes/manifests/etcd.yaml

# 2. В секции spec.containers[0].command добавить/изменить флаг:
#    --quota-backend-bytes=8589934592    (8 ГБ вместо дефолтных 2 ГБ)

# 3. kubelet автоматически обнаружит изменение и перезапустит pod.
#    Ждём ~30 секунд, проверяем:
crictl ps --name etcd
```

**Повторить на master-3** (и master-1, если он доступен).

> ⚠️ **Важно:** kubelet перезапустит etcd-контейнер автоматически при изменении manifest-файла. Не нужно трогать `systemctl` или `crictl stop`.

### Фаза 2: Снять alarm и вернуть записываемость

```bash
# На master-2 (после перезапуска с новой квотой):
export ETCDCTL_API=3
export ETCDCTL_CERT=/etc/kubernetes/pki/etcd/server.crt
export ETCDCTL_KEY=/etc/kubernetes/pki/etcd/server.key
export ETCDCTL_CACERT=/etc/kubernetes/pki/etcd/ca.crt
export ETCDCTL_ENDPOINTS=https://127.0.0.1:2379

# Снять все alarm'ы
etcdctl alarm disarm

# Проверить, что alarm'ов больше нет
etcdctl alarm list
# (должен быть пустой вывод)

# Проверить здоровье кластера
etcdctl endpoint health --cluster
```

Если `endpoint health` показывает `healthy` на 2 из 3 нод — **кворум восстановлен**, переходим к очистке.

### Фаза 3: Очистка БД (compact + defrag)

```bash
# Получить текущую ревизию
REV=$(etcdctl endpoint status --write-out=json \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['Status']['header']['revision'])")

# Сжать историю до текущей ревизии (освобождает место в B+tree)
etcdctl compact $REV

# Дефрагментация на ВСЕХ членах (возвращает место файловой системе)
etcdctl defrag --cluster
# Ожидание: ~1-5 мин на член в зависимости от размера БД

# Проверить, что DB SIZE уменьшился
etcdctl endpoint status --cluster -w table
```

### Фаза 4: Вернуть master-1 в кластер

**Сценарий А — master-1 жив, но не синхронизирован:**

```bash
# На master-1: убедиться, что manifest тоже обновлён с новой квотой
# Затем просто перезапустить etcd:
mv /etc/kubernetes/manifests/etcd.yaml /tmp/etcd.yaml
sleep 10
mv /tmp/etcd.yaml /etc/kubernetes/manifests/etcd.yaml

# Проверить с master-2:
etcdctl member list -w table
etcdctl endpoint health --cluster
```

**Сценарий Б — master-1 повреждён и не стартует:**

```bash
# На master-1:
# 1. Остановить etcd
mv /etc/kubernetes/manifests/etcd.yaml /tmp/

# 2. Удалить повреждённые данные
rm -rf /var/lib/etcd/member

# 3. Удалить master-1 из member list (с master-2)
etcdctl member remove <MASTER1_MEMBER_ID>

# 4. Добавить master-1 заново (с master-2)
etcdctl member add master-1 \
  --peer-urls=https://<IP_MASTER_1>:2380

# 5. На master-1: восстановить manifest с флагом:
#    --initial-cluster-state=existing
#    (НЕ "new"!)
#    и вернуть manifest на место:
mv /tmp/etcd.yaml /etc/kubernetes/manifests/etcd.yaml
```

### Фаза 5: Финальная проверка

```bash
# 1. etcd здоров?
etcdctl endpoint health --cluster -w table
etcdctl member list -w table

# 2. kube-apiserver отвечает? (на каждой master-ноде)
curl -k https://127.0.0.1:6443/healthz
# Ожидание: "ok"

# 3. kubectl снова работает?
kubectl get nodes
kubectl get componentstatuses   # (deprecated, но покажет etcd healthy)

# 4. Проверить, что нет активных alarm'ов
etcdctl alarm list
```

---

### Крайний случай: полное восстановление из snapshot

Если Фазы 1–4 не помогли (например, данные повреждены на всех нодах):

```bash
# На master-2 (наиболее актуальная нода):
# 1. Сохранить snapshot (если etcd хотя бы читает)
etcdctl snapshot save /tmp/etcd-snapshot.db

# 2. Остановить etcd на ВСЕХ нодах
mv /etc/kubernetes/manifests/etcd.yaml /tmp/   # на каждой

# 3. На master-2 — восстановить как single-node cluster
rm -rf /var/lib/etcd
etcdctl snapshot restore /tmp/etcd-snapshot.db \
  --name=master-2 \
  --initial-cluster=master-2=https://<IP2>:2380 \
  --initial-cluster-token=etcd-cluster-recovery \
  --initial-advertise-peer-urls=https://<IP2>:2380 \
  --data-dir=/var/lib/etcd

# 4. Вернуть manifest (с новой квотой!) и дождаться старта
mv /tmp/etcd.yaml /etc/kubernetes/manifests/etcd.yaml

# 5. После поднятия single-node — добавить master-1 и master-3
#    через member add + запуск с --initial-cluster-state=existing
```

---

### Краткая шпаргалка порядка действий

```
Triage (SSH) → Увеличить квоту в manifest → kubelet рестарт →
alarm disarm → compact → defrag → вернуть master-1 →
проверить API → 🎉
```

> **Главный вывод:** в 90% случаев `database space exceeded` лечится увеличением `--quota-backend-bytes` и последующей дефрагментацией. Полное пересоздание кластера — это крайняя мера, когда данные физически повреждены.
