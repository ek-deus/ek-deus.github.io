---
title: 'Сигналы SIGTERM vs SIGINT vs SIGKILL — как процесс реагирует, как корректно остановить, когда kill -9'
description: 'SIGTERM vs SIGINT vs SIGKILL'
pubDate: '2026-06-22'
tags: ['linux', 'DevOps', 'sobes', 'SIGTERM', 'SIGINT','SIGKILL']
heroImage: ''
---
# DevOps #sobes

# linux #sigterm #sigint #sigkill #kill-9

Краткий ответ

SIGTERM (15) — запрос на завершение; процесс может перехватить и завершиться грациозно. SIGINT (2) — то же самое (Ctrl+C). SIGKILL (9) — ядро убивает немедленно, перехват невозможен. Паттерн: сначала SIGTERM, ждём grace period, затем SIGKILL если не завершился.

|Сигнал|Номер|Перехватываемый|Поведение по умолчанию|
|---|---|---|---|
|SIGTERM|15|Да|Graceful termination|
|SIGINT|2|Да|Graceful termination (Ctrl+C в терминале)|
|SIGQUIT|3|Да|Termination + core dump|
|SIGKILL|9|**Нет**|Немедленное уничтожение ядром|
|SIGSTOP|19|**Нет**|Приостановка (не завершение)|
|SIGCONT|18|Да|Возобновление после SIGSTOP|

**Корректная остановка:**

```
kill -15 <pid>          # SIGTERM — процесс флашит буферы, закрывает соединения
sleep 30                # grace period
kill -0 <pid> && kill -9 <pid>  # SIGKILL если ещё жив
```

Именно так работают `systemd` (`TimeoutStopSec`), `docker stop` (10 сек по умолчанию), Kubernetes (`terminationGracePeriodSeconds`, дефолт 30 сек). PID 1 в контейнере требует особой осторожности: многие init-образы (busybox sh) не форвардят SIGTERM дочерним процессам — нужен `tini` или `exec` форма ENTRYPOINT.

**Когда `kill -9`**: процесс завис в D-state (не выходит по SIGTERM), утечка памяти критична, отладка зависшего сервиса. Последствие: нет graceful shutdown → возможна потеря данных, незакрытые БД-соединения.

Ключевые тезисы

- SIGKILL и SIGSTOP нельзя перехватить, заблокировать или проигнорировать
- SIGTERM — стандартный паттерн graceful stop; всегда сначала он
- systemd/Kubernetes: SIGTERM → grace period → SIGKILL
- PID 1 в контейнере: sh не форвардит сигналы — использовать tini или exec
- `kill -0 <pid>` — проверить, существует ли процесс (без отправки сигнала)

Частые ошибки

- ✕Думать, что SIGTERM нельзя перехватить (путают с SIGKILL)
- ✕Сразу бить kill -9 без попытки SIGTERM
- ✕Не знать, что SIGSTOP тоже непрерываемый
- ✕Не учитывать поведение PID 1 в контейнере
