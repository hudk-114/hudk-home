# 设备清单模板

真实家庭设备清单不上传 Git。请复制本文件为被 `.gitignore` 忽略的本地文件：

```text
docs/device-inventory.local.md
```

本地清单可以记录实体 ID、区域和型号，但不要记录 token、OAuth、序列号或配对密钥。

## 公共能力清单

Router 支持从 HA 自动生成同类型设备实例。公开仓库只记录系统支持的通用能力，不记录某个真实家庭当前拥有的设备、房间或验收状态。

真实设备清单与验收结果写入被忽略的 `docs/device-inventory.local.md`；厂商实体仍放在 HA 或本地 overlay 中。

| 能力类型 | 示例意图 | 状态来源/执行方 | 公开状态 |
|---|---|---|---|
| 扫地机器人 | `vacuum.start`、`vacuum.dock` | Home Assistant | 模板已实现，具体设备本地验收 |
| 环境传感器 | 温度、湿度、PM2.5、CO₂、TVOC 查询 | Home Assistant | 模板已实现，具体设备本地验收 |
| 系统健康 | `system.health` | Home Assistant | 能力已实现，具体部署本地验收 |

## 基础设施模板

```markdown
| 组件 | 当前值 | 备注 |
|---|---|---|
| HA 宿主 | 本地填写 | 长期开机策略 |
| HA URL | 本地填写 | DHCP 保留方式 |
| Apple 出口 | HomeKit Bridge | 暴露范围 |
| 设备入口 | 本地填写 | 集成与协议 |
```

## 设备模板

```markdown
### 设备逻辑名称

- 品牌/型号：
- 区域：
- 固件：
- 协议：
- HA 集成：
- 云端依赖：
- 实体 ID：
- 稳定能力：
- 暴露范围：Apple / Assist / AI / 自动化
- 离线行为：
- 最后验收日期：
```

## 可提交的内容

- 通用能力名称，例如 `vacuum.start`、`vacuum.dock`。
- 不含家庭信息的示例配置。
- 设备接入和验收流程。
- 已脱敏的故障复盘。

## 仅本地保存的内容

- 真实 IP、MAC、序列号和实体 ID。
- 设备品牌/型号与真实房间的对应关系。
- 家庭成员、地理围栏和在家状态。
- OAuth、Token、配对数据和完整 HA 备份。
- Router 从 HA 同步出的运行时实体映射；它只存在内存，可由 HA 重建。
