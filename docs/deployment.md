# 部署与 HA 配置

## 前置条件

- HAOS 正常运行；实际地址只写入本机 `.env` 或 Secret。
- 路由器对 HA 网卡 MAC 设置 DHCP 保留地址，避免地址变化。
- 已完成 HA 完整备份。
- 安装 File editor、Studio Code Server、Samba 或 SSH 中任一安全配置通道。

## 启用 packages

在 HA 的 `configuration.yaml` 中确认：

```yaml
homeassistant:
  packages: !include_dir_named packages
```

将本仓库 `home-assistant/packages/` 下经过确认的文件同步到 HA `/config/packages/`。部署前在 HA 中执行“检查配置”，通过后再重启。

## 部署当前扫地机能力

`home-assistant/packages/hudk_home.yaml` 使用占位实体：

```text
vacuum.REPLACE_WITH_VACUUM_ENTITY_ID
```

部署前必须在本地副本中替换为 HA 显示的真实实体 ID；真实值不要提交到 Git。

部署后在“开发者工具 → 动作”分别测试：

- `script.hudk_vacuum_start`
- `script.hudk_vacuum_dock`

确认运行正确后，删除 UI 里同名但逻辑重复的旧测试脚本，防止 Siri 选错。

## 部署中文句式

将 `home-assistant/custom_sentences/zh/hudk_home.yaml` 同步到：

```text
/config/custom_sentences/zh/hudk_home.yaml
```

自定义句式由 HA Assist 使用，不等同于 Siri 原生 HomeKit 句式。用 HA 页面右上角 Assist 输入框测试。

## HomeKit Bridge

优先通过 UI 创建专用 Bridge，只选择：

- 环境温度实体
- 环境湿度实体
- `script.hudk_vacuum_start`
- `script.hudk_vacuum_dock`

不要直接选择整个 `sensor` 或 `button` 域。否则厂商诊断传感器和危险按钮会一起进入 Apple 家庭。

Apple 家庭中建议：

- 把温湿度配件放到它实际所属的 Apple 家庭房间。
- 将脚本命名为“开始扫地”和“扫地机回充”。
- 可建立场景“扫地机回家”，获得更自然的 Siri 表达。

如果重新创建 Bridge，先从 Apple 家庭删除旧 Bridge，再清除 HA 中旧配对记录，避免 `pair verify without being paired` 类错误。

## 部署 Intent Router

Intent Router 不进入 HA Core 进程，长期运行方式是同一 HAOS 中的独立 Home Assistant App：

```text
OpenClaw / HA 页面 → Intent Router App:8787 → Supervisor → HA Core
```

### 安装 App

公开仓库 `https://github.com/hudk-114/hudk-home` 同时提供源码与 App 清单；镜像由 GitHub Actions 发布到 `ghcr.io/hudk-114/hudk-home-intent-router`。仓库只保存脱敏示例，家庭配置和密钥必须留在 HA App 配置或被忽略的本地文件中。

1. 在 HA 打开“设置 → Apps → App store → 右上角菜单 → Repositories”。
2. 添加 `https://github.com/hudk-114/hudk-home`。
3. 刷新 App Store，安装 `HUDK Home Intent Router`。
4. 在 App“配置”页填写 MiniMax API Key 和强随机 `shared_secret`。
5. 首次保持 `default_dry_run: true`、`allow_live_execution: false`。
6. 启动 App，打开 Web UI，确认健康状态和 HA 自动发现正常。
7. 完成 dry-run 后打开 `allow_live_execution`；默认调试仍保持开启，真实请求还必须显式发送 `dry_run: false`。

App 通过 Supervisor 注入的 Token 和内部地址访问 HA，不创建 HA 长期访问令牌。MiniMax Key、共享密钥和开关保存在 HA App 配置中并随 HA 备份；公开 Git 仓库只维护源码、脱敏示例和能力模板。

### 中国大陆 SWR 镜像

GitHub Actions 可将同一版本额外发布到华为云 SWR：

```text
swr.cn-east-3.myhuaweicloud.com/hudk-home/intent-router
```

SWR 发布默认关闭，避免凭证尚未配置时阻断 GHCR 发布。在 GitHub 仓库中配置以下 Actions Secrets：

- `SWR_USERNAME`：SWR 登录指令中 `-u` 后的用户名。
- `SWR_PASSWORD`：SWR 登录指令中 `-p` 后的密码。

再创建 Actions Variable `SWR_ENABLED=true`，从 Actions 页面手动运行 `Intent Router` 工作流。工作流会发布 `amd64`、`aarch64` 两个架构标签，再生成版本号和 `latest` 多架构清单。

SWR 登录指令、AK/SK 和密码不得写入 Git、App 配置或工作流文件。首次发布后在 SWR“我的镜像”中将 `intent-router` 设置为公开，并从未登录客户端验证匿名拉取。只有匿名拉取和双架构检查均通过后，才把 App `config.yaml` 的 `image` 从 GHCR 切换到 SWR 并提升版本号。

测试台可从 App Web UI 或 HA 侧边栏打开。它会展示实际发送给 LLM 的脱敏 JSON 请求体；其中不包含 API Key、Supervisor Token、HA service 或实体 ID，只用于联调。

### 本地开发

```bash
cp .env.example .env
cd intent-router
pnpm install --frozen-lockfile
pnpm dev
```

本地开发服务继续读取 `.env` 并监听 `127.0.0.1:8787`。Linux 非 HAOS 环境仍可使用 `deploy/systemd`，但当前家庭生产部署以 HA App 为准。

### 启用自动发现

1. 在 App 配置中保持 `discovery_enabled: true`。
2. 在 HA 的实体设置中给允许进入 Router 的具体实体添加 `intent_router` 标签；不要给整个设备打标。
3. 启动 App，访问 `GET /v1/discovery` 或测试台确认同步状态。
4. 新增同类设备后点击“同步 HA”，或等待默认 300 秒周期。

Router 同时读取实体、设备和区域注册表。实体没有单独区域时继承设备区域，因此“卧室温度”可以直接匹配设备所在的卧室；区域 ID 和实体 ID 不进入公共目录。

自动发现不把 Supervisor Token、实体注册表或运行时目录写入磁盘。迁移时恢复包含 Apps 的 HA 备份，Router 会从新 HA 自动重建目录。

HA Assist 的“公开”设置只影响语音助手。OpenClaw、网页文字和快捷指令是否可用，由 Router 标签、能力模板和 `allowed_sources` 共同决定。

### 从 HA 页面调用 Router

优先直接使用 App 的 Ingress Web UI，不需要额外 YAML。若希望在普通 Dashboard 卡片中调用，仓库中的 `home-assistant/packages/hudk_intent_router.yaml` 仍可选用，它提供：

- `rest_command.hudk_intent_turn`：统一文本入口。
- `rest_command.hudk_intent_health`：健康检查。
- `input_text.hudk_intent_test_text`：页面测试文本。
- `script.hudk_intent_router_test`：固定 dry-run 的测试按钮。
- `script.hudk_intent_router_health`：显示 Router 健康状态。

可选 package 的部署步骤：

1. 将 package 复制到 `/config/packages/hudk_intent_router.yaml`。
2. 在 HA `/config/secrets.yaml` 中让 Router URL 指向 `http://HOME_ASSISTANT_IP:8787`，Bearer 密钥与 App 的 `shared_secret` 完全一致。
3. 在 HA 执行“开发者工具 → YAML → 检查配置”，通过后重启。
4. 在“开发者工具 → 动作”先调用 `script.hudk_intent_router_health`，再调用 `script.hudk_intent_router_test`。

Dashboard 可以添加一个 Entities 卡片：

```yaml
type: entities
title: 家庭意图测试
entities:
  - entity: input_text.hudk_intent_test_text
  - entity: script.hudk_intent_router_test
  - entity: script.hudk_intent_router_health
```

HA package 中的测试脚本始终发送 `dry_run: true`，这与网页测试台可切换的“调试”开关不同。以后需要 HA Assist 或自动化执行真实意图时，另建生产脚本，明确发送 `dry_run: false`，并继续受 Router 的能力白名单、来源权限与 `INTENT_ROUTER_ALLOW_LIVE_EXECUTION` 约束。

HA 的 `rest_command` 支持 POST、模板 payload、headers 和 `response_variable`；当前写法以官方 RESTful Command 接口为准：<https://www.home-assistant.io/integrations/rest_command/>。

## 配置检查清单

- YAML 能被 HA 配置检查通过。
- 没有把 secret 或 token 写进 Git 文件。
- 每个脚本只承担一个稳定能力。
- HomeKit 只暴露需要的实体。
- AI 能力目录中不存在任意 service 或通配实体。
- 设备离线时语音返回真实失败而不是“已完成”。
