---
title: 'Docker, cgroups и namespaces.md'
description: 'Docker, cgroups и namespaces.md'
pubDate: '2026-06-22'
heroImage: ''
---

 #DevOps #sobes
#linux #docker #cgroup #namespace

Краткий ответ

Namespaces изолируют видимость ресурсов (процессы, сеть, ФС, пользователи — каждый контейнер видит только своё). Cgroups ограничивают потребление ресурсов (CPU, RAM, I/O, PID). Контейнер = namespace + cgroup + union FS. Отличие от VM: контейнеры делят ядро хоста

**Linux Namespaces** (что видит процесс):

|Namespace|Изолирует|
|---|---|
|pid|дерево процессов (PID 1 внутри контейнера)|
|net|сетевые интерфейсы, маршруты, iptables|
|mnt|точки монтирования (rootfs контейнера)|
|uts|hostname и domainname|
|ipc|SysV IPC, POSIX MQ|
|user|UID/GID mapping (rootless containers)|

**cgroups** (сколько может потребить):

- CPU: `cpu.shares`, `cpu.cfs_quota_us` — ограничение + приоритет
- Memory: `memory.limit_in_bytes` — при превышении → OOM kill
- I/O: `blkio` (v1) / `io` (v2) — квоты на r/w
- PID: `pids.max` — лимит форков (защита от fork bomb)

В v2 единая иерархия вместо отдельных контроллеров v1.

**Контейнеризация vs Виртуализация:**

||Контейнер|VM|
|---|---|---|
|Ядро|Общее с хостом|Своё (гостевое)|
|Изоляция|Namespace-уровень|Hardware-уровень|
|Старт|мс|секунды–минуты|
|Образ|МБ|ГБ|
|Безопасность|Слабее (общее ядро)|Сильнее|

Kubernetes лимиты (`limits.cpu`, `limits.memory`) транслируются в cgroup параметры на ноде.

Ключевые тезисы

- Namespaces = изоляция видимости; cgroups = ограничение ресурсов
- 6 типов namespace: pid, net, mnt, uts, ipc, user
- cgroups v2 — единая иерархия, предпочтительна в современных системах
- Контейнеры делят ядро → CVE в ядре = риск для всех контейнеров на хосте
- Kubernetes limits → cgroup cfs_quota_us; CPU throttling при превышении

Частые ошибки

- ✕Путать namespace (видимость) и cgroup (ограничение)
- ✕Считать контейнеры такими же изолированными как VM
- ✕Не знать, что cgroups v2 принята по умолчанию в современных дистрибутивах
