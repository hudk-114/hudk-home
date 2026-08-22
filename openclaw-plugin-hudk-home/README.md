# OpenClaw HUDK Home 插件

这个插件只向 OpenClaw 注册一个 `hudk_home_turn` 工具。首次调用把用户原文发送到 HUDK Home Intent Router 的 `/v1/turn`；敏感操作返回 `needs_confirmation` 时，OpenClaw 必须先询问用户，只有用户明确同意后，才能用同一工具把 `confirmation_id` 发送到 `/v1/confirm`。工具不会生成或接收 Home Assistant `service`、`entity_id` 或厂商凭证。

## 构建和校验

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
```

## 安装

```bash
openclaw plugins install --link /path/to/hudk-home/openclaw-plugin-hudk-home
```

在 OpenClaw 配置页设置：

- `baseUrl`：例如 `http://192.168.56.2:8787`
- `sharedSecret`：HA App 配置中的 `shared_secret`，不是 HA Token
- `defaultDryRun`：家庭真实控制时关闭；调试时开启

然后只在需要使用它的 agent 工具白名单中加入 `hudk_home_turn`。不要给家庭 agent 开放 `exec`、任意 HTTP 或任意 HA service 工具。

不要把“用户最初提出操作”视为二次确认。只有 Router 返回确认 ID 之后的明确肯定答复，才可以提交该 ID；否定、含糊回复或确认过期都不得执行。
