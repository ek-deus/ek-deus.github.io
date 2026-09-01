---
title: 'Аварийное восстановление etcd-кластера: диагностика, анализ, DR'
description: Аварийное восстановление etcd-кластера: диагностика, анализ, DR'
pubDate: '2026-06-22'
tags: ['linux', 'DevOps', 'sobes', 'etcd', 'k8s','kubernetes']
heroImage: ''
---


Аварийное восстановление etcd-кластера: диагностика, анализ, DR
1. Первоочередная диагностика (Triage) — 4 команды на каждой master-ноде по SSH
Поскольку kube-apiserver мёртв, вся диагностика идёт напрямую через etcdctl и системные утилиты. Предполагаю стандартную kubeadm-раскладку сертификатов.
Команда 1 — Жив ли процесс и что в логах
bash

12
Что даёт: видим, запущен ли процесс (active/failed), exit-code, и сразу отфильтрованные критические сообщения. Именно здесь мы впервые увидим database space exceeded и leader changed.
Команда 2 — Статус кластера глазами etcd
bash

123456
Что даёт: таблицу по всем трём участникам — ID, endpoint, IS LEARNER, RAFT TERM, RAFT INDEX, RAFT APPLIED INDEX, DB SIZE, IS LEADER, ERRORS. Ключевые поля: DB SIZE (увидим, у кого превышен quota), ERRORS (увидим database space exceeded или context deadline exceeded), IS LEADER (увидим, есть ли вообще лидер).
Команда 3 — Дисковое пространство под data-dir
bash

1
Что даёт: свободное место на файловой системе (если диск забит на 100% — это отдельная причина), размер snapshot-файлов, общий размер data-dir. database space exceeded — это про quota etcd (по умолчанию 2 GiB, в 3.4+ до 8 GiB), а не про свободное место на диске, но забитый диск усугубит ситуацию (WAL не может fsync).
Команда 4 — Сетевая связность между пирами
bash

123
Что даёт: проверяем, может ли текущая нода достучаться до peer-портов (2380) остальных участников. Если мастер-1 после перезагрузки не пингуется по 2380, это объясняет, почему его peer-соединения в member list висят в статусе unstarted или unreachable.
2. Анализ симптомов — почему кластер в петле и master-1 не возвращается
Сводим три сообщения в одну причинно-следственную цепочку:
Цепочка событий

123456789101112131415161718192021
Разбор каждой ошибки
Ошибка в логе
Корневая причина
raft: cannot append entry: database space exceeded
Backend bbolt достиг quota-backend-bytes. Etcd намеренно блокирует все записи в Raft-лог, чтобы не повредить данные. Это защитный механизм, не баг.
etcdserver: leader changed (каждые 5-10 сек)
Лидер выбран, но не может ни записать heartbeat, ни продвинуть commitIndex. Followers считают его мёртвым (нет AppendEntries в течение election timeout) → перевыборы. Каждый новый лидер упирается в ту же стену.
failed to send byte array ... context deadline exceeded
gRPC-вызовы между пирами таймаутят. Не обязательно сетевая проблема. При NOSPACE etcd перестаёт обрабатывать входящие Raft-сообщения, gRPC-сервер не отвечает → context deadline (peer heartbeat interval ~100ms, dial timeout ~2s). Плюс возможная высокая I/O-латентность: bbolt при попытке mmap/msync на полном квоте блокирует goroutine.
Почему master-1 не может автоматически вернуться после перезагрузки?
При старте etcd на master-1 выполняет:
Читает собственный WAL/snapshot из /var/lib/etcd/member/.
Пытается установить Raft-соединения с peer-ами (master-2, master-3).
Обнаруживает, что его raft index отстаёт от commitIndex кластера → запрашивает у лидера log entries или snapshot для catch-up.
Но лидер не может ничего записать. Чтобы отправить данные отстающему follower, лидер должен:
Записать в Raft-лог entry типа MsgApp (это write-операция).
При большом отставании — сгенерировать и передать snapshot, что тоже требует записи в backend (создание snapshot-файла, обновление metadata).
Обе операции блокированы ALARM: NOSPACE. Master-1 застревает в состоянии StateProbe/StateSnapshot — он видит кластер, но не может получить данные для синхронизации. Он не «выпал» из member list (его ID по-прежнему там), но его RAFT INDEX не продвигается.
Почему master-2 и master-3 не могут выбрать стабильного лидера и записать данные?
Кворум для выборов (2 из 3) — есть. Они успешно выбирают лидера каждый цикл.
Кворум для записи (2 из 3 подтверждений AppendEntries) — формально тоже есть, но он бесполезен, потому что локальный backend каждого участника заблокирован. Запись в Raft-лог = запись в bbolt на диске лидера + репликация на followers. Если ни на одной ноде backend не принимает writes, Raft-протокол просто не может продвинуть commitIndex ни на один шаг.
Ключевой инсайт: database space exceeded — это не проблема консенсуса (кворум может быть), а проблема локального storage engine на каждой ноде. Все три bbolt-файла independently достигли quota.
3. Пошаговый план восстановления (Disaster Recovery)
Фаза 0 — Снижение нагрузки (опционально, но рекомендуется)
Kubelet на каждой master-ноде будет бесконечно рестартовать crash-looping kube-apiserver, который спамит etcd запросами. Остановим это:
bash

1234
Фаза 1 — Снятие ALARM и Defragmentation (первая линия)
defrag — это локальная операция bbolt: создаёт новый чистый файл, переносит в него только live-страницы, заменяет старый. Не требует Raft-консенсуса, поэтому работает даже при NOSPACE.
Важный нюанс порядка: в штатной ситуации делают compact → defrag. Но compact — это Raft write (должен быть записан в лог и заcommit-чен), поэтому при NOSPACE он не пройдёт. Сначала defrag (освободит место за счёт фрагментации), затем compact, затем ещё раз defrag.
Шаг 1.1 — Defrag на каждой ноде по одной (строго последовательно!)
На master-2:
bash

123456
Ждём завершения (может занять минуты при большой БД). Не используем --cluster — defrag на всех одновременно = все ноды недоступны = полный даунтайм.
Повторить на master-3, затем на master-1.
Шаг 1.2 — Проверка после defrag
bash

123456
Смотрим на DB SIZE — должен уменьшиться. Смотрим ERRORS — должно быть пусто.
Шаг 1.3 — Снятие ALARM (если ещё висит)
bash

123456
Шаг 1.4 — Compaction + повторный defrag (теперь, когда writes разблокированы)
bash

1234567891011121314151617181920212223
Шаг 1.5 — Проверка здоровья кластера
bash

123456
Ожидаем: все три строки healthy.
Шаг 1.6 — Возврат apiserver
bash

12
Через 30–60 секунд: kubectl get nodes должен заработать.
Если Фаза 1 помогла → конец. Переход к профилактике (см. ниже).
Фаза 2 — Disaster Recovery из snapshot (если defrag не помог / etcd не стартует)
Применяется, когда:
defrag не уменьшил DB SIZE достаточно (все данные — live-ревизии, фрагментация минимальна).
etcd crash-loop (WAL повреждён, panic: unexpected в логах).
После перезагрузки master-1 его WAL/snapshot несовместим с текущим состоянием.
Шаг 2.1 — Создать snapshot (если etcd хоть как-то отвечает)
На любой ноде, где endpoint status возвращает данные:
bash

12345
Если не отвечает — используем последний имеющийся бэкап (cron-задача, Velero, etcd-backup-operator и т.д.).
Проверить целостность:
bash

1
Скопировать snapshot на все три мастер-ноды (scp/rsync).
Шаг 2.2 — Остановить etcd на всех трёх нодах
bash

1234
Шаг 2.3 — Восстановить из snapshot на каждой ноде
На каждой master-ноде выполняем (подставляя соответствующее имя и IP):
bash

12345678910
На master-2 — то же самое, но --name=master-2 и --initial-advertise-peer-urls=https://<IP-2>:2380.
На master-3 — аналогично с master-3 / <IP-3>.
Критически важно: --initial-cluster должен быть идентичен на всех трёх нодах. --initial-cluster-token должен быть новым (отличным от старого), иначе новый кластер может случайно присоединиться к остаткам старого, если он вдруг ожил.
Шаг 2.4 — Права и запуск
bash

123456
Шаг 2.5 — Проверка
bash

12345678910111213
Все три ноды healthy, три member в списке, один IS LEADER = true.
Шаг 2.6 — Возврат kube-apiserver
bash

1
Фаза 3 — Профилактика (обязательно после инцидента)
Увеличить quota (если 2 GiB мало для вашего кластера):
В /etc/kubernetes/manifests/etcd.yaml (или systemd unit) добавить/изменить:

1
Перезапустить etcd поочерёдно на каждой ноде.
Включить auto-compaction (если не был включён):

1
Или в --auto-compaction-mode=revision --auto-compaction-retention=1000.
Настроить автоматические бэкапы (cron + etcdctl snapshot save → S3/Minio/NFS) с retention ≥ 7 дней.
Мониторинг: алерт на etcd_mvcc_db_total_size_in_bytes / etcd_server_quota_backend_bytes > 0.8, алерт на etcd_server_has_leader == 0, алерт на etcd_disk_wal_fsync_duration_seconds p99 > 100ms.
Проверить, не создаёт ли кто-то слишком много событий (event spam от misbehaving controller, verbose audit log в etcd, избыток ConfigMap/Secret обновлений). etcdctl get / --prefix --keys-only | cut -d/ -f3 | sort | uniq -c | sort -rn | head покажет топ по количеству ключей.
Итоговая таблица: что делать в зависимости от исхода
Результат Фазы 1
Действие
defrag уменьшил DB SIZE ниже quota, alarm disarm сработал, endpoint health = все healthy
Возвращаем apiserver, настраиваем auto-compaction, инцидент закрыт
defrag не помог (DB SIZE всё ещё ≥ quota)
Переходим к Фазе 2 (snapshot restore)
etcd не стартует вообще (crash, corrupt WAL)
Переходим к Фазе 2
После snapshot restore master-1 не входит в кластер
Удалить member: etcdctl member remove <ID-master-1>, затем etcdctl member add master-1 --peer-urls=https://<IP-1>:2380, затем на master-1 стартануть etcd с чистым data-dir и флагом --initial-cluster-state=existing
