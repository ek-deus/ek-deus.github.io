---
title: 'Как расширить диск в Linux (Ubuntu/Debian) без downtime: Пошаговый чеклист'
description: 'Инструкция и пошаговый чеклист по расширению диска и LVM в Linux без перезагрузки сервера.'
pubDate: '2026-11-01'
tags: ['linux', 'DevOps', 'LVM', 'Proxmox', 'Ubuntu']
heroImage: ''
---

В продакшене это штатная ситуация: вы увеличили диск на уровне гипервизора (VPS, облако или Proxmox VE), но внутри Ubuntu ничего не изменилось — раздел `/` все так же заполнен на 100%.

Разберем, как правильно «протянуть» расширение до файловой системы, не останавливая сервисы и не перезагружая сервер.

---

## Почему диск не вырос автоматически

Когда вы увеличиваете объем в панели провайдера (Hetzner, Timeweb, Selectel) или в Proxmox (`Hardware` $\rightarrow$ `Disk` $\rightarrow$ `Resize`), вы меняете размер только физического блочного устройства (например, `/dev/sda`).

Внутри Linux сохраняется старая структура:

$$\text{Disk (sda)} \rightarrow \text{Partition (sda3)} \rightarrow \text{LVM PV} \rightarrow \text{LVM VG} \rightarrow \text{LVM LV} \rightarrow \text{Filesystem}$$

Пока вы не пройдете всю цепочку и не обновите каждый уровень, операционная система не увидит новое пространство.

---

##  Чек-лист: Пошаговое расширение диска (без downtime)

###  Этап 1. Подготовка и диагностика

- [ ] **1.1. Проверка бэкапов / снимков (Snapshot)**
  * Сделайте снапшот виртуальной машины в панели провайдера или Proxmox VE. Это ваш главный страховочный полис.
- [ ] **1.2. Фиксация текущей разметки**
  ```bash
  lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT
  df -h
  ```
  *Запишите имя целевого диска (например, `/dev/sda`, `/dev/vda` или `/dev/nvme0n1`) и имя корневого логического тома.*

---

###  Этап 2. Изменение размера на уровне гипервизора

- [ ] **2.1. Увеличение диска в панели управления**
  * В панели хостинга или Proxmox VE укажите новый итоговый размер диска.
- [ ] **2.2. Принудительный рескан диска в ОС (при необходимости)**
  * Если ядро Linux не увидело изменения автоматически, отправьте сигнал пересканирования:
  ```bash
  echo 1 | sudo tee /sys/class/block/sda/device/rescan
  ```
  *(Замените `sda` на имя вашего диска).*

---

### Этап 3. Работа с таблицей разделов (Partition)

- [ ] **3.1. Исправление таблиц GPT (для Proxmox и cloud-образов)**
  * При изменении диска структура GPT требует перемещения резервной копии заголовков в конец нового пространства:
  ```bash
  sudo sgdisk -e /dev/sda
  ```
- [ ] **3.2. Расширение раздела с помощью `growpart`**
  * Установите пакет `cloud-guest-utils` (если он отсутствует) и запустите расширение раздела:
  ```bash
  sudo apt update && sudo apt install -y cloud-guest-utils
  sudo growpart /dev/sda 3
  ```
  > ⚠️ **Важно:** между именем диска (`/dev/sda`) и номером раздела (`3`) обязательно ставится **пробел**.

---

###  Этап 4. Масштабирование LVM и файловой системы

- [ ] **4.1. Расширение LVM Physical Volume (PV)**
  ```bash
  sudo pvresize /dev/sda3
  ```
  *Проверьте появление свободного места командой `sudo pvs`.*
- [ ] **4.2. Расширение Logical Volume (LV) и Файловой системы**
  * Флаг `-r` (`resizefs`) автоматически выполнит адаптацию `ext4` (`resize2fs`) или `XFS` (`xfs_growfs`):
  ```bash
  sudo lvextend -r -l +100%FREE /dev/mapper/ubuntu--vg-ubuntu--lv
  ```

#### Если LVM НЕ используется:
Если система установлена на обычный раздел (например, standard cloud images):
1. `sudo growpart /dev/sda 1`
2. Для `ext4`: `sudo resize2fs /dev/sda1`
3. Для `XFS`: `sudo xfs_growfs /`

---

###  Этап 5. Финальная валидация

- [ ] **5.1. Проверка доступного места**
  ```bash
  lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT
  df -h /
  ```
  *Убедитесь, что корневой раздел `/` отображает обновлённый размер.*

---

##  Частые ошибки в Production

1. **Диск забит на 100% до последнего байта:**  
   Утилита `growpart` может не сработать из-за нехватки временной памяти для записи новой таблицы разделов. Очистите кэш APT перед стартом: `sudo apt clean`.
2. **Ошибки в имени диска:**  
   На различных хостингах и NVMe-накопителях наименования различаются (`/dev/sda`, `/dev/vda`, `/dev/nvme0n1`). Всегда перепроверяйте имя через `lsblk`.
3. **Разрастание логов Docker:**  
   Если диск заполняется слишком быстро, проверьте контейнеры. После расширения диска рекомендуется удалить накопившийся мусор:
   ```bash
   docker system prune -a --volumes
   ```

---

## Автоматизация через Ansible

Для массового управления серверами используйте готовый плейбук:

```yaml
- name: Safe LVM Disk Resize
  hosts: all
  become: true
  tasks:
    - name: Install cloud-guest-utils
      apt:
        name: cloud-guest-utils
        state: present

    - name: Resize target partition
      shell: growpart /dev/sda 3
      register: growpart_result
      failed_when:
        - growpart_result.rc != 0
        - "'NOCHANGE' not in growpart_result.stdout"

    - name: Resize Physical Volume
      command: pvresize /dev/sda3

    - name: Expand Logical Volume and Filesystem
      lvol:
        vg: ubuntu-vg
        lv: ubuntu-lv
        size: +100%FREE
        resizefs: true
```

---

## Итог

Штатная цепочка команд для быстрого расширения диска без перезагрузки:

$$\text{growpart} \longrightarrow \text{pvresize} \longrightarrow \text{lvextend -r}$$