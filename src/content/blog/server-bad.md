---
title: 'Сервер тупит — куда смотреть?'
description: 'Сервер тупит — куда смотреть'
pubDate: 'Jul 15 2025'
heroImage: '../../assets/blog-placeholder-4.jpg'
---

#DevOps #sobes
#linux #сервертупит


Краткий ответ

Первый шаг — `uptime` / `htop`: смотрим load average и топ по CPU. Потом `free -h` на память, `iostat -xh 1 3` на дисковый I/O, `df -h` + `df -i` на место и inode. Три числа load average — средняя длина очереди задач (runnable + D-state) за 1, 5, 15 минут. Если значение выше числа логических CPU — система перегружена. `df` показывает занятость файловой системы по блокам; `du` — реальный объём файлов на диске (то, что занимают конкретные каталоги).


Заходим на сервер и за 30 секунд получаем картину

```
uptime           # load average за 1/5/15 мин
htop             # сортировка по CPU (F6), смотрим %CPU, %MEM, состояние (D = ждёт I/O)
free -h          # колонка 'available' — реально свободная память
iostat -xh 1 3   # %util (насыщённость диска), await (латентность), r/s, w/s
df -h            # блочное место: /var/log, /tmp — частые «виновники»
df -i            # inode: если IUse% = 100%, новые файлы не создаются
```

*Load average:* три числа — EWMA за 1, 5, 15 минут. Учитываются процессы в состоянии runnable и uninterruptible sleep (D). На 4-ядерной машине load 1.0 = 25% нагрузки; load 4.0 = 100%; load 6.0 = очередь переполнена.

`df -h` vs `du -sh`: `df` читает суперблок ФС — быстро, но не учитывает удалённые файлы, которые держит открытый дескриптор. `du` рекурсивно суммирует реальные файлы. Расхождение между ними — признак «deleted but open» файлов (см. `lsof +L1`).

Ключевые тезисы

- Три числа load average — длина очереди за 1/5/15 мин; сравниваем с nproc
- `htop` — состояние D (uninterruptible) указывает на I/O-блокировку
- `iostat -x`: %util → насыщённость; await → латентность I/O
- `df -h` — блоки, `df -i` — inode; оба могут быть 100% независимо
- `df` ≠ `du` при наличии deleted-but-open файлов
- Колонка 'available' в `free` — лучший показатель свободной памяти (учитывает кэш)

Частые ошибки

- ✕Смотреть только CPU, игнорируя I/O и inode
- ✕Путать 'free' и 'available' в выводе `free -h`
- ✕`df` показывает место, а `du` — файлы; несоответствие списывать на баг
- ✕Сравнивать load average с 1.0 вместо числа ядер

Senior-нюанс

При high iowait + low CPU util — ищем D-state процессы: `ps -eo pid,stat,comm | awk '$2~/D/'`; смотрим `/proc/<pid>/wchan` — какой kernel call блокирует

–Load average высокий, а CPU простаивает (load 12 на 4 ядрах, idle почти 100%) — почему и чем диагностировать?★ часто и каверзный

Краткий ответ

Высокий load при idle CPU означает, что процессы стоят в очереди не на CPU, а на I/O (состояние D — uninterruptible sleep). iowait в `iostat` подтвердит. Ищем виновника через `iotop -ao`, `ps aux | awk '$8~/D/'`, `/proc/<pid>/wchan`.

›Свернуть

Load average считает процессы в состоянии **R** (runnable) **и D** (uninterruptible sleep, ожидание I/O). Если все 12 процессов ждут диск, CPU действительно idle, но очередь забита.

Диагностика пошагово:

bash

```
iostat -xh 1 5          # смотрим %util и await на устройствах
iotop -ao               # топ по накопленному I/O, сразу видно виновника
ps -eo pid,stat,comm --sort=-stat | grep "^[0-9]* D"  # D-state процессы
cat /proc/<pid>/wchan   # kernel function, на которой завис процесс
dmesg | tail -50        # storage errors, hung_task timeout
```

Частые причины: перегруженный диск (HDD/медленный SAN), NFS-таймаут (процесс ждёт ответа NFS-сервера), deadlock в файловой системе, RAID-ребилд. В Kubernetes контекст: если PV на медленном ceph/nfs — все поды приложения уходят в D-state, и метрики node-exporter`a покажут iowait > 50%.

Ключевые тезисы

- D-state = uninterruptible sleep = процесс ждёт I/O, не CPU
- Load average включает D-state процессы, поэтому CPU может быть idle
- `iostat -x`: `%util` близко к 100% — диск перегружен, `await` растёт
- `iotop -ao` — накопленный I/O, сразу виден виновник
- `/proc/<pid>/wchan` — имя kernel call, на котором завис процесс
- `dmesg` — ищем `hung_task`, storage errors, scsi timeouts

Частые ошибки

- ✕Делать вывод 'CPU не виноват, значит всё ок' при высоком load
- ✕Не смотреть `iowait` в iostat/mpstat
- ✕Путать D-state (I/O wait) с Z-state (zombie)
- ✕Не проверять сетевые ФС (NFS/ceph) как источник I/O-блокировок
