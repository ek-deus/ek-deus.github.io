---
title: 'Секреты в CI/CD'
description: 'Аварийное восстановление etcd-кластера'
pubDate: '2026-06-22'
tags: ['linux', 'DevOps', 'sobes', 'ansible', 'CI/CD','secret']
heroImage: ''
---


## Секреты в CI/CD

### Подход 1: Ansible Vault + пароль из секрета CI/CD (рекомендуемый)

**Суть:** Секреты зашифрованы в репозитории через `ansible-vault`, пароль от vault хранится в секретах CI/CD-системы.

```bash
# 1. Шифруем файл с секретами (локально, один раз)
ansible-vault encrypt group_vars/prod/secrets.yml
# Вводим пароль → файл шифруется и коммитится в git

# 2. В GitLab CI (.gitlab-ci.yml):
deploy:
  script:
    - echo "$ANSIBLE_VAULT_PASSWORD" > /tmp/.vault_pass
    - ansible-playbook site.yml \
        --vault-password-file /tmp/.vault_pass
    - rm -f /tmp/.vault_pass   # ← обязательно удаляем!
  variables:
    ANSIBLE_VAULT_PASSWORD: "$ANSIBLE_VAULT_PASSWORD"  # из CI/CD Secrets
```

```yaml
# 3. В GitHub Actions:
- name: Deploy
  env:
    VAULT_PASS: ${{ secrets.ANSIBLE_VAULT_PASSWORD }}
  run: |
    echo "$VAULT_PASS" > /tmp/.vault_pass
    ansible-playbook site.yml --vault-password-file /tmp/.vault_pass
    rm -f /tmp/.vault_pass
```

**Плюсы:**
- Секреты зашифрованы прямо в git → версионируются
- Можно безопасно ревьюить PR (видно, что файл менялся, но не содержимое)
- Один пароль → легко ротировать

---

### Подход 2: Переменные окружения + `no_log` (без Vault)

**Суть:** Секреты хранятся только в CI/CD Secrets, передаются через environment variables, в плейбуке защищаются через `no_log: true`.

```yaml
# playbook.yml
- hosts: app_servers
  tasks:
    - name: Deploy application with DB credentials
      template:
        src: app.env.j2
        dest: /opt/app/.env
      vars:
        db_password: "{{ lookup('env', 'DB_PASSWORD') }}"
        api_key: "{{ lookup('env', 'API_KEY') }}"
      no_log: true   # ← КРИТИЧНО: скрывает вывод задачи из логов
```

```yaml
# .gitlab-ci.yml
deploy:
  script:
    - ansible-playbook site.yml
  variables:
    DB_PASSWORD: "$DB_PASSWORD"   # из GitLab CI/CD → Variables (masked)
    API_KEY: "$API_KEY"
```

**Плюсы:**
- Не нужно шифровать файлы в git
- Проще для небольших проектов

**Минусы:**
- Секреты не версионируются
- Легко забыть `no_log: true` → утечка в логи

---

### Подход 3 (бонус): HashiCorp Vault / AWS Secrets Manager как backend

Для enterprise-уровня — Ansible читает секреты напрямую из внешнего vault:

```yaml
- name: Get DB password from HashiCorp Vault
  set_fact:
    db_password: "{{ lookup('hashi_vault', 'secret=prod/db password token={{ vault_token }}') }}"
  no_log: true
```

Токен для доступа к Vault — единственная переменная, которую нужно передать через CI/CD Secrets.

---

### Как избежать утечки секретов в логи

Это **критически важная часть**, потому что даже если секрет передан безопасно, он может "засветиться" в stdout CI/CD.

#### 1. `no_log: true` на задачах с секретами

```yaml
- name: Create user with password
  user:
    name: app
    password: "{{ db_password | password_hash('sha512') }}"
  no_log: true   # ← Ansible заменит вывод на "Output has been hidden"
```

#### 2. `no_log` на уровне всего play

```yaml
- hosts: all
  no_log: true   # ← Весь play не будет логировать детали
  tasks:
    - ...
```

#### 3. Callback-плагин для фильтрации

```ini
# ansible.cfg
[defaults]
callback_whitelist = yaml
# Или используем кастомный callback, который маскирует переменные
```

#### 4. Маскирование переменных в CI/CD

**GitLab CI:**
```yaml
# В настройках проекта → CI/CD → Variables
# Ставим галочку "Mask variable" → значение не попадёт в job log
```

**GitHub Actions:**
```yaml
# Секреты автоматически маскируются в логах
# Но если выведешь их через echo — будут видны
- run: echo "$SECRET"   # ← ПЛОХО, GitHub замаскирует, но лучше не рисковать
```

#### 5. Отключаем `--verbose` в продакшене

```bash
# ❌ ПЛОХО — в verbose-режиме могут выводиться значения переменных
ansible-playbook site.yml -vvv

# ✅ ХОРОШО — минимальный вывод
ansible-playbook site.yml
# Или:
ANSIBLE_STDOUT_CALLBACK=minimal ansible-playbook site.yml
```

#### 6. Фильтрация логов на уровне CI/CD

```yaml
# GitLab CI — можно использовать after_script для очистки
deploy:
  script:
    - ansible-playbook site.yml 2>&1 | tee deploy.log
    - sed -i 's/password=.*/password=***REDACTED***/g' deploy.log
  after_script:
    - rm -f /tmp/.vault_pass
```

---

### Сводная таблица подходов

| Подход | Где хранятся секреты | Сложность | Безопасность |
|---|---|---|---|
| **Vault + CI/CD secret** | Зашифрованы в git + пароль в CI/CD | Средняя | ⭐⭐⭐⭐⭐ |
| **Env vars + `no_log`** | Только в CI/CD Secrets | Низкая | ⭐⭐⭐ |
| **HashiCorp Vault backend** | Внешний vault | Высокая | ⭐⭐⭐⭐⭐ |
| **AWS Secrets Manager** | AWS | Средняя | ⭐⭐⭐⭐ |

---

### Мой выбор для продакшена

**Ansible Vault + пароль из CI/CD Secrets + `no_log: true` на всех задачах с секретами + маскирование переменных в GitLab/GitHub.**

Это даёт:
- ✅ Секреты версионируются (в зашифрованном виде)
- ✅ Пароль от vault — одна короткая строка в CI/CD
- ✅ Даже если кто-то забудет `no_log`, маскирование в CI/CD подстрахует
- ✅ Легко ротировать: пересоздал vault-файл с новым паролем → обновил секрет в CI/CD
