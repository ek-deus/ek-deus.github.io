---
title: 'systemd что происходит при загрузке Linux от кнопки питания до login, что такое unit как поднять node_exporter как сервис и снять метрики?'
description: 'что происходит при загрузке Linux'
pubDate: '2026-06-22'
heroImage: ''
---
#DevOps #sobes
#linux #systemd #node_exporter #login #metric #unit 

Краткий ответ

Boot: POST → UEFI/BIOS → GRUB → kernel + initramfs → PID 1 (systemd) → targets (sysinit → basic → multi-user). Unit — файл конфигурации управляемого ресурса (.service, .timer, .mount и др.). node_exporter запускается через .service unit, метрики доступны на :9100/metrics.

**Цепочка загрузки:**

1. POST, UEFI инициализирует оборудование
2. GRUB читает `/boot/grub/grub.cfg`, загружает `vmlinuz` + `initramfs` в RAM
3. Ядро инициализирует устройства, монтирует initramfs как временный root
4. initramfs подгружает драйверы, монтирует реальный root `/`
5. Ядро запускает `/sbin/init` (PID 1) — в современных системах это `systemd`
6. systemd строит граф зависимостей unit-ов, запускает target-ы последовательно: `sysinit.target` → `basic.target` → `multi-user.target` → `graphical.target` (если есть GUI)

**Unit для node_exporter** (`/etc/systemd/system/node_exporter.service`):

```ini
[Unit]
Description=Prometheus Node Exporter
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/node_exporter
Restart=on-failure
RestartSec=5s
User=node_exporter

[Install]
WantedBy=multi-user.target
```


```bash
systemctl daemon-reload
systemctl enable --now node_exporter
systemctl status node_exporter
curl -s localhost:9100/metrics | grep node_cpu
```

Ключевые тезисы

- BIOS/UEFI → GRUB → vmlinuz + initramfs → systemd (PID 1)
- initramfs нужен для загрузки драйверов до монтирования реального root
- Unit — декларативный файл; типы: .service .timer .socket .mount .target
- target = группа unit-ов; multi-user.target ≈ runlevel 3 в SysV
- `systemctl enable` = добавить в автозапуск; `--now` = запустить сразу
- `journalctl -u node_exporter -f` — стриминг логов сервиса

Частые ошибки

- ✕Пропускать шаг initramfs в объяснении boot
- ✕Не различать BIOS/MBR и UEFI/GPT пути загрузки
- ✕Забывать `daemon-reload` после изменения unit-файла
- ✕Не указывать `After=network.target` для сетевых сервисов

Senior-нюанс

В UEFI-системах GRUB живёт на ESP (EFI System Partition, FAT32, /boot/efi); bootloader .efi запускается напрямую прошивкой — нет MBR
