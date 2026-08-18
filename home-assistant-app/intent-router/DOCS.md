# HUDK Home Intent Router

这个 App 在 Home Assistant OS 内运行 Intent Router。Home Assistant 仍是设备状态与执行的唯一权威；Router 只把自然语言映射为经过白名单和 Schema 校验的家庭能力。

## 首次配置

安装后先打开“配置”页：

1. `minimax_api_key`：MiniMax Token Plan 对应的 API Key。
2. `shared_secret`：OpenClaw 调用 Router 时使用的独立 Bearer 密钥，建议使用至少 32 字节的随机值。
3. `default_dry_run`：保持开启，让未明确指定的请求默认只解析。
4. `allow_live_execution`：完成 dry-run 验收前保持关闭；开启后，请求仍必须显式发送 `dry_run: false` 才会调用 HA。

App 使用 Supervisor 注入的临时 Token 访问 HA，无需创建或填写 HA 长期访问令牌。

## HA 设备目录

在 HA 中给允许进入通用意图层的具体实体添加 `intent_router` 标签。App 启动后会立即同步，之后默认每 5 分钟同步一次；也可以调用：

```http
POST /v1/discovery/sync
Authorization: Bearer <shared_secret>
```

不要给整个集成或所有实体批量打标签。每个可写设备类型仍必须存在受审查的能力模板。

## OpenClaw

局域网入口：

```text
http://HOME_ASSISTANT_IP:8787/v1/turn
```

请求头：

```text
Authorization: Bearer <shared_secret>
Content-Type: application/json
```

请求体：

```json
{
  "text": "让扫地机回充",
  "language": "zh-CN",
  "source": "openclaw",
  "actor": "local-user",
  "conversation_id": "openclaw-session-id",
  "dry_run": false
}
```

不要把 8787 端口转发到公网。跨网络调用应使用可信 VPN，并继续保留 Bearer 密钥。

## 测试台

从 App 页面点击“打开 Web UI”，或启用侧边栏入口。页面默认启用“调试”；关闭调试只有在 `allow_live_execution` 已开启时才会真实调用 HA。

## 更新

App 页面出现更新提示后，先创建 HA 备份，再手动更新。更新会替换程序镜像，但保留 App 配置。家庭控制链路不建议开启无人值守自动更新。
