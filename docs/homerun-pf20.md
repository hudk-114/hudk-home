# 霍曼 PF20 接入

## 定位

本接入把霍曼 PF20 的信息与一次性手动动作带入 Home Assistant。日常定时出粮仍由霍曼 App 管理，HA 不复制厂商自动化：

- 读取：在线状态、最近事件、缺粮、备用电池、电量、干燥剂剩余天数（设备支持时显示）。
- 控制：只提供固定“手动出粮 1 份”。
- 执行边界：OpenClaw 和 Intent Router 只调用 HA 中经过审查的固定一份出粮能力，不直接访问霍曼云端。

## 依赖与限制

PF20 在局域网中未发现可用的本地控制端口，因此当前实现依赖霍曼云端 `api.homerunsmart.com`。这不是霍曼官方维护的 Home Assistant 集成；接口来自官方 App 的兼容实现，厂商升级后可能失效。

离线行为：

- 云端不可达或 token 失效时，实体显示不可用并记录 HA 错误；token 失效会触发重新认证。
- 设备离线时出粮按钮不可用。
- 外层云端响应或设备内层响应任一失败，按钮调用失败，不返回“已出粮”。
- 集成不保存密码；HA 配置条目保存手机号、区号、随机设备 ID 和云端 token，用于后续刷新与重新认证。App 客户端参数放在被忽略的 `vendor_keys.py`，不得提交。

## 安装

将目录复制到 HA：

```text
home-assistant/custom_components/homerun_pet/
→ /config/custom_components/homerun_pet/
```

`vendor_keys.example.py` 只是字段模板。真实 `vendor_keys.py` 只存在于 HA 运行目录或本地安全副本，包含：

```python
APP_ID = "..."
APP_KEY = "..."
PASSWORD_SALT = "..."
```

重启 HA 后，从“设置 → 设备与服务 → 添加集成 → Homerun Pet”登录。中国大陆账号保持默认区号 `+86`。密码只用于换取 token。

## 出粮安全定义

| 项目 | 约束 |
|---|---|
| 能力 ID | `pet_feeder.feed_once` |
| 安全等级 | `sensitive` |
| 允许来源 | `home_assistant`、`openclaw` |
| 参数 | 无；集成内部固定为 1 份 |
| HA 执行入口 | 首选已加 `intent_router` 标签且名称明确为“手动出粮 1 份”的按钮；稳定脚本作为兼容入口 |
| Router 确认 | `confirmation: always` |
| 成功条件 | HA 按钮等待霍曼外层和设备内层都返回成功 |
| 失败响应 | 不可达、离线、鉴权失败或设备拒绝时返回失败，不重试出粮 |

刻意不做自动重试：网络超时可能发生在设备已经收到命令之后，重试会造成重复出粮。

## 验收

1. 在 HA 设备页对照霍曼 App，检查在线、缺粮、耗材和最近事件。
2. 确认猫粮机在线且粮碗可观察，手动按一次“手动出粮 1 份”。
3. 检查实际只出 1 份，并确认最近事件更新。
4. 给需要查询的 `sensor` / `binary_sensor` 添加 `intent_router` 标签。
5. 只给名称明确表示“手动出粮 1 份”的按钮添加 `intent_router` 标签；不要标记其他控制按钮。
6. 在 Router 测试台点击“同步 HA”，确认目录只出现一个 `pet_feeder.feed_once` 写能力，且风险为 `sensitive`。
7. 从 OpenClaw 请求出粮，必须先收到确认提示；确认后才执行。

Router 的专用发现模板把这个已标记按钮固定映射为 `button.press`，不接受份数参数，也不会把真实实体 ID 交给 AI。若部署不使用自动发现，可以继续把真实按钮实体只填入 HA 本地 package，并通过 `script.hudk_homerun_feed_once` 提供同一逻辑能力；真实实体 ID 不提交。
