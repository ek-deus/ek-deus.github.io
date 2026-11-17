---
title: 'Headscale: настройка собственного сервера для клиентов Tailscale'
description: 'Как развернуть Headscale на Linux, настроить HTTPS, зарегистрировать клиент Tailscale и проверить политики, DERP, резервное копирование и совместимость.'
pubDate: '2026-11-17'
tags: ['Mesh VPN', 'WireGuard', 'VPN', 'Headscale', 'Tailscale', 'Self-hosted', 'linux', 'DevOps']
---

Headscale — независимая реализация control plane для клиентов Tailscale. Она рассчитана на одну tailnet. Подходит, когда нужно самостоятельно хранить состояние сети и управлять регистрацией устройств. Клиенты по-прежнему используют WireGuard и могут обмениваться данными напрямую.

## Headscale, NetBird или WireGuard вручную

| Вариант | Когда подходит | Что проверить |
| --- | --- | --- |
| Headscale | Уже используются клиенты Tailscale, нужен свой control plane | Совместимость версий и функций, DERP, правила регистрации |
| NetBird self-hosted | Нужна штатная веб-панель и управление частными ресурсами | Компоненты управления, IdP, relay и маршруты |
| WireGuard вручную | Несколько площадок и предсказуемые endpoint | Ротацию ключей, адресацию и распространение конфигураций |

Миграция с облачного Tailscale требует зарегистрировать устройства на новом control plane и проверить маршруты, политики и DNS. Сначала переведите отдельный тестовый клиент. Держите административный доступ к шлюзам через независимый канал.

## Подготовка сервера Headscale

1. Выберите релиз Headscale и проверьте минимальную версию Tailscale по его release notes. Включите в тесты клиенты на NAS, мобильных устройствах и Linux. [Релизы Headscale](https://github.com/juanfont/headscale/releases), [совместимость функций](https://headscale.net/stable/about/features/).
2. Установите пакет или контейнер из документации к этому релизу. Возьмите пример конфигурации той же версии. Задайте `server_url` с HTTPS и настройте TLS на Headscale либо на reverse proxy. Имя должно разрешаться ещё до подключения клиента к mesh. [Официальные пакеты](https://headscale.net/stable/setup/install/official/), [TLS](https://headscale.net/stable/ref/tls/).
3. Если используете reverse proxy, оставьте backend доступным только прокси и проверьте поддержку upgrade соединения по документации проекта. Метрики и административные интерфейсы держите в управляющем сегменте. [Reverse proxy](https://headscale.net/stable/ref/integration/reverse-proxy/).
4. Настройте DNS-домен tailnet, политику с точечными разрешениями и способ регистрации. Для команды можно использовать OIDC, а для пилота достаточно локального пользователя и ручного подтверждения каждого узла. [Политики Headscale](https://headscale.net/stable/ref/policy/), [OIDC](https://headscale.net/stable/ref/oidc/).

При пакетной установке с systemd проверьте запуск и доступность HTTPS из внешней сети клиента.

```bash
sudo systemctl status headscale --no-pager
sudo journalctl -u headscale -n 50 --no-pager
curl --silent --show-error --output /dev/null \
  --write-out 'HTTP %{http_code}\n' --max-time 10 https://headscale.example.com/
```

HTTP-ответ на корневой URL проверяет DNS, TLS и доступность веб-сервера. Готовность к работе проверяется регистрацией клиента и обменом трафиком между двумя узлами.

## Регистрация устройств

На сервере Headscale создайте локального пользователя, если его ещё нет. На новом Linux-клиенте укажите URL своего control plane.

```bash
# Сервер Headscale
sudo headscale users create office

# Клиент Tailscale
sudo tailscale up --login-server=https://headscale.example.com
```

Страница регистрации покажет Auth ID. На сервере введите его в переменную и выполните подтверждение.

```bash
read -r auth_id
sudo headscale auth register --user office --auth-id "$auth_id"
sudo headscale nodes list
unset auth_id
```

Для автоматизации регистрации используйте короткоживущие одноразовые pre-auth keys. В актуальной документации Headscale ключ для персонального узла создаётся через `headscale preauthkeys create --user office`. Для сервисных устройств доступны ключи с тегами. Передавайте их через хранилище секретов, а в CI исключите печать ключа в лог и shell tracing. [Способы регистрации](https://headscale.net/stable/ref/registration/).

После подключения второго устройства запустите `tailscale ping <имя-узла>` и `tailscale status`. Проверьте реальный порт сервиса с разрешённой учётной записью и повторите с учётной записью без доступа.

## DERP, резервное копирование и обновления

Собственный control plane и собственная ретрансляция настраиваются отдельно. Проверьте, откуда клиенты получают карту DERP и какие relay в неё входят. Если зависимость от внешнего DERP недопустима, настройте свои ретрансляторы, исключите внешнюю карту и проверьте связь в сети, где прямое UDP-соединение недоступно. Один встроенный DERP на том же хосте разделяет с Headscale его область отказа. [DERP в Headscale](https://headscale.net/stable/ref/derp/).

В резервную копию включите согласованное состояние базы, конфигурацию, файлы политик и серверные ключи согласно используемой конфигурации. Для SQLite используйте согласованный snapshot или механизм online backup. Проверьте восстановление на отдельной машине и повторное подключение ранее зарегистрированного клиента. Перед обновлением изучите миграции базы и требования к клиентам. Для отката держите копию состояния до миграции. [Обновление Headscale](https://headscale.net/stable/setup/upgrade/).

## Цикл Mesh VPN · 4 из 5

1. [Что такое Mesh VPN и как он работает за NAT](/blog/mesh-vpn-wireguard/)
2. [Tailscale: настройка сети и доступ к подсетям](/blog/tailscale-mesh-vpn/)
3. [Tailscale, ZeroTier и NetBird: сравнение](/blog/zerotier-netbird-tailscale/)
4. **Headscale: собственный сервер координации**
5. [WireGuard на Linux и MikroTik: site-to-site](/blog/wireguard-linux-mikrotik/)
