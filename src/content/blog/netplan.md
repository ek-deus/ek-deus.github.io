---
title: 'Netplan: продвинутая настройка сети (туннели, VLAN, мосты, bonding)'
description: 'Практическое руководство по утилите Netplan'
pubDate: '2026-10-09'
tags: ['Netplan', 'DevOps', 'linux', 'monitoring','IPIP', 'GRE', 'VXLAN', 'WireGuard']
heroImage: ''
---

## Введение

**Netplan** — это современная утилита для декларативной настройки сети в дистрибутивах Linux на базе Ubuntu, Debian и их производных. 

Обычно её используют для базовых задач вроде настройки Ethernet или Wi-Fi, однако её возможности гораздо шире и включают в себя:
- Туннельные интерфейсы (`IPIP`, `GRE`, `VXLAN`, `WireGuard`)
- Виртуальные локальные сети (`VLAN`)
- Сетевые мосты (`bridges`)
- Объединение и агрегацию интерфейсов (`bonding`)

Эти инструменты позволяют проектировать сложные сетевые топологии — от домашних защищенных VPN-соединений до высоконагруженных дата-центров и облачных сред.

---

## Туннельные интерфейсы

Туннели инкапсулируют пакеты одного протокола внутри другого. Они активно применяются для построения VPN, организации связей между удаленными серверами или изоляции изолированных сегментов сети.

### IPIP (IP-in-IP)
Простейший туннель для инкапсуляции трафика IPv4 поверх IPv4.

```yaml
network:
  version: 2
  renderer: networkd
  tunnels:
    tun0:
      mode: ipip
      local: 192.168.1.100
      remote: 203.0.113.1
      addresses: [10.0.0.1/30]
      routes:
        - to: 10.0.1.0/24
          via: 10.0.0.2
```

### GRE (Generic Routing Encapsulation)
Более универсальный протокол туннелирования, поддерживающий инкапсуляцию не только IPv4, но и других сетевых протоколов.

```yaml
network:
  version: 2
  renderer: networkd
  tunnels:
    gre0:
      mode: gre
      local: 192.168.1.100
      remote: 203.0.113.1
      addresses: [10.0.0.1/30]
      routes:
        - to: 10.0.2.0/24
          via: 10.0.0.2
```

### VXLAN (Virtual Extensible LAN)
Технология виртуализации сети уровня 2 поверх уровня 3, востребованная в облачных средах. Поддержка VXLAN появилась начиная с Netplan версии `0.105`.

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    enp0s3:
      addresses: [192.168.1.100/24]
  tunnels:
    vxlan0:
      mode: vxlan
      id: 42               # Идентификатор сети VXLAN (VNI), диапазон 1–16777215
      link: enp0s3
      local: 192.168.1.100
      remote: 203.0.113.1  # IP-адрес второй стороны или multicast-группа (например, 239.1.1.1)
      port: 4789           # Стандартный UDP-порт VXLAN
      addresses: [10.0.0.1/24]
```

> **Важные нюансы:**
> - Отдельного ключа для настройки multicast-группы в Netplan не предусмотрено — адрес группы указывается прямо в параметре `remote`.
> - Физический или базовый интерфейс, указанный в ключе `link`, обязательно должен быть предварительно описан в том же конфигурационном файле (в блоке `ethernets`), иначе команда `netplan generate` завершится ошибкой.

### WireGuard
Современный и высокопроизводительный VPN-протокол (поддержка встроена начиная с Netplan `0.100`).

```yaml
network:
  version: 2
  renderer: networkd
  tunnels:
    wg0:
      mode: wireguard
      port: 51820
      addresses: [10.0.0.2/24]
      key: /etc/wireguard/private.key   # Закрытый ключ (base64) либо путь к файлу с ним
      peers:
        - keys:
            public: <remote-public-key>
          endpoint: 203.0.113.1:51820
          allowed-ips: [0.0.0.0/0]
          keepalive: 25
```

> **Особенности синтаксиса:**
> - Закрытый ключ задается через параметр `key` (или `keys: private:`).
> - Открытый ключ удаленного пира указывается как `keys: public:`, а интервал поддержания соединения — через `keepalive`.
> - Привычные по утилите `wg-quick` параметры `private-key`, `public-key` и `persistent-keepalive` в Netplan **не поддерживаются** — их использование вызовет ошибку генерации.
> - Путь к файлу ключа поддерживается начиная с `systemd-networkd` версии 242. Замените `<remote-public-key>` на реальный ключ второй стороны в формате base64.

---

## VLAN (Virtual LAN)

Разделение физического сетевого трафика на логические сегменты при помощи тегов VLAN ID.

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    enp0s3:
      dhcp4: no
  vlans:
    vlan10:
      id: 10
      link: enp0s3
      addresses: [192.168.10.100/24]
      routes:
        - to: default
          via: 192.168.10.1
```

---

## Мосты (Bridges)

Сетевые мосты объединяют несколько физических или виртуальных интерфейсов в единый коммутируемый сегмент сети (L2).

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    enp0s3: { dhcp4: no }
    enp0s8: { dhcp4: no }
  bridges:
    br0:
      interfaces: [enp0s3, enp0s8]
      addresses: [192.168.1.100/24]
      routes:
        - to: default
          via: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
```

---

## Bonding (Связка интерфейсов)

Технология агрегации каналов связи используется для повышения отказоустойчивости (failover) или увеличения общей пропускной способности.

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    enp0s3: { dhcp4: no }
    enp0s8: { dhcp4: no }
  bonds:
    bond0:
      interfaces: [enp0s3, enp0s8]
      addresses: [192.168.1.100/24]
      routes:
        - to: default
          via: 192.168.1.1
      parameters:
        mode: 802.3ad                # Режим LACP (требуется поддержка и настройка на коммутаторе)
        transmit-hash-policy: layer3+4
        mii-monitor-interval: 100    # Интервал проверки состояния линий связи (в миллисекундах)
```

---

## Заключение

Конфигурация сложных сетей через Netplan избавляет администратора от ручного использования запутанных скриптов инициализации и устаревших утилит (`ifupdown`, `network-scripts`). Применяя декларативный подход, вы получаете единый источник правды для сетевой подсистемы вашего Linux-сервера, легко масштабируемый и готовый к автоматизации через Ansible или Terraform.
