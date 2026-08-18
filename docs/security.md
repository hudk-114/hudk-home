# 安全设计

## 信任边界

- **设备网与 HA**：HA 可访问设备，但 IoT 设备不应任意访问个人电脑和管理网络。
- **Apple 家庭**：只暴露必要实体；HomeKit 配对信息视为凭证。
- **Intent Router**：唯一可以把外部自然语言转换为 HA 能力调用的服务。
- **MiniMax**：外部语义提供方，只接收完成意图识别所需的最小文本和匿名能力描述。
- **OpenClaw/快捷指令**：已认证输入源，不直接持有设备厂商凭证。

## 密钥管理

以下数据只存本地 Secret、HA 运行时或系统钥匙串：

- HA 长期访问令牌
- MiniMax API Key
- Xiaomi OAuth 与设备凭证
- HomeKit 配对数据
- OpenClaw/Intent Router 共享密钥
- TLS 私钥

仓库只保存变量名和示例。发现密钥进入 Git 后，应立即轮换密钥，而不只是删除文件。

## 最小权限

- Intent Router 使用独立 HA 用户/令牌，便于撤销和审计。
- 能力目录只允许明确的脚本，不允许任意 `service`、`entity_id` 或模板。
- 自动发现默认只接纳带 `intent_router` 标签且命中仓库安全模板的具体实体；配置、诊断和隐藏实体默认排除。Conversation 公开名单只是可选 selector。
- 输入源分级：本机可信、家庭成员、远程会话、自动化。
- 每个能力标注 `read`、`routine`、`sensitive` 或 `critical`。
- OpenClaw 家庭 agent 只放行专用 `hudk_home_turn` 工具；插件固定访问 Router `/v1/turn`，不向该 agent 开放 `exec`、任意 HTTP、HA service 或 `entity_id`。

## AI 防护

1. 模型看到逻辑目标和可用意图，不看到 HA token。
2. 模型输出必须通过 `contracts/intent.schema.json`。
3. 严格拒绝未知意图、额外字段和未知目标。
4. 参数做范围约束，例如空调温度、定时长度。
5. 高风险操作要求显式确认，确认与原请求绑定并短时有效。
6. 模型返回文本不能作为“执行成功”的证据；以 HA 状态为准。
7. 日志记录模型提供方、意图、策略结果和 HA context，但不记录密钥和完整敏感对话。
8. HA `entity_id` 只存在受信任的运行时执行映射中，不进入 AI 提示、公共目录或测试页面。
9. API 的 `llm_request` 调试字段只包含发送给 Provider 的请求体，不包含鉴权头；它仍可能包含用户原文，因此调用方不得把它写入普通对话日志或公开监控。
10. 关闭页面“调试”必须同时满足请求 `dry_run: false` 与服务端 `INTENT_ROUTER_ALLOW_LIVE_EXECUTION=true`，避免单个客户端误操作解除全局保护。

## 网络建议

- HA UI 不直接暴露公网端口。
- 远程访问优先使用可信 VPN 或经过认证的服务。
- Intent Router 默认绑定 `127.0.0.1`；若开放到局域网，必须鉴权和限速。
- IoT VLAN 是中长期优化项，但要允许 HA 与 mDNS/Matter/设备必要端口通信。

## 高风险默认策略

| 能力 | 默认 |
|---|---|
| 查询传感器 | 自动允许 |
| 灯、风扇、扫地机 | 家庭可信来源允许 |
| 空调温度/模式 | 允许，但限制范围 |
| 门锁、车库门 | 要求确认和状态复核 |
| 安防撤防、燃气、烹饪设备 | AI 默认拒绝或强确认 |
| 删除设备、改网络、升级系统 | 不通过语音/AI 执行 |
