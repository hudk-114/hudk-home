# Intent Router

这是 OpenClaw、Siri 快捷指令、HA Assist 等自然语言入口与 Home Assistant 之间的独立意图层。入口只传文本和上下文；Intent Router 判断是查询还是命令、校验权限和参数；Home Assistant 始终是唯一设备执行与状态来源。

```text
OpenClaw / 快捷指令 / HA Assist
             │  text + source + context
             ▼
        POST /v1/turn
             │
       规则命中？──── 是 ───► 标准意图
             │ 否
             ▼
     MiniMax / 其他 Provider
             │  只返回标准意图 JSON
             ▼
   JSON Schema + 来源 + 能力策略
             │
             ▼
     capability 映射 ───────► Home Assistant REST
                                │
                                ▼
                           状态回读与结果
```

原生 Siri/HomeKit 的固定命令仍可直接进入 HA，不必绕行本服务。需要理解自然语言的 Siri 快捷指令才调用 `/v1/turn`。

## 已实现接口

- `GET /`：本地测试台，展示原文、Resolver、逻辑 capability、执行结果和实际 LLM 请求体。
- `GET /v1/catalog`：经过认证的脱敏逻辑能力目录，不包含 HA service/entity ID。
- `GET /v1/discovery`：自动发现状态与最近一次同步统计。
- `POST /v1/discovery/sync`：立即从 HA 重新发现设备能力。
- `POST /v1/turn`：推荐入口，识别、校验并执行；默认配置为 dry-run。
- `POST /v1/intent/resolve`：只识别，不执行。
- `POST /v1/command`：兼容入口，行为等同 `/v1/turn`，响应带弃用标记。
- `POST /v1/confirm`：确认短时有效的敏感操作。
- `GET /healthz`：服务和 HA 连接状态，不执行设备动作。

写能力必须在静态能力或 `discovery.templates` 中声明风险等级、允许来源、HA 动作、确认策略、成功标准和失败文案。AI 看到的只有逻辑能力与逻辑目标，模型返回值也必须通过 `contracts/intent.schema.json`；模型生成的 HA service 或 entity ID 会被拒绝。

## 本地启动

要求 Node.js 22+ 和 pnpm。

```bash
cd intent-router
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

示例配置监听 `127.0.0.1:8787`，且 `resolution.dry_run: true`，所以初次启动不会操作真实设备。明确句式无需配置 MiniMax；只有规则未命中时才需要 `MINIMAX_API_KEY`。

启动后打开 <http://127.0.0.1:8787/>，可以直接看到：

```text
自然语言 → Resolver → 标准意图 → 逻辑目标 → Capability → 调试或真实执行结果
```

不连接 HA 时仍可测试静态规则和能力。连接 HA 后，测试台还会显示自动发现状态、脱敏后的动态目标和最终映射。页面默认开启“调试”，请求携带 `dry_run: true`；只有服务端同时设置 `INTENT_ROUTER_ALLOW_LIVE_EXECUTION=true` 时，页面才允许关闭调试并真实调用 HA。“同步 HA”只更新运行时目录，不执行设备动作。

页面会展示实际发送给 LLM 的 JSON 请求体，包括 `messages`、匿名 `catalog`、`tools` 和模型参数，但不包含 API Key、Authorization、HA Token、HA service 或实体 ID。规则或目录别名直接命中时会明确显示“未调用 LLM”。

### 作为 Home Assistant App 运行

长期部署优先安装仓库中的 `home-assistant-app/intent-router`。Node.js 服务运行在 HAOS 的独立 App 容器中，不进入 HA Core 进程；Supervisor 负责开机启动、健康检查、更新和备份 App 配置。

App 设置 `homeassistant_api: true`，运行时通过 `SUPERVISOR_TOKEN` 调用 `http://supervisor/core`，不需要创建 HA 长期访问令牌。REST API 使用 `/core/api` 代理，WebSocket 使用 `/core/websocket` 代理。MiniMax Key、OpenClaw 共享密钥和执行开关从 `/data/options.json` 读取，由 HA App 配置页维护，不写入镜像或 Git。

从 HA Ingress 打开测试台时，Supervisor 已经完成用户认证；Router 只接受来自 Supervisor 固定内部地址 `172.30.32.2` 且带认证用户头的免密请求。通过 8787 端口访问时仍必须填写 App 配置中的 `shared_secret`，Ingress 身份头不能从局域网伪造绕过。

开发仍然使用前面的 `pnpm dev`。不运行 HAOS 的 Linux 环境可继续参考 `deploy/systemd/hudk-intent-router.service.example`，但它是兼容部署方式，不是当前家庭的首选生产拓扑。

## HA 自动发现

Router 启动时及每 300 秒读取 HA 的状态、动作、实体注册表、设备注册表、区域注册表、标签和可选的 Conversation 暴露设置，按 selector、专用模板和安全只读回退生成运行时目录。实体未直接分配区域时，会继承其设备所在区域。默认必须同时满足：

1. 实体已启用、可用且没有隐藏。
2. 不是 `config` 类实体；`diagnostic` 只有在实体被明确加标签且配置允许只读回退时可进入。
3. 实体带有 HA 标签 `intent_router`。
4. 命中某个专用模板，或属于允许通用读取的 `sensor`、`binary_sensor`、`event`。
5. 可写模板声明的 HA 动作当前确实存在；只读回退不会生成控制能力。

因此，新增普通只读实体时，只需在 HA 中设置清晰的友好名称/区域，并给允许进入通用 Router 的具体实体添加 `intent_router` 标签；随后点“同步 HA”或等待定时同步。专用模板会优先匹配，未命中模板的安全只读实体按实体生成 `entity.read`，无需为猫砂重量、电池、水位等字段逐个改代码。Assist 的公开列表只控制 HA 语音助手，不再限制 OpenClaw、网页文字或快捷指令。新增控制动作、聚合查询或专用语义时，才需要新增模板并进行安全评审。当前霍曼“手动出粮 1 份”按钮就是一个窄写模板：只允许固定一份、固定 `button.press`、每次确认，其他按钮不会因标签自动开放；静态脚本标记为 `fallback_when_discovered`，发现真实按钮后自动隐藏，不能成为第二个逻辑设备。完整理由见 [设计理念（人话版）](../docs/intent-router-design.md)。

selector 是可组合的：内置 `ha_label` 和 `conversation_exposure`，并支持 `selection_mode: any|all`。默认只启用 HA 标签；需要复用 Assist 公开名单的部署可以显式添加第二个 selector。

HA 的真实 `entity_id` 只保存在 Router 内存中的执行映射，`/v1/catalog`、AI 提示和测试页面都不返回它。同步失败会继续使用最近一次成功的内存目录；服务重启后若 HA 仍不可达，则不会凭旧文件猜测设备。`config/capabilities.yaml` 只用于稳定 HA 脚本、固定系统能力或特殊安全策略；普通传感器由自动发现提供。同一能力已有真实 HA 实例时，包含 `REPLACE_WITH` 的静态占位能力不会进入公共目录或 LLM 提示。

本地开发时先复制根目录 `.env.example` 为 `.env`，启动脚本会读取它；不要提交 `.env`。如需修改 YAML，复制 `config/intent-router.example.yaml` 为被忽略的 `config/intent-router.local.yaml`，并把 `.env` 中的 `INTENT_ROUTER_CONFIG` 指向它。准备接真实 HA 时：

1. 设置 `HA_BASE_URL`、专用最小权限 `HA_TOKEN`、`INTENT_ROUTER_SHARED_SECRET`。
2. 在 HA 中给允许进入通用意图层的具体实体添加 `intent_router` 标签；是否公开给 Assist 独立决定。
3. 对需要固定脚本或特殊策略的核心能力，再复制 `config/capabilities.override.example.yaml` 为被 Git 忽略的本地 overlay。
4. 先带请求字段 `dry_run: true` 联调，确认自动目录和目标别名。
5. 需要真实执行时设置 `INTENT_ROUTER_ALLOW_LIVE_EXECUTION=true`；`INTENT_ROUTER_DRY_RUN` 仍可保持 `true` 作为默认保护，只有明确发送 `dry_run: false` 的请求才真实执行。

HA App 部署不执行上述 Token 步骤：HA 地址和 Token 由 Supervisor 提供，其余设置直接在 App 的“配置”页填写。

## OpenClaw 调用

OpenClaw 不需要理解 command、query 或 health 分类，只需把用户原文传给统一入口。推荐安装仓库内的 [`openclaw-plugin-hudk-home`](../openclaw-plugin-hudk-home/README.md)：它只注册 `hudk_home_turn`，固定调用 `/v1/turn`，不需要给家庭 agent 开放任意 HTTP、`exec`、HA service 或实体 ID。

底层请求契约如下：

```http
POST http://INTENT_ROUTER_HOST:8787/v1/turn
Authorization: Bearer INTENT_ROUTER_SHARED_SECRET
Content-Type: application/json

{
  "text": "让扫地机回充",
  "language": "zh-CN",
  "source": "openclaw",
  "actor": "local-user",
  "conversation_id": "optional-conversation-id",
  "context": {
    "last_target": "main_vacuum"
  }
}
```

响应中的 `message` 可以原样交还用户；`status` 为 `needs_clarification` 时，把 `message` 当追问并在下一次请求携带上下文。`status` 为 `needs_confirmation` 时，必须先询问用户，只有收到明确肯定答复后，才把响应中的短时 `confirmation_id` 交回同一个插件工具；插件会固定调用 `/v1/confirm`，并保持原来的 `source` 与 `actor`。OpenClaw 不应持有 `HA_TOKEN`，也不要给它配置任意 HA service 调用工具。

`llm_request` 仅用于开发调试：如果本轮调用了 LLM，它包含发送给 Provider 的脱敏请求体；确定性 Resolver 命中时为 `null`。调用方不应把该字段朗读给用户或写入普通对话日志。

本机开发可用下面的 dry-run 请求验收：

```bash
curl -sS http://127.0.0.1:8787/v1/turn \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $INTENT_ROUTER_SHARED_SECRET" \
  -d '{"text":"开始扫地","language":"zh-CN","source":"openclaw","dry_run":true}'
```

如果 OpenClaw 与 Router 不在同一台主机，应让 Router 处于受控局域网或反向代理后，设置非空共享密钥；配置校验会拒绝“非回环监听 + 空密钥”。不要直接暴露到公网。

安装为 HA App 后使用 `http://HOME_ASSISTANT_IP:8787/v1/turn`。8787 只应开放在可信局域网或 VPN 中；OpenClaw 持有的只是独立共享密钥，不能获得 `SUPERVISOR_TOKEN`。

为某个 OpenClaw agent 启用时，只把 `hudk_home_turn` 加入该 agent 的工具白名单，并在插件配置中填写 App 当前的 `shared_secret`。插件默认地址可配置为 `http://HOME_ASSISTANT_IP:8787`，不要附带 `/v1/turn`；共享密钥只保存在 OpenClaw 本机配置，不提交 Git。

## 从 HA 页面调用

HA 侧配置已经独立放在 `home-assistant/packages/hudk_intent_router.yaml`。它提供统一 `rest_command`、健康检查、页面输入框和固定 dry-run 的测试脚本；URL 与 Bearer 密钥通过 HA `secrets.yaml` 注入。

部署步骤和 Dashboard 卡片见 `docs/deployment.md`。安装成 HA App 后，Router 会随 HA 完整备份迁移到新 HAOS 主机；外部输入只需继续指向新 HA 主机的 8787 端口。

## 配置与插件

主要扩展点均由 `config/intent-router.example.yaml` 选择：

- `resolution.order`：Resolver 顺序，默认 HA 目录别名 → 本地规则 → 对话上下文 → LLM。
- `discovery.selectors`：选择通用 Router 的 HA 标签或可选 Assist 暴露来源。
- `discovery.read_fallback`：允许明确加标签的安全只读域在未命中模板时生成 `entity.read`；默认支持 `sensor`、`binary_sensor`、`event`。
- `discovery.templates`：按设备域、设备类别、单位或名称定义可自动发现的安全能力模板。
- `provider.active` 与 `provider.adapters.*.protocol`：切换 AI Provider；内置 `openai_compatible`。
- `MINIMAX_THINKING=disabled`：M3 在意图分类场景跳过长推理；模型返回仍须通过完整意图 Schema。
- `MINIMAX_TIMEOUT_MS` 与 `MINIMAX_MAX_COMPLETION_TOKENS`：控制 Provider 超时和输出上限。
- `INTENT_ROUTER_DRY_RUN`：未显式传入 `dry_run` 时的默认模式。
- `INTENT_ROUTER_ALLOW_LIVE_EXECUTION=true`：允许受认证请求显式关闭调试；占位 HA 映射仍会被运行时拒绝。
- `accepted_message` / `completed_message`：能力提交成功或状态确认完成时返回给用户的可读文案；内部 capability key 只保留在结构化数据中。
- `execution.active` 与 `execution.adapters.*.protocol`：切换执行适配器；内置 `home_assistant_rest`。
- `files.capability_overlays`：用不进 Git 的本地 YAML 局部覆盖真实实体。
- `files.rule_overlays`：追加规则或用相同 `id` 覆盖已有规则。
- `plugins.modules`：加载可信本地 ESM 插件。

插件模块导出 `register(registry)`，可登记 Resolver、Provider 或 Executor：

```js
export function register(registry) {
  registry.registerProvider("my_openai_compatible", (id, config, context) => {
    return new MyProvider(id, config, context.fetch);
  });
}
```

插件是进程内可信代码。Executor 插件仍必须把动作交给 HA，不能借插件绕过 HA 直接调用厂商设备。安全硬边界——Schema 校验、模型不得提供 service/entity ID——不可通过配置关闭。

## 规则与能力配置

高频中文句式在 `config/intents.zh.yaml`。规则返回的是稳定意图，例如 `vacuum.dock + main_vacuum`，绝不写 HA 实体。普通传感器和已标记脚本优先通过 HA 运行时目录按能力、名称和区域解析；必须固定兼容层或特殊策略的能力再由 `config/capabilities.yaml` 映射到稳定 HA 脚本。真实厂商实体继续藏在 HA 或本地 overlay 后面。

新增一种能力类型时同步完成：

1. 更新 `contracts/intent.schema.json` 和 TypeScript `IntentName`。
2. 更新 `discovery.templates`，或在确需稳定脚本时更新 `config/capabilities.yaml`，填写完整安全字段。
3. 更新 `docs/device-inventory.md`；设备真正上线时在本地清单记录实际实体。
4. 在 `tests/utterances.yaml` 增加命中、歧义和拒绝样例。

## 失败语义

- 本地规则命中：不调用 AI。
- 目标不明确：`needs_clarification`，不猜设备。
- AI 低置信度、超时或熔断：不执行设备动作。
- Schema 或能力白名单不通过：`rejected` 或 `failed`。
- HA 不可达：`failed`，不会缓存写请求等待以后补执行。
- HA 已接收但设备状态未完成：`accepted`；状态命中成功标准才返回 `completed`。

审计日志默认不记录原始文本，只记录 request/source/intent/target/resolver/error。真实密钥、OAuth、HA 数据库和日志均不得进入 Git。
