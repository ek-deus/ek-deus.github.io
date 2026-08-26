---
title: 'Мониторинг кластеров Kubernetes.'
description: 'Мониторинг кластеров Kubernetes.'
pubDate: '2026-08-27'
tags: ['inKubernetesode', 'DevOps', 'linux', 'monitoring']
heroImage: ''
---


### Шпаргалка: Мониторинг кластеров Kubernetes

#### Метрики состояния приложений и контроллеров (kube-state-metrics)

| Описание | Название метрики (kube-state-metrics) | Команда для проверки |
| - | - | - |
| **Deployment** | | |
| Желаемое количество подов | `kube_deployment_spec_replicas` | `kubectl get deployment <deployment-name>` |
| Текущее количество подов | `kube_deployment_status_replicas` | `kubectl get deployment <deployment-name>` |
| Доступные поды | `kube_deployment_status_replicas_available` | `kubectl get deployment <deployment-name>` |
| Недоступные поды | `kube_deployment_status_replicas_unavailable` | `kubectl get deployment <deployment-name>` |
| **DaemonSet** | | |
| Желаемое количество подов | `kube_daemonset_status_desired_number_scheduled` | `kubectl get daemonset <daemonset-name>` |
| Текущее количество подов | `kube_daemonset_status_current_number_scheduled` | `kubectl get daemonset <daemonset-name>` |
| Доступные поды | `kube_daemonset_status_number_available` | `kubectl get daemonset <daemonset-name>` |
| Недоступные поды | `kube_daemonset_status_number_unavailable` | `kubectl get daemonset <daemonset-name>` |
| **Поды** | | |
| Статус пода (например, Running) | `kube_pod_status_phase` | `kubectl get pods` |
| **Jobs & CronJobs** | | |
| Успешные задания | `kube_job_status_succeeded` | `kubectl get jobs -A` |
| Неудачные задания | `kube_job_status_failed` | `kubectl get jobs -A` |
| Активные задания | `kube_job_status_active` | `kubectl get jobs -A` |
| Информация о CronJob | `kube_cronjob_info` | `kubectl get cronjobs -A` |

#### Метрики ресурсов узлов и контейнеров

| Описание | Источник метрики | Команда для проверки |
| - | - | - |
| **Узлы (Nodes)** | | |
| Состояние узла (Ready, MemoryPressure и т.д.) | `kube_node_status_condition` (kube-state-metrics) | `kubectl describe node <node-name>` |
| Запрошенная память на узле | `kube_pod_container_resource_requests_memory_bytes` (kube-state-metrics) | `kubectl top node <node-name>` |
| Используемая память на узле | `container_memory_working_set_bytes` (cAdvisor) | `kubectl top node <node-name>` |
| Запрошенный CPU на узле | `kube_pod_container_resource_requests_cpu_cores` (kube-state-metrics) | `kubectl top node <node-name>` |
| Используемый CPU на узле | `container_cpu_usage_seconds_total` (cAdvisor) | `kubectl top node <node-name>` |
| **Контейнеры** | | |
| Информация о контейнерах в поде | `kube_pod_container_info` (kube-state-metrics) | `kubectl describe pod <pod-name>` |
| Количество перезапусков контейнера | `kube_pod_container_status_restarts_total` (kube-state-metrics) | `kubectl get pod <pod-name>` |
| Статус контейнера (Завершен) | `kube_pod_container_status_terminated` (kube-state-metrics) | `kubectl describe pod <pod-name>` |

#### Сетевые и дисковые метрики (cAdvisor / kubelet)

| Описание | Имя метрики (Prometheus) | Команда для проверки |
| - | - | - |
| **Сеть** | | |
| Входящий трафик | `container_network_receive_bytes_total` | `kubectl get --raw /api/v1/nodes/<node-name>/proxy/metrics/cadvisor \| grep "container_network_receive_bytes_total"` |
| Исходящий трафик | `container_network_transmit_bytes_total` | `kubectl get --raw /api/v1/nodes/<node-name>/proxy/metrics/cadvisor \| grep "container_network_transmit_bytes_total"` |
| Ошибки приема | `container_network_receive_errors_total` | `kubectl get --raw /api/v1/nodes/<node-name>/proxy/metrics/cadvisor \| grep "container_network_receive_errors_total"` |
| Ошибки передачи | `container_network_transmit_errors_total` | `kubectl get --raw /api/v1/nodes/<node-name>/proxy/metrics/cadvisor \| grep "container_network_transmit_errors_total"` |
| **Диск** | | |
| Прочитано байт | `container_fs_reads_bytes_total` | `kubectl get --raw /api/v1/nodes/<node-name>/proxy/metrics/cadvisor \| grep "container_fs_reads_bytes_total"` |
| Записано байт | `container_fs_writes_bytes_total` | `kubectl get --raw /api/v1/nodes/<node-name>/proxy/metrics/cadvisor \| grep "container_fs_writes_bytes_total"` |

#### Метрики служб и обнаружения

| Описание | Название метрики (kube-state-metrics) | Команда для проверки |
| - | - | - |
| Типы служб в кластере | `kube_service_info` | `kubectl get services -A` |
| Поды, связанные со службой | N/A (используется селектор службы) | `kubectl get endpoints <service-name>` <br>или <br> `kubectl get pods -l <service-selector>` |

---
**Примечание:** Для удобства чтения метрик cAdvisor лучше использовать `curl` и `grep`, как показано в примере, или настроить Prometheus для их автоматического сбора и визуализации в Grafana. Команды `kubectl top` требуют предварительно установленного и запущенного **metrics-server** в кластере.
