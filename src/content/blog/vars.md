---
title: 'Приоритет переменных'
description: 'Приоритеты переменных'
pubDate: '2026-06-22'
tags: ['linux', 'DevOps', 'sobes', 'ansible', 'var','kubernetes']
heroImage: ''
---

---

Приоритет переменных

### Какое значение примет `app_port` на хосте web01?

**Ответ: `9000`**

Флаг CLI (`-e` / `--extra-vars`) имеет **наивысший приоритет** в системе переменных Ansible и переопределяет все остальные источники.

---

### Порядок возрастания приоритета (от слабого к сильному)

```
┌─────────────────────────────────────────────────────────────┐
│  1. defaults/main.yml (роль)        →  80    [слабейший]   │
│  2. group_vars/all.yml              →  8080                 │
│  3. host_vars/web01.yml             →  8000                 │
│  4. CLI: -e "app_port=9000"         →  9000  [сильнейший]   │
└─────────────────────────────────────────────────────────────┘
```

---

### Полная таблица приоритетов переменных в Ansible

Для справки — полный порядок (от низшего к высшему), если интересно, что ещё может переопределить переменную:

| # | Источник | Пример |
|---|---|---|
| 1 | Role defaults | `defaults/main.yml` |
| 2 | Inventory file vars | `inventory.ini` в секции `[all:vars]` |
| 3 | Inventory group_vars | `group_vars/all.yml` |
| 4 | Inventory host_vars | `host_vars/web01.yml` |
| 5 | Playbook `host_vars` | `host_vars/` рядом с плейбуком |
| 6 | Playbook `group_vars` | `group_vars/` рядом с плейбуком |
| 7 | Play `vars` | `- hosts: all` → `vars:` |
| 8 | Play `vars_files` | `vars_files: [secrets.yml]` |
| 9 | Role `vars` | `roles/x/vars/main.yml` |
| 10 | Block/task `vars` | `vars:` внутри блока |
| 11 | Include/Import vars | Переменные из включённых файлов |
| 12 | `set_fact` / `register` | Динамические переменные в рантайме |
| 13 | **Extra vars (CLI `-e`)** | **Всегда побеждает** |

> **Правило:** `extra_vars` — это "override для экстренных случаев". Именно поэтому в продакшене критичные настройки (версии, флаги фичей) лучше задавать в `group_vars`/`host_vars`, а не надеяться, что их не перекроют через CLI.
