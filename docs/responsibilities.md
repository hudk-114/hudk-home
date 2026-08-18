# 职责与数据边界

## Home Assistant 维护

以下内容属于运行时事实，应由 HA 与 HA 完整备份维护：

- 设备发现、设备注册表、实体注册表和区域关联
- Xiaomi OAuth、HomeKit 配对、Matter Fabric 等凭证或配对状态
- 当前状态、历史数据库、日志和统计
- 集成与 App/附加组件的运行数据
- Intent Router App 中的 MiniMax Key、OpenClaw 共享密钥和运行选项
- UI 中仍处于试验阶段的自动化和脚本
- 网络接口、Matter/Thread/Zigbee 控制器的实际状态

## Git 仓库维护

以下内容属于可审查的期望状态：

- 总体架构、决策记录和设备接入标准
- 稳定 HA scripts、automations、scenes、packages
- 自定义中文句式、别名与语音回归用例
- `intent-router` 代码、提供方适配器和部署配置
- 意图 JSON Schema、能力目录和安全策略
- 可提交设备清单中的逻辑名称、能力与依赖说明；真实实体 ID 只放在被忽略的本地清单或 overlay
- 运维手册、版本锁定、升级与回滚步骤
- `.env.example` 和 `secrets.yaml.example` 等无密钥模板

## 双轨恢复

| 故障 | Git 能恢复 | HA 备份能恢复 |
|---|---|---|
| 自动化被误改 | 是 | 是 |
| 意图服务代码丢失 | 是 | 已安装镜像和配置可恢复，源码以 Git 为准 |
| Xiaomi OAuth/配对丢失 | 否 | 通常可以 |
| HomeKit Bridge 配对丢失 | 否 | 可以 |
| 历史数据库丢失 | 否 | 取决于备份范围 |
| 整机迁移 | 部分 | 是，主路径 |

结论：Git 不是 HA 备份的替代品；HA 备份也不能替代可读、可评审的源码仓库。

## 从 UI 到 Git 的成熟流程

1. 在 HA UI 中快速验证新动作。
2. 连续稳定运行并确定实体 ID。
3. 将动作缩减成单一职责的脚本。
4. 把 YAML 迁入 `home-assistant/packages/`。
5. 登记到 `config/capabilities.yaml` 并补语音测试。
6. 部署后在 UI 中确认没有重复脚本。
