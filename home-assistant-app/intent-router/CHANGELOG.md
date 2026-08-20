# Changelog

## 0.1.4

- 明确加 `intent_router` 标签的 `sensor`、`binary_sensor`、`event` 在未命中专用模板时自动生成通用 `entity.read`，新增只读实体无需修改 Router。
- 通用读取按实体区分目标，支持同一宠物设备的猫砂重量、耗材状态、电池、水位和最近事件等多个字段。
- `diagnostic` 只读实体可在明确加标签时进入，`config` 和可写域继续排除；控制能力仍必须命中受审查模板。
- 通用读取返回友好名称、当前值和最后上报时间，并继续隐藏真实 HA `entity_id`。
- 新增人话版设计文档，明确“只读自动、控制受限”的接入边界。

## 0.1.3

- 传感器新鲜度优先使用 Home Assistant `last_reported`，避免稳定读数因 `last_updated` 未变化而被误判为过期。
- 数据确实过期时返回最后上报时间和过期时长，便于检查实体或设备状态。

## 0.1.2

- 允许来自 Supervisor 固定内部地址且已认证的 HA Ingress 请求直接使用测试台。
- 外部端口与 OpenClaw API 继续强制校验共享 Bearer 密钥。
- 修正 Supervisor WebSocket 代理地址，使 HA 标签和实体能力可以正常同步。

## 0.1.1

- 将 Home Assistant App 的默认运行镜像切换到华为云 SWR 国内公开仓库。
- 保留 GHCR 作为同步发布的备用镜像源。
- 为 SWR 基础版关闭 OCI 元数据并发布 Docker V2 Schema 2 双架构清单。

## 0.1.0

- 首次提供 Home Assistant App 打包。
- 使用 Supervisor Token 访问 Home Assistant API。
- 提供 HA Ingress 测试台和局域网 OpenClaw API。
- 支持 MiniMax、HA 标签能力发现、dry-run 与真实执行双重开关。
