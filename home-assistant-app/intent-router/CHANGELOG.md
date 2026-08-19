# Changelog

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
