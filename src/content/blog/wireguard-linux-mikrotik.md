---
title: 'WireGuard на Linux и MikroTik: настройка туннеля site-to-site'
description: 'Соединяем Linux и MikroTik RouterOS 7 через WireGuard: ключи, AllowedIPs, статические маршруты, firewall и диагностика ситуации, когда handshake есть, а трафик не идёт.'
pubDate: '2026-11-17'
tags: ['Mesh VPN', 'WireGuard', 'VPN', 'MikroTik', 'RouterOS', 'linux', 'network', 'security', 'DevOps']
---

Две площадки с непересекающимися подсетями можно соединить одним туннелем WireGuard. Здесь MikroTik — доступный UDP endpoint на площадке A, а Linux — шлюз площадки B. Если обе площадки находятся за CGNAT и входящий UDP недоступен, понадобится достижимый промежуточный узел либо система с NAT traversal и relay.

## Схема и адресация

```text
Площадка A                                           Площадка B
172.22.40.0/24                                       172.22.50.0/24
       │                                                    │
     MikroTik       ══════ WireGuard / UDP ══════         Linux
  10.203.0.1/30                                       10.203.0.2/30
  vpn.example.com:51820                             инициирует туннель
```

В примере узлам B разрешено обращаться к HTTPS на `172.22.40.20`. Статические маршруты описывают площадки, firewall ограничивает потоки приложений. Подставьте реальные имена интерфейсов, endpoint и адреса. Прежде чем менять firewall, сохраните независимый административный доступ.

## Ключи и конфигурация Linux

На Linux установите пакет `wireguard-tools`. Создайте ключ один раз. Повторная генерация при каждой выкладке оборвёт доступ до обновления второго peer.

```bash
sudo install -d -m 0700 /etc/wireguard
sudo sh -c '
  set -eu
  umask 077
  set -C
  wg genkey > /etc/wireguard/wg-site.key
'
sudo sh -c 'wg pubkey < /etc/wireguard/wg-site.key'
```

При повторном запуске `set -C` защищает существующий ключ от перезаписи. Передайте администратору MikroTik только публичный ключ. Сформируйте на Linux файл `/etc/wireguard/wg-site.conf` с правами `0600` и владельцем root. Значение `PrivateKey` подставьте из созданного файла при защищённом рендеринге конфигурации.

```ini
[Interface]
Address = 10.203.0.2/30
PrivateKey = <LINUX_PRIVATE_KEY>

[Peer]
PublicKey = <MIKROTIK_PUBLIC_KEY>
Endpoint = vpn.example.com:51820
AllowedIPs = 10.203.0.1/32, 172.22.40.0/24
PersistentKeepalive = 25
```

`wg-quick` установит маршрут до удалённой LAN из `AllowedIPs`. Keepalive поддерживает состояние на NAT со стороны Linux. Если NAT или stateful firewall между площадками не требуют этого, параметр можно опустить. [WireGuard Quick Start](https://www.wireguard.com/quickstart/).

## Интерфейс, peer и маршрут на MikroTik

Команды рассчитаны на первичное создание. При повторной настройке изменяйте существующий интерфейс и peer по именам или комментариям. RouterOS создаст ключ для нового интерфейса автоматически.

```routeros
/interface/wireguard
add name=wg-site listen-port=51820
/ip/address
add address=10.203.0.1/30 interface=wg-site
/interface/wireguard/peers
add interface=wg-site public-key="<LINUX_PUBLIC_KEY>" allowed-address=10.203.0.2/32,172.22.50.0/24 comment="Site B"
/ip/route
add dst-address=172.22.50.0/24 gateway=wg-site comment="Site B LAN"
:put [/interface/wireguard/get [/interface/wireguard/find where name="wg-site"] public-key]
```

Подставьте показанный публичный ключ в конфигурацию Linux. `allowed-address` на MikroTik определяет допустимые адреса источника и выбор peer внутри интерфейса. Запись в `/ip/route` направляет удалённую подсеть в этот интерфейс. Не назначайте один и тот же префикс нескольким peer на одном интерфейсе. [WireGuard в RouterOS](https://help.mikrotik.com/docs/spaces/ROS/pages/69664792/WireGuard).

## Firewall и обратные маршруты

- На MikroTik разрешите входящий UDP/51820 на WAN перед блокирующим правилом `input`. Если исходящий публичный IP Linux фиксирован, ограничьте правило этим адресом. Входящий доступ к управлению MikroTik оставьте в его отдельной зоне.
- В цепочке `forward` MikroTik разрешите новые соединения из `172.22.50.0/24` с интерфейса `wg-site` только к `172.22.40.20:443`. Существующие правила `established,related` должны пропускать ответы. Проверьте порядок относительно общих разрешений, запретов и FastTrack, особенно при нескольких таблицах маршрутизации.
- На Linux включите `net.ipv4.ip_forward=1` через `/etc/sysctl.d/`. В текущем firewall разрешите исходящий UDP к endpoint, пересылку из LAN к целевому сервису через `wg-site` и ответные соединения. Проверьте локальный firewall панели.
- Оставьте исходные LAN-адреса видимыми между площадками. Если WireGuard-узел не основной шлюз для своей LAN, добавьте на LAN-шлюзе маршрут до удалённой сети через WireGuard-узел. Проверьте, что правила masquerade применяются к выходу в интернет и не захватывают VPN-трафик.

## Запуск и диагностика

```bash
sudo systemctl enable --now wg-quick@wg-site
sudo wg show wg-site
ip route get 172.22.40.20
```

Сформируйте трафик с хоста в сети B, чтобы проверить всю цепочку пересылки. Имя в команде должно соответствовать сертификату панели.

```bash
curl --connect-timeout 5 --max-time 10 \
  --resolve panel.example.com:443:172.22.40.20 \
  https://panel.example.com/
```

| Симптом | Где искать |
| --- | --- |
| После запроса handshake не появился | DNS endpoint, UDP на внешнем интерфейсе, входной firewall, публичные ключи, доступность WAN |
| Handshake обновляется, HTTPS недоступен | Маршруты в обе стороны, `AllowedIPs`, forwarding, firewall панели и шлюзов |
| Ответы иногда теряются, крупные запросы зависают | Path MTU, прохождение ICMP Packet Too Big или Fragmentation Needed, счётчики интерфейсов |
| После переноса клиента в другую сеть связь пропала | Новая политика UDP, NAT и актуальность разрешённого источника на WAN |

Подтвердите, что запрос с площадки B достигает панели, ответ возвращается к исходному адресу, а трафик на лишние порты блокируется. [Диагностика сетевых проблем в Linux](/blog/network-troubleshooting/).

## Цикл Mesh VPN · 5 из 5

1. [Что такое Mesh VPN и как он работает за NAT](/blog/mesh-vpn-wireguard/)
2. [Tailscale: настройка сети и доступ к подсетям](/blog/tailscale-mesh-vpn/)
3. [Tailscale, ZeroTier и NetBird: сравнение](/blog/zerotier-netbird-tailscale/)
4. [Headscale: собственный сервер координации](/blog/headscale-self-hosted/)
5. **WireGuard на Linux и MikroTik: site-to-site**
