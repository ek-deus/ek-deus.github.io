---
title: 'curl: первый шаг в мир HTTP-запросов'
description: 'curl для начинающих: подробное руководство по работе с HTTP/HTTPS запросами, API, файлами, таймингами и отладкой.'
pubDate: '2026-10-06'
tags: ['lan', 'DevOps', 'linux', 'monitoring', 'curl','HTTP', 'SMTP', 'IMAP', 'API']
heroImage: ''
---

`curl` - утилита командной строки для передачи данных по URL. Она отправляет запрос серверу и показывает ответ: HTML-страницу, JSON от API, заголовки или файл. Название расшифровывается как *Client URL*. Кроме HTTP и HTTPS, `curl` поддерживает FTP, SFTP, SMTP, IMAP и десятки других протоколов.

`curl` доступен почти в любой дистрибутиве Linux, macOS, а также входит в стандартную поставку Windows 10 и 11.

Его активно используют, чтобы:
* Проверять API и веб-сервисы без браузера;
* Скачивать и загружать файлы в скриптах и CI/CD;
* Проверять доступность сайтов, цепочки редиректов и SSL/TLS-сертификаты;
* Выяснять, на каком этапе теряется время при загрузке страницы;
* Отправлять тестовые письма через SMTP и отлаживать почтовые сервисы.

---

### Первый запрос

Без параметров `curl` выполняет стандартный GET-запрос и выводит тело ответа в терминал:

```bash
curl [https://example.com](https://example.com)
```

---

### Основные флаги

Ниже приведены самые частые параметры `curl` с описаниями согласно официальному руководству:

| Флаг | Что делает |
| --- | --- |
| **`-s`**, `--silent` | Не показывать индикатор прогресса и сообщения об ошибках. |
| **`-S`**, `--show-error` | Используется вместе с `-s`: всё же показать сообщение, если запрос завершился ошибкой. |
| **`-L`**, `--location` | Автоматически следовать редиректам (3xx). |
| **`-I`**, `--head` | Получить только заголовки ответа (отправляет HTTP-запрос `HEAD`). |
| **`-i`**, `--include` | Вывести заголовки ответа вместе с телом. |
| **`-v`**, `--verbose` | Подробный вывод: рукопожатие TLS, заголовки запроса (`>`) и ответа (`<`). |
| **`-o файл`** | Сохранить ответ в файл с указанным именем. |
| **`-O`** | Сохранить файл под именем, взятым из URL. |
| **`-X метод`** | Задать HTTP-метод запроса: `POST`, `PUT`, `DELETE` и др. |
| **`-H "Заголовок: значение"`** | Добавить HTTP-заголовок. |
| **`-d данные`** | Отправить данные методом `POST` (`application/x-www-form-urlencoded`). |
| **`--data-urlencode`** | То же, что `-d`, но с автоматическим URL-кодированием спецсимволов. |
| **`--json данные`** | Отправить JSON: автоматически выставляет `Content-Type` и `Accept: application/json`. |
| **`-F "field=@file"`** | Отправить данные как `multipart/form-data` (для загрузки файлов через форму). |
| **`-u user:pass`** | Логин и пароль для HTTP Basic Authentication. |
| **`-f`**, `--fail` | При ответе HTTP 400 и выше завершиться с кодом `22` и не выводить тело ошибки. |
| **`--retry N`** | Повторить запрос при временных сетевых ошибках (до N раз). |
| **`-w формат`** | Вывести служебные данные после выполнения (код ответа, время этапов). |
| **`-m`**, `--max-time` | Ограничить максимальное время выполнения всей операции (в секундах). |
| **`--connect-timeout`** | Ограничить время ожидания только этапа установки соединения. |
| **`-x адрес`** | Отправить запрос через прокси-сервер. |
| **`-k`**, `--insecure` | Отключить проверку TLS/SSL-сертификата сервера. |

> ⚠️ **Предупреждение:** Флаг `-k` делает соединение уязвимым к атакам типа Man-in-the-Middle (MitM). Используйте его только для отладки на локальных стендах. На боевых серверах вместо `-k` передавайте правильный сертификат через `--cacert /path/to/ca.crt`.

#### Лучшие практики комбинаций в скриптах:

* **`curl -sS`** - скрывает шумный прогресс-бар, но выведет текстовую ошибку, если упадет сеть.
* **`curl -fsSL`** - «золотой стандарт» для скачивания в автоматизациях: следом за редиректами, без прогресса, с выводом ошибок и с ненулевым кодом выхода при статусах HTTP 4xx/5xx.

---

### Заголовки и редиректы

Посмотреть только заголовки ответа (без тела):

```bash
curl -I [https://example.com](https://example.com)
```

Проследить всю цепочку редиректов и увидеть заголовки каждого шага:

```bash
curl -sIL [http://example.com](http://example.com)
```

Отладка соединения, рукопожатия TLS и заголовков (тело ответа сбрасывается в `/dev/null`):

```bash
curl -v [https://example.com](https://example.com) -o /dev/null
```

---

### Работа с API

#### 1. GET-запрос с авторизацией

```bash
curl -s -H "Authorization: Bearer $TOKEN" [https://api.example.com/v1/items](https://api.example.com/v1/items)

```

#### 2. POST-запрос с данными формы

```bash
curl -d "name=mike&age=30" [https://api.example.com/register](https://api.example.com/register)
```

*(При указании флага `-d` утилита подставляет метод `POST` автоматически - добавлять `-X POST` не требуется).*

#### 3. POST-запрос с JSON

В современных версиях `curl` (начиная с v7.82.0):

```bash
curl --json '{"name": "mike", "age": 30}' [https://api.example.com/users](https://api.example.com/users)
```

В более старых версиях:

```bash
curl -H "Content-Type: application/json" -d '{"name": "mike", "age": 30}' [https://api.example.com/users](https://api.example.com/users)
```

#### 4. Отправка больших JSON-файлов

Если JSON слишком крупный для ввода в командную строку, используйте символ `@`:

```bash
curl -H "Content-Type: application/json" -d @payload.json [https://api.example.com/users](https://api.example.com/users)
```

#### 5. PUT и DELETE

```bash
curl -X PUT --json '{"age": 31}' [https://api.example.com/users/42](https://api.example.com/users/42)
curl -X DELETE [https://api.example.com/users/42](https://api.example.com/users/42)
```

#### 6. Чтение и форматирование JSON-ответов

Для удобного просмотра JSON в терминале результат передают в утилиту `jq`:

```bash
curl -s [https://api.example.com/v1/items](https://api.example.com/v1/items) | jq .
```

#### 7. Базовая аутентификация (Basic Auth)

```bash
curl -u admin:password [https://example.com/admin/](https://example.com/admin/)
```

> **Совет:** Чтобы пароль не сохранялся в истории bash (`.bash_history`), укажите только имя пользователя: `curl -u admin https://example.com/admin/`. Утилита запросит пароль интерактивно.

---

### Работа с файлами и сессиями (Cookies)

```bash
# Сохранить с именем файла из URL
curl -O [https://example.com/file.zip](https://example.com/file.zip)

# Сохранить под собственным именем
curl -o backup.zip [https://example.com/file.zip](https://example.com/file.zip)

# Загрузка файла через HTML-форму (multipart/form-data)
curl -F "file=@report.pdf" [https://example.com/upload](https://example.com/upload)

# Загрузка файла бинарным потоком через HTTP PUT
curl -T report.pdf [https://example.com/files/report.pdf](https://example.com/files/report.pdf)

# Сохранить Cookies в файл после авторизации
curl -c cookies.txt -d "user=admin&pass=secret" [https://example.com/login](https://example.com/login)

# Отправить сохраненные Cookies при следующем запросе
curl -b cookies.txt [https://example.com/dashboard](https://example.com/dashboard)
```

---

### Измерение времени и сетевая диагностика

Флаг `-w` (`--write-out`) позволяет выводить метрики производительности запроса. Это помогает сразу определить, на каком этапе возникают задержки:

```bash
curl -o /dev/null -s -w "DNS: %{time_namelookup}s\nTCP: %{time_connect}s\nTLS: %{time_appconnect}s\nTTFB (Первый байт): %{time_starttransfer}s\nВсего: %{time_total}s\nHTTP Code: %{http_code}\n" [https://example.com](https://example.com)
```

**Интерпретация результатов:**

* Высокое время **DNS** (`time_namelookup`) - проблемы с системным резолвером или DNS-сервером.
* Высокий **TTFB** (`time_starttransfer`) при быстром TCP/TLS - долгая обработка запроса на стороне самого веб-приложения или базы данных.

Быстрая проверка HTTP-кода ответа для мониторинга:

```bash
curl -s -o /dev/null -w "%{http_code}\n" [https://example.com](https://example.com)
```

---

### Таймауты, повторы, прокси и `--resolve`

```bash
# Ограничение времени: не больше 5 сек на подключение, не больше 20 сек на весь запрос
curl --connect-timeout 5 -m 20 [https://example.com](https://example.com)

# Автоматический повтор запроса при сбоях (3 попытки)
curl --retry 3 [https://example.com](https://example.com)

# Запрос через HTTP или SOCKS5 прокси
curl -x [http://proxy.example.com:3128](http://proxy.example.com:3128) [https://example.com](https://example.com)
curl -x socks5h://127.0.0.1:1080 [https://example.com](https://example.com)
```

> **Примечание:** Префикс `socks5h://` указывает `curl` резолвить доменное имя на стороне прокси-сервера, а не на локальной машине (защита от утечек DNS).

#### Тестирование сервера в обход DNS (`--resolve`)

Позволяет направить запрос на конкретный IP-адрес без изменения файла `/etc/hosts`:

```bash
curl --resolve example.com:443:192.0.2.10 [https://example.com](https://example.com)
```

---

### Почтовые протоколы (SMTP / IMAP)

#### Отправка письма через SMTP

```bash
curl --url "smtp://smtp.example.com:587" \
  --ssl-reqd \
  --mail-from "sender@example.com" \
  --mail-rcpt "recipient@example.com" \
  --upload-file email.txt \
  --user "username:password"
```

* `--ssl-reqd` - требовать защищенное соединение (STARTTLS);
* `--upload-file` - текстовый файл с заголовками (`From`, `To`, `Subject`) и телом письма.

#### Просмотр почтовых папок через IMAP

```bash
curl --url "imaps://imap.example.com" \
  --user "username:password" \
  -X 'LIST "" "*"'
```

---

### Типичные ошибки и как их избежать

1. **Забытый `-L` при редиректах.** Сервер возвращает ответ 301/302, а `curl` выводит пустую страницу или уведомление «Moved Permanently».
2. **Пароли и ключи в открытом виде.** Использование `-u user:pass` или `-H "Authorization: Bearer KEY"` оставляет токены в историй консоли (`.bash_history`) и выводе `ps aux`. Передавайте их через переменные окружения или из файла с ограничением прав доступа.
3. **Отсутствие `-f` в bash-скриптах.** Без `-f` ошибки `404 Not Found` или `500 Internal Server Error` возвращают код выхода `0` (успех), из-за чего скрипт продолжает исполнение с текстом ошибки вместо реальных данных.
4. **Небезопасное использование `-k`.** Отключение проверки сертификатов на продакшн-серверах создает брешь в безопасности. Правильный путь - подключение корневого сертификата через параметр `--cacert`.

---

#### Итог

`curl` - универсальный и незаменимый инструмент в арсенале любого специалиста. Он легко комбинируется со стандартными Linux-утилитами (`grep`, `jq`, `sed`, `awk`) и гибко настраивается под любые задачи автоматизации.

Дополнительные материалы:

* О поиске причин задержек и отладке запросов - в статье **«Отладка HTTP с curl»**.
* Подробно про проверку сертификатов и шифрования - в статье **«Отладка TLS: curl и openssl s_client»**.
