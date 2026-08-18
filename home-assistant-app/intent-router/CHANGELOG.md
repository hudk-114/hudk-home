# Changelog

## 0.1.1

- 将 Home Assistant App 的默认运行镜像切换到华为云 SWR 国内公开仓库。
- 保留 GHCR 作为同步发布的备用镜像源。
- 为 SWR 基础版关闭 OCI 元数据并发布 Docker V2 Schema 2 双架构清单。

## 0.1.0

- 首次提供 Home Assistant App 打包。
- 使用 Supervisor Token 访问 Home Assistant API。
- 提供 HA Ingress 测试台和局域网 OpenClaw API。
- 支持 MiniMax、HA 标签能力发现、dry-run 与真实执行双重开关。
