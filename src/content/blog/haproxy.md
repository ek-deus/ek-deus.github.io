---
title: 'HAProxy: Руководство для начинающих и развертывание в Kubernetes'
description: 'Аварийное восстановление etcd-кластера'
pubDate: '2026-06-22'
tags: ['linux', 'DevOps', 'HAProxy', 'etcd', 'k8s','kubernetes']
heroImage: ''
---

## Введение

Если вы начинающий системный администратор или разработчик, наверняка сталкивались с задачей управления сетевым трафиком. Один из мощных инструментов для этого - **HAProxy**, высокопроизводительный балансировщик нагрузки для TCP и HTTP.

В этой статье мы разберем:

* что такое TCP-проксирование,
* зачем использовать HAProxy,
* **пошаговую инструкцию по установке и настройке**,
* базовый пример конфигурации,
* **практический пример: установка HAProxy на master-нодах Kubernetes для отказоустойчивости API Server**,
* советы по безопасности и мониторингу.

---

## Что такое проксирование TCP?

Проксирование TCP - это пересылка TCP-соединений от клиента к серверу (или группе серверов) через посредника. В отличие от HTTP-прокси, который работает на прикладном уровне (понимает URL, заголовки, куки), TCP-проксирование происходит на транспортном уровне (L4). Это делает его универсальным для любых TCP-протоколов: от баз данных (PostgreSQL, MySQL) до почтовых сервисов и Kubernetes API.

---

## Зачем использовать HAProxy?

HAProxy - это легкий и гибкий инструмент, который позволяет:

* 🔄 распределять нагрузку между несколькими серверами;
* ✅ проверять доступность серверов (health checks);
* 📊 предоставлять удобную статистику и мониторинг;
* 🔒 обрабатывать SSL-трафик (терминация или сквозная передача).

---

## Пошаговая инструкция по установке и настройке HAProxy

Ниже приведено подробное руководство по установке балансировщика в операционных системах семейства Linux (Ubuntu / Debian и RHEL / AlmaLinux / CentOS).

### Шаг 1. Установка пакета

Обновите индексы пакетов и установите HAProxy из официального репозитория:

* **Для Ubuntu / Debian:**
```bash
sudo apt update
sudo apt install haproxy -y

```


* **Для CentOS / RHEL / AlmaLinux / Rocky Linux:**
```bash
sudo dnf install haproxy -y

```



### Шаг 2. Создание резервной копии конфигурации

Перед внесением изменений всегда полезно сохранить дефолтный файл конфигурации:

```bash
sudo cp /etc/haproxy/haproxy.cfg /etc/haproxy/haproxy.cfg.bak

```

### Шаг 3. Создание файла конфигурации

Откройте основной конфигурационный файл в текстовом редакторе (например, `nano` или `vim`):

```bash
sudo nano /etc/haproxy/haproxy.cfg

```

### Шаг 4. Проверка синтаксиса

После того как вы сохранили конфигурационный файл, обязательно проверьте его на наличие синтаксических ошибок с помощью ключа `-c`:

```bash
haproxy -c -f /etc/haproxy/haproxy.cfg

```

*Если вывод сообщает `Configuration file is valid`, значит, всё настроено верно.*

### Шаг 5. Запуск и управление службой

Добавьте HAProxy в автозагрузку и запустите сервис:

```bash
sudo systemctl enable haproxy
sudo systemctl restart haproxy

```

Проверить текущий статус сервиса можно стандартной командой systemd:

```bash
sudo systemctl status haproxy

```

---

## Пример базовой конфигурации HAProxy для TCP

Ниже представлена базовая конфигурация, которая слушает соединения на порту `4444` и перенаправляет их на бэкенд-сервер.

```haproxy
global
    log /dev/log local0
    log /dev/log local1 notice
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s
    user haproxy
    group haproxy
    daemon

defaults
    log global
    mode http
    option dontlognull
    timeout connect 5000
    timeout client 50000
    timeout server 50000

frontend tcp-frontend
    bind *:4444
    mode tcp
    default_backend tcp-backend

backend tcp-backend
    mode tcp
    balance roundrobin
    option tcp-check
    server server1 192.168.1.100:443 weight 1 check

```

### Разбор конфигурации

* **`global`** - задает базовые системные параметры (логирование, chroot, пользователя, режим демона).
* **`defaults`** - дефолтные опции, включая таймауты. По умолчанию задан `mode http`, но в секциях `frontend` и `backend` мы переопределяем его на `tcp`.
* **`frontend tcp-frontend`** - точка входа, которая слушает порт `4444` и пересылает входящие запросы в указанный бэкенд.
* **`backend tcp-backend`** - балансирует соединения и определяет список серверов. Параметр `check` в строке `server` включает проверку доступности (health check).

---

## Продвинутый пример: HAProxy в кластере Kubernetes (Master-ноды)

При развертывании отказоустойчивого кластера Kubernetes (High Availability) на нескольких master-нодах встает вопрос: куда должны обращаться `kubectl`, `kubelet` и контроллеры?

Прямое обращение к одной ноде создаст единую точку отказа. Решением является установка **HAProxy + Keepalived** на каждую master-ноду для создания единого виртуального IP-адреса (VIP) и балансировки запросов к Kubernetes API Server (`port 6443`).

### Архитектура решения

1. Клиенты отправляют запросы на виртуальный IP (**VIP**), удерживаемый утилитой Keepalived.
2. HAProxy, запущенный на мастер-нодах, принимает трафик на порту `6443` и распределяет его между API-серверами всех master-нод.

### Конфигурация HAProxy для Kubernetes API (`/etc/haproxy/haproxy.cfg`)

```haproxy
global
    log /dev/log local0
    log /dev/log local1 notice
    chroot /var/lib/haproxy
    user haproxy
    group haproxy
    daemon
    maxconn 4000

defaults
    log     global
    mode    tcp
    option  tcplog
    option  dontlognull
    retries 3
    timeout connect 5s
    timeout client  50s
    timeout server  50s

# Фронтенд для Kubernetes API Server
frontend k8s-api-frontend
    bind *:6443
    mode tcp
    option tcplog
    default_backend k8s-api-backend

# Бэкенд с перечислением всех master-нод кластера
backend k8s-api-backend
    mode tcp
    balance roundrobin
    option tcp-check
    # Проверяем доступность API-сервера каждые 3 секунды
    default-server inter 3s rise 2 fall 3
    server master1 192.168.10.11:6443 weight 1 check
    server master2 192.168.10.12:6443 weight 1 check
    server master3 192.168.10.13:6443 weight 1 check

```

### Какая от этого польза?

* **Отказоустойчивость (HA):** Если одна из master-нод падает, HAProxy автоматически исключает ее из пула (`fall 3`), а Keepalived переносит VIP на живой узел.
* **Масштабируемость:** Нагрузка от сотен подов и администраторов равномерно распределяется по всем управляющим узлам.

### Альтернативные подходы к балансировке в Kubernetes

1. **`kube-vip`**: Современный Cloud-Native инструмент, который совмещает функции балансировщика и управления виртуальным IP (VIP) без необходимости настройки HAProxy/Keepalived вручную.
2. **Внешние аппаратные/облачные балансировщики (LB):** Например, AWS ELB, MetalLB (для bare-metal), которые берут на себя функцию распределения трафика до входа в кластер.

---

## Тестирование подключения

После запуска службы проверьте доступность проксируемого порта с помощью утилит `nc` (netcat) или `telnet`:

```bash
nc -zv <haproxy-ip> 4444
# или для Kubernetes API
nc -zv <vip-or-master-ip> 6443

```

---

## Мониторинг: Страница статистики

Чтобы отслеживать состояние бэкендов и соединений в реальном времени, добавьте в конфиг секцию статистики:

```haproxy
frontend stats
    bind 127.0.0.1:8404
    mode http
    stats enable
    stats uri /stats
    stats refresh 10s
    stats auth admin:замените-на-длинный-пароль

```

> **Важно:** Страница привязана к `127.0.0.1`, поэтому из внешней сети она недоступна. Для безопасного просмотра используйте SSH-туннель:
> ```bash
> ssh -L 8404:127.0.0.1:8404 user@<haproxy-ip>
> 
> ```
> 
> 
> После этого откройте в браузере: `[http://127.0.0.1:8404/stats](http://127.0.0.1:8404/stats)`.

---

## Советы для начинающих

* **🔐 Безопасность:** Никогда не выставляйте страницу статистики наружу без аутентификации. Директива `stats admin` позволяет управлять состоянием серверов прямо из веб-интерфейса - используйте ее с осторожностью.
* **🩺 Проверка здоровья:** Всегда используйте параметр `check` в строках `server`. Базовую TCP-проверку можно расширить специфическими протоколами (`option mysql-check`, `option pgsql-check`).
* **📝 Логирование:** Если логи не пишутся в `/var/log/haproxy.log`, убедитесь, что в системе настроен и запущен демон `rsyslog` с поддержкой UDP-сокетов от HAProxy.