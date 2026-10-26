---
title: 'Port Knocking на MikroTik: настройка и ограничения'
description: 'Настраиваем последовательный Port Knocking в RouterOS для временного доступа к SSH и Winbox и разбираем его ограничения.'
pubDate: '2026-10-27'
tags: ['MikroTik', 'RouterOS', 'security', 'port-knocking', 'network']
heroImage: ''
---

Port Knocking позволяет временно разрешить соединение с управляющим сервисом после короткой последовательности обращений к закрытым TCP-портам. Ниже — пример для MikroTik RouterOS: три стука, затем доступ с того же исходного IP к SSH и Winbox на 60 секунд.

Это дополнительный фильтр доступа, а не криптографическая аутентификация. Последовательность можно перехватить или воспроизвести, а открытый порт всё равно нужно защищать штатной аутентификацией. Для постоянного удалённого администрирования предпочтительнее VPN, например WireGuard.

## Как это работает

```text
Клиент                         MikroTik
  |                               |
  |--- TCP SYN :1234 ----------->| добавить IP в knock_1 (15 с)
  |--- TCP SYN :5678 ----------->| если IP в knock_1 → knock_2 (15 с)
  |--- TCP SYN :9012 ----------->| если IP в knock_2 → knock_open (60 с)
  |                               |
  |--- SSH :22 / Winbox :8291 -->| разрешить, если IP в knock_open
  |                               |
```

Каждый следующий стук должен прийти до истечения таймера предыдущего списка. Таймер доступа к SSH/Winbox начинается с третьего стука.

Правила `add-src-to-address-list` добавляют динамические записи и пропускают пакет к следующим правилам. Поэтому после правил стука нужно отдельно отбросить сами knock-порты. Создавать фиктивные записи в address-list не требуется.

## Перед настройкой

- Убедитесь, что удалённый доступ к роутеру действительно нужен. Если возможно, используйте VPN.
- Сохраните конфигурацию: `/export file=before-port-knocking`.
- Оставьте открытой действующую сессию управления и обеспечьте резервный доступ по LAN или консоли.
- Включите Safe Mode в терминале RouterOS сочетанием `Ctrl-X` перед изменением правил. Не закрывайте исходную сессию до проверки новой конфигурации.
- Убедитесь, что интерфейс выхода в интернет включён в interface list `WAN`. Проверьте также IPv6 firewall: правила `/ip firewall filter` защищают только IPv4.

В примере используются TCP-порты `1234`, `5678`, `9012`, а для управления — SSH `22` и Winbox `8291`. Замените knock-порты на свои. Значения — пример, не секретный ключ.

## Правила RouterOS

Схема обработки пакетов в `input`-цепочке:

```text
WAN-пакет → established/related: принять
          → invalid: отбросить
          → стук на 1234/5678/9012: обновить соответствующий список
          → knock-порт: отбросить
          → SSH/Winbox и IP в knock_open: принять
          → SSH/Winbox и IP не в knock_open: отбросить
          → остальные пакеты: обработать текущими правилами firewall
```

Добавьте правила в `/ip firewall filter` в указанном порядке. Пример ниже ориентирован на стандартную конфигурацию RouterOS 7 и вставляет каждое правило перед правилом `defconf: drop all not coming from LAN`. Если у вас другой firewall, замените это имя на комментарий вашего общего drop-правила. Правила должны стоять после базовых правил для `established,related` и `invalid`, но до общего запрета входящего трафика. Перед ними не должно оставаться широкого правила, разрешающего SSH или Winbox с WAN.

```routeros
/ip firewall filter

# Шаг 1: первый SYN с WAN добавляет источник в первую временную группу
add chain=input in-interface-list=WAN protocol=tcp connection-state=new dst-port=1234 action=add-src-to-address-list address-list=knock_1 address-list-timeout=15s comment="Port knock 1" place-before=[find where comment="defconf: drop all not coming from LAN"]

# Шаг 2: только источник из первой группы может выполнить второй стук
add chain=input in-interface-list=WAN protocol=tcp connection-state=new dst-port=5678 src-address-list=knock_1 action=add-src-to-address-list address-list=knock_2 address-list-timeout=15s comment="Port knock 2" place-before=[find where comment="defconf: drop all not coming from LAN"]

# Шаг 3: только источник из второй группы получает временный доступ
add chain=input in-interface-list=WAN protocol=tcp connection-state=new dst-port=9012 src-address-list=knock_2 action=add-src-to-address-list address-list=knock_open address-list-timeout=1m comment="Port knock grant" place-before=[find where comment="defconf: drop all not coming from LAN"]

# Не отвечать на попытки подключения к knock-портам
add chain=input in-interface-list=WAN protocol=tcp dst-port=1234,5678,9012 action=drop comment="Drop port-knock ports" place-before=[find where comment="defconf: drop all not coming from LAN"]

# Разрешить управление только адресу, прошедшему последовательность
add chain=input in-interface-list=WAN protocol=tcp dst-port=22,8291 src-address-list=knock_open action=accept comment="Allow knocked management" place-before=[find where comment="defconf: drop all not coming from LAN"]

# Закрыть эти службы для остальных источников с WAN
add chain=input in-interface-list=WAN protocol=tcp dst-port=22,8291 action=drop comment="Drop unsolicited management" place-before=[find where comment="defconf: drop all not coming from LAN"]
```

Например, если первый SYN приходит в момент `t=0`, то второй должен прийти в пределах 15 секунд; после второго у клиента есть ещё 15 секунд на третий. После третьего SSH и Winbox разрешены на 60 секунд:

```text
первый стук       второй стук       третий стук          истечение доступа
    |                  |                  |                      |
    t0 ── до 15 с ────> t1 ── до 15 с ──> t2 ───── 60 с ──────> t3
    knock_1             knock_2             knock_open
```

`in-interface-list=WAN` ограничивает правила пакетами, пришедшими с интерфейсов WAN. Если в вашей конфигурации WAN определяется иначе, используйте соответствующий список или интерфейс.

Порядок важен: правила стука, разрешение для `knock_open` и ограничивающий drop должны находиться до общего drop. Одновременно проверьте существующие правила `accept`: если более раннее правило уже разрешает SSH/Winbox из WAN, Port Knocking не ограничит доступ.

Не добавляйте показанное правило `drop` для SSH/Winbox вслепую поверх действующей конфигурации: сначала проверьте, что LAN, VPN и доверенные адреса разрешены нужными правилами. Если необходимо сохранить управление с доверенной сети, отдельное разрешающее правило для неё должно стоять выше WAN-drop.

### Учитывайте IPv6

Правила выше работают только для IPv4. Если на роутере доступен IPv6, настройте аналогичную политику в `/ipv6 firewall filter` либо явно закройте SSH и Winbox с IPv6 WAN. Иначе сервис может остаться доступным по IPv6 в обход IPv4 knocking.

## Как выполнить последовательность

Каждый вызов `nc` отправляет TCP SYN. Поскольку knock-порты намеренно отбрасываются, клиент может получить таймаут — это ожидаемо. Важно отправить запросы последовательно и с одного внешнего IP-адреса.

```bash
#!/usr/bin/env bash
set -euo pipefail

router="203.0.113.10"  # замените на внешний адрес роутера

for port in 1234 5678 9012; do
  nc -n -z -w 2 "$router" "$port" || true
  sleep 1
done
```

`-n` отключает DNS-резолвинг, `-z` отправляет пробу без передачи данных, `-w 2` задаёт короткий таймаут. `|| true` позволяет продолжить последовательность, даже если `nc` сообщает о таймауте или отказе. Синтаксис некоторых реализаций netcat отличается.

Не запускайте все три порта одним сканированием `nmap`: сканер может отправлять пробы параллельно, а порядок обработки пакетов не гарантирован. Если используете другой клиент, отправляйте по одному порту за раз.

## Проверка и откат

Проверяйте настройку из отдельной сети, например через мобильный интернет, а не из LAN за тем же NAT:

1. До стука SSH и Winbox с WAN должны быть недоступны.
2. Выполните три стука подряд с одного внешнего IP.
3. В течение минуты подключитесь к разрешённому сервису.
4. Проверьте, что после истечения таймера новый доступ с этого IP снова закрыт.
5. Убедитесь, что доступ по LAN или VPN работает.

Посмотреть динамические записи:

```routeros
/ip firewall address-list print where list~"knock_"
```

Если проверка не прошла, удалите добавленные правила по комментариям или верните конфигурацию из резервной копии. Safe Mode откатит изменения при обрыве сессии, в которой он был включён; не закрывайте эту сессию до успешной проверки.

## Ограничения и меры защиты

- Port Knocking скрывает управляющий сервис от части случайных проверок, но не является вторым фактором и не защищает от уязвимостей SSH или Winbox.
- Последовательность не шифруется и может быть записана наблюдателем на пути, а затем воспроизведена до истечения таймеров.
- Случайное сканирование может совпасть с последовательностью, особенно если стуков мало. Большее число случайных портов снижает вероятность случайного совпадения, но не заменяет VPN и криптографическую аутентификацию.
- За NAT несколько устройств могут иметь один внешний IP. После успешного стука доступ получит этот IP целиком, а не отдельное устройство за ним.
- Knock не предотвращает объёмную DDoS-атаку: для неё трафик всё равно должен достигнуть канала или роутера.
- Неиспользуемые сервисы RouterOS следует отключить, а SSH и Winbox дополнительно ограничить политикой firewall и надёжной аутентификацией.

Port Knocking уместен как временное ограничение для узкого сценария администрирования. Для постоянного доступа настройте WireGuard и разрешите управление только из VPN или доверенной management-сети.

## Ресурсы

- [Port knocking — документация MikroTik](https://help.mikrotik.com/docs/spaces/ROS/pages/154042369/Port%20knocking)
- [Address lists — документация MikroTik](https://help.mikrotik.com/docs/spaces/ROS/pages/130220135/Address-lists)
- [Firewall filter — документация MikroTik](https://help.mikrotik.com/docs/spaces/ROS/pages/48660608/Filter)
- [Securing your router — документация MikroTik](https://help.mikrotik.com/docs/spaces/ROS/pages/328353/Securing%20your%20router)
