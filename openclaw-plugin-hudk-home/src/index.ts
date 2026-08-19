import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const configSchema = {
  type: "object",
  properties: {
    baseUrl: {
      type: "string",
        minLength: 1,
        default: "http://192.168.56.2:8787",
        description: "HUDK Home Intent Router base URL.",
    },
    sharedSecret: {
      type: "string",
        minLength: 1,
        description: "Bearer secret configured in the Home Assistant App.",
    },
    defaultDryRun: {
      type: "boolean",
        default: false,
        description: "Parse only unless a tool call explicitly overrides it.",
    },
    timeoutMs: {
      type: "integer",
        minimum: 1_000,
        maximum: 120_000,
        default: 45_000,
    },
  },
  additionalProperties: false,
} as const;

const turnParameters = {
  type: "object",
  properties: {
    text: {
      type: "string",
      minLength: 1,
      maxLength: 1_000,
      description: "用户关于家庭设备的原始自然语言，不要改写为 HA service 或 entity_id。",
    },
    dry_run: {
      type: "boolean",
      description: "true 只解析不执行；通常省略并使用插件配置。",
    },
    conversation_id: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description: "可选的稳定会话标识，用于后续多轮澄清。",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const;

const DEFAULT_BASE_URL = "http://192.168.56.2:8787";
const DEFAULT_TIMEOUT_MS = 45_000;

function turnUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("HUDK Home 插件的 Intent Router 地址不是有效 URL。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("HUDK Home 插件只允许 http 或 https 地址。");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/turn`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const message = (payload as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (status === 401) return "共享密钥不正确或尚未同步。";
  return `Intent Router 返回 HTTP ${status}。`;
}

export async function callIntentRouter(
  params: { text: string; dry_run?: boolean; conversation_id?: string },
  config: {
    baseUrl?: string;
    sharedSecret?: string;
    defaultDryRun?: boolean;
    timeoutMs?: number;
  },
  signal?: AbortSignal,
): Promise<unknown> {
  const secret = config.sharedSecret?.trim();
  if (!secret) {
    throw new Error(
      "HUDK Home 插件尚未配置共享密钥。请在 OpenClaw 配置页填写 HA App 的 shared_secret。",
    );
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const response = await fetch(turnUrl(config.baseUrl?.trim() || DEFAULT_BASE_URL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: params.text.trim(),
        language: "zh-CN",
        source: "openclaw",
        actor: "family",
        ...(params.conversation_id ? { conversation_id: params.conversation_id } : {}),
        dry_run: params.dry_run ?? config.defaultDryRun ?? false,
      }),
      signal: requestSignal,
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Intent Router 返回了无法识别的响应。");
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Intent Router 请求超过 ${timeoutMs}ms。`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export default defineToolPlugin({
  id: "hudk-home",
  name: "HUDK Home",
  description: "把家庭自然语言请求交给受限的 HUDK Home Intent Router。",
  configSchema: configSchema as never,
  tools: (tool) => [
    tool({
      name: "hudk_home_turn",
      label: "HUDK 家庭控制",
      description:
        "当用户要查询或控制家中设备时调用。只传用户的自然语言原文；本工具会由 Intent Router 判断查询、命令、目标和安全策略。严格根据返回的 message 回复；失败时不要建议 Router 未声明的刷新、控制或替代操作。",
      parameters: turnParameters as never,
      execute: (params, config, context) =>
        callIntentRouter(
          params as { text: string; dry_run?: boolean; conversation_id?: string },
          config,
          context.signal,
        ),
    }),
  ],
});
