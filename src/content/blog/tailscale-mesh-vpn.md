---
title: 'Настройка Tailscale: WireGuard, Subnet Router, Exit Node и Grants'
description: 'Подключаем Linux к Tailscale, настраиваем доступ к офисной подсети и выходной узел. Пример Grants, проверка MagicDNS, прямого соединения и DERP.'
pubDate: '2026-11-17'
tags: ['Mesh VPN', 'WireGuard', 'VPN', 'Tailscale', 'network', 'linux', 'security', 'DevOps']
---

Допустим, дежурному администратору нужен SSH на Linux-сервер и HTTPS к внутренней панели `172.22.40.20`. На сервер можно поставить Tailscale, а на панели — нельзя. Агент на сервере позволит выдать доступ по тегу, а небольшой Linux-узел в той же LAN будет маршрутизировать трафик к панели.

## Подключение к tailnet

Установите пакет из [официального репозитория для вашей ОС](https://tailscale.com/download/linux). На Linux запустите клиент и пройдите регистрацию через ваш IdP.

```bash
sudo tailscale up
tailscale status
tailscale ip -4
```

Повторите подключение на втором узле. При включённом MagicDNS используйте имя машины в tailnet. Если короткое имя пересекается с локальным DNS, возьмите полное имя из панели управления.

```bash
tailscale netcheck
tailscale ping ops-server
tailscale status
```

В `status` после обмена трафиком ищите `direct`, `peer-relay` или `relay`. Первые пакеты могут пройти через DERP, пока клиенты проверяют прямой путь. Если ретрансляция сохраняется, запустите `netcheck` с обеих сторон и сравните поведение на двух сетях. Затем отдельно проверьте SSH или HTTPS. Успешный `tailscale ping` показывает связность клиентов и не подтверждает доступность прикладного порта. [Типы соединений](https://tailscale.com/docs/reference/connection-types).

## Grants для SSH и внутренней панели

В новой сети проверьте стартовую политику. Если в ней остался широкий allow-all, более узкое правило его не отменит: разрешения складываются. Пример ниже разрешает группе дежурных обычный OpenSSH и HTTPS к одному адресу за маршрутизатором. Подставьте свою учётную запись, назначьте серверу тег `tag:ops-server` и согласуйте пример с остальной политикой сети. Для встроенного Tailscale SSH требуется отдельная секция `ssh`. [Grants](https://tailscale.com/docs/features/access-control/grants).

```json
{
  "groups": {
    "group:oncall": ["alice@example.com"]
  },
  "tagOwners": {
    "tag:ops-server": ["group:oncall"]
  },
  "grants": [
    {
      "src": ["group:oncall"],
      "dst": ["tag:ops-server"],
      "ip": ["tcp:22"]
    },
    {
      "src": ["group:oncall"],
      "dst": ["172.22.40.20"],
      "ip": ["tcp:443"]
    }
  ]
}
```

В рабочей сети назначьте владельцем тегов группу администраторов инфраструктуры, если дежурные управляют только доступом к ресурсам. Проверьте вход с участником группы и с пользователем без нужных прав. На сервере сохраните проверку SSH-ключей и ограничения host firewall.

## Subnet Router для офисной сети

На выделенном Linux-маршрутизаторе сохраните `net.ipv4.ip_forward = 1` в файле `/etc/sysctl.d/99-tailscale-router.conf` и примените настройки. Узел должен иметь маршрут до панели. Если через него нужен доступ только к одному хосту, можно объявить `/32`.

```bash
sudo sysctl --system
sudo tailscale set --advertise-routes=172.22.40.20/32
```

Одобрите маршрут в консоли или ограничьте его автоматическое одобрение через `autoApprovers`. На Linux-клиенте включите импорт маршрутов.

```bash
sudo tailscale set --accept-routes=true
ip route get 172.22.40.20
curl --connect-timeout 5 --max-time 10 \
  --resolve panel.example.com:443:172.22.40.20 \
  https://panel.example.com/
```

Используйте фактическое имя из сертификата панели. Если маршрут установлен, а запрос зависает, проверьте `forward` на маршрутизаторе и firewall панели. По умолчанию subnet router применяет SNAT, поэтому панель видит источником адрес маршрутизатора. При отключении SNAT на Linux добавьте обратный маршрут до адресов клиентов через этот узел и проверьте правила на принимающей стороне. [Subnet routers](https://tailscale.com/docs/features/subnet-routers).

## Exit Node для интернет-трафика

Exit Node используется для выхода в интернет, а subnet router даёт маршрут до выбранного частного префикса. Для Linux-узла настройте forwarding для IPv4 и IPv6 по документации. После объявления одобрите узел в консоли и проверьте, что политика разрешает нужным пользователям доступ к `autogroup:internet`.

```bash
# На выходном узле
sudo tailscale set --advertise-exit-node

# На клиенте: подставьте адрес одобренного exit node
sudo tailscale set --exit-node=100.100.100.10

# Вернуть обычный выход
sudo tailscale set --exit-node=
```

Проверьте исходящий IP и DNS через свою контрольную точку. Для доступа к локальной LAN клиента при активном exit node есть отдельный флаг `--exit-node-allow-lan-access`. Учитывайте его в политике для публичных Wi-Fi. [Exit nodes](https://tailscale.com/docs/features/exit-nodes).

## Цикл Mesh VPN · 2 из 5

1. [Что такое Mesh VPN и как он работает за NAT](/blog/mesh-vpn-wireguard/)
2. **Tailscale: настройка сети и доступ к подсетям**
3. [Tailscale, ZeroTier и NetBird: сравнение](/blog/zerotier-netbird-tailscale/)
4. [Headscale: собственный сервер координации](/blog/headscale-self-hosted/)
5. [WireGuard на Linux и MikroTik: site-to-site](/blog/wireguard-linux-mikrotik/)
