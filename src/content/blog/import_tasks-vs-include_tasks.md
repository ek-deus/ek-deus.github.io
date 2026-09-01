---
title: '`import_tasks` vs `include_tasks` в Ansible'
description: '`import_tasks` vs `include_tasks` в Ansible'
pubDate: '2026-06-22'
tags: ['import_tasks', 'DevOps', 'sobes', 'include_tasks','Ansible']
heroImage: ''
---


# import_tasks vs `nclude_tasks в Ansible

## Ключевое различие

Разница **фундаментальная** и сводится к моменту, когда Ansible обрабатывает включаемый файл:

| Характеристика | `import_tasks` | `include_tasks` |
|---|---|---|
| **Тип** | Статический (pre-processor) | Динамический (runtime) |
| **Когда парсится** | При загрузке playbook'а | В момент выполнения задачи |
| **Модель** | "Вставь содержимое файла сюда" (как `#include` в C) | "Выполни файл как отдельную задачу" |
| **В `--list-tasks`** | Видны все внутренние задачи | Видна только одна задача `include` |
| **Поддержка `when`** | Условие применяется к каждой задаче | Условие применяется ко всему include |
| **Поддержка `loop`** | ❌ Не поддерживается напрямую | ✅ Работает как обычная задача |
| **Поддержка `tags`** | Наследуются всеми внутренними задачами | Только сам include (если не `apply:`) |
| **Переменные из `vars`/`host_vars`** | Доступны на этапе парсинга | Доступны только на этапе выполнения |
| **Можно использовать переменные в имени файла** | ❌ Нет | ✅ Да |

---

## Когда что выбирать

### Выбирай `import_tasks`, когда:

**1. Структура playbook'а фиксирована** — ты заранее знаешь, какие задачи всегда будут выполняться.

```yaml
# site.yml
- hosts: all
  tasks:
    - import_tasks: tasks/setup_base.yml
    - import_tasks: tasks/setup_monitoring.yml
    - import_tasks: tasks/setup_security.yml
```

**2. Нужна работа с тегами на уровне отдельных внутренних задач.**

```yaml
# tasks/setup_base.yml
- name: Install nginx
  apt: name=nginx
  tags: web

- name: Configure firewall
  ufw: rule=allow port=80
  tags: firewall

# При запуске:
# ansible-playbook site.yml --tags firewall
# → выполнится ТОЛЬКО задача Configure firewall,
#   потому что import_tasks "раскрывается" до парсинга
```

**3. Нужны `notify`/`handlers`, определённые во включаемом файле.**

```yaml
# handlers определены внутри import_tasks и доступны глобально
- import_tasks: tasks/with_handlers.yml
```

**4. Используется `block`/`rescue`/`always` внутри включаемого файла** — статический импорт корректно обработает эту структуру.

---

### Выбирай `include_tasks`, когда:

**1. Имя файла зависит от переменной** (самый частый кейс).

```yaml
- name: Include OS-specific tasks
  include_tasks: "tasks/{{ ansible_facts.os_family }}.yml"
  # На Debian → tasks/Debian.yml
  # На RedHat → tasks/RedHat.yml
  # С import_tasks это НЕ сработает — переменная ещё не вычислена
```

**2. Нужен цикл по списку файлов.**

```yaml
- name: Apply configs for each service
  include_tasks: tasks/apply_config.yml
  loop:
    - { service: nginx,  config: nginx.conf }
    - { service: postgres, config: pg_hba.conf }
  loop_control:
    loop_var: item

# tasks/apply_config.yml:
# - template:
#     src: "{{ item.config }}.j2"
#     dest: "/etc/{{ item.service }}/{{ item.config }}"
```

**3. Условное включение файла целиком.**

```yaml
- name: Setup monitoring only on prod
  include_tasks: tasks/monitoring.yml
  when: env == 'production'
  # Весь файл пропустится, если условие ложно
  # С import_tasks условие применится к КАЖДОЙ задаче внутри —
  # это медленнее и может дать неожиданный результат
```

**4. Файл генерируется динамически** (например, через `set_fact` или `template` в рантайме).

```yaml
- set_fact:
    dynamic_file: "/tmp/generated_{{ inventory_hostname }}.yml"

- template:
    src: task_template.yml.j2
    dest: "{{ dynamic_file }}"

- include_tasks: "{{ dynamic_file }}"
```

---

## Взаимодействие с циклами (`loop`)

Это **самое важное практическое различие**.

### ❌ `import_tasks` + `loop` = ошибка или неожиданное поведение

```yaml
# НЕ РАБОТАЕТ как ожидается
- import_tasks: tasks/deploy.yml
  loop:
    - app1
    - app2
```

Ansible **проигнорирует `loop`** на `import_tasks`, потому что импорт происходит до выполнения. В старых версиях Ansible это вызывало ошибку, в новых — `loop` просто не применяется.

### ✅ `include_tasks` + `loop` = штатный режим работы

```yaml
- include_tasks: tasks/deploy.yml
  loop:
    - app1
    - app2
  loop_control:
    loop_var: app_name

# tasks/deploy.yml:
- name: "Deploy {{ app_name }}"
  copy:
    src: "{{ app_name }}/"
    dest: "/opt/{{ app_name }}"
```

Каждая итерация цикла **повторно выполняет** включаемый файл с новой переменной `app_name`.

> **Нюанс:** `loop_control` с `include_tasks` работает, но есть ограничение — нельзя использовать `pause` внутри loop'а для include.

---

## Взаимодействие с тегами (`--tags`)

### `import_tasks` — теги наследуются

```yaml
# main.yml
- import_tasks: tasks/web.yml
  tags: web_tier

# tasks/web.yml:
- name: Install nginx        # ← автоматически получает тег web_tier
  apt: name=nginx

- name: Start nginx          # ← тоже получает web_tier
  service: name=nginx state=started
```

```bash
ansible-playbook main.yml --tags web_tier
# → выполнятся ОБЕ задачи из web.yml
```

### `include_tasks` — теги НЕ наследуются (по умолчанию)

```yaml
# main.yml
- include_tasks: tasks/web.yml
  tags: web_tier

# tasks/web.yml:
- name: Install nginx        # ← НЕ получает тег web_tier!
  apt: name=nginx
```

```bash
ansible-playbook main.yml --tags web_tier
# → выполнится только сам include, но внутренние задачи — НЕТ
#   потому что у них нет тега web_tier
```

### Как заставить `include_tasks` наследовать теги — `apply:`

```yaml
- include_tasks: tasks/web.yml
  tags: web_tier
  apply:
    tags: web_tier     # ← принудительно применяет тег ко всем внутренним задачам
```

То же самое работает для `when`, `become`, `vars` и других атрибутов:

```yaml
- include_tasks: tasks/web.yml
  apply:
    become: yes
    tags: web_tier
    when: ansible_os_family == "Debian"
```

---

## Сводная таблица поведения

| Сценарий | `import_tasks` | `include_tasks` |
|---|---|---|
| `--tags web` | ✅ Все внутренние задачи выполнятся | ❌ Только сам include (без `apply:`) |
| `loop: [a, b]` | ❌ Не работает | ✅ Файл выполнится дважды |
| `when: condition` | Условие на каждой задаче | Условие на весь include |
| Имя файла из переменной | ❌ Ошибка | ✅ Работает |
| `--list-tasks` | Видны все задачи | Видна одна строка `include` |
| Скорость выполнения | Быстрее (один парсинг) | Медленнее (парсинг на каждую итерацию) |
| `notify` handler'ов | ✅ Работает | ⚠️ Ограниченно |

---

## Практическое правило

> **По умолчанию используй `import_tasks`** — он предсказуем, быстр и ведёт себя как "вставка кода".
>
> **Переключайся на `include_tasks`**, когда нужна динамика: переменные в имени файла, циклы, условное включение целых блоков.

Если сомневаешься — задай себе вопрос: *"Мне нужно, чтобы этот файл выполнялся несколько раз с разными параметрами, или его содержимое всегда одно и то же?"* Если первое — `include`, если второе — `import`.
