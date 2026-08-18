import { setTimeout as delay } from "node:timers/promises";
import { CapabilityCatalog } from "./catalog.js";
import { RouterError, errorMessage } from "./errors.js";
import type {
  IntentProvider,
  NormalizedIntent,
  ProviderAdapterConfig,
  TurnRequest,
} from "./types.js";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        function?: { arguments?: string };
      }>;
    };
  }>;
}

interface PublicCatalogDescription {
  targets?: Array<{ id?: unknown }>;
  capabilities?: Array<{ id?: unknown }>;
}

interface ProviderResolution {
  intent: NormalizedIntent | null;
  llmRequest: Record<string, unknown> | null;
}

export class ProviderCallError extends RouterError {
  constructor(
    message: string,
    code: string,
    httpStatus: number,
    readonly llmRequest: Record<string, unknown>,
  ) {
    super(message, code, httpStatus);
    this.name = "ProviderCallError";
  }
}

function toolIntentSchema(
  schema: Record<string, unknown>,
  catalog: CapabilityCatalog,
): Record<string, unknown> {
  const source = structuredClone(schema) as {
    required?: string[];
    properties?: Record<string, Record<string, unknown>>;
  };
  const description = catalog.publicDescription() as PublicCatalogDescription;
  const targetIds = [
    ...new Set(
      (description.targets ?? [])
        .map((target) => target.id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const capabilityIds = [
    ...new Set(
      (description.capabilities ?? [])
        .map((capability) => capability.id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const intents = [
    ...new Set(
      capabilityIds.map((id) => id.startsWith("sensor.read_") ? "sensor.read" : id),
    ),
  ];
  const metrics = [
    ...new Set(
      capabilityIds
        .filter((id) => id.startsWith("sensor.read_"))
        .map((id) => id.slice("sensor.read_".length)),
    ),
  ];
  const properties = structuredClone(source.properties ?? {});
  properties.version = {
    type: "string",
    enum: ["1.0"],
    description: "固定填写 1.0。",
  };
  properties.intent = {
    type: "string",
    enum: intents,
    description: "只选择能力目录中存在的标准意图。",
  };
  properties.target = {
    type: "string",
    enum: targetIds,
    description: "必须与所选能力在 catalog 中的 target 完全一致。",
  };
  const originalArguments = properties.arguments ?? {};
  const argumentProperties = structuredClone(
    (originalArguments.properties as Record<string, Record<string, unknown>> | undefined) ?? {},
  );
  if (argumentProperties.metric && metrics.length) {
    argumentProperties.metric = {
      ...argumentProperties.metric,
      enum: metrics,
    };
  }
  properties.arguments = {
    ...originalArguments,
    type: "object",
    additionalProperties: false,
    properties: argumentProperties,
    description:
      "sensor.read 必须填写 metric；其他无参数意图填写空对象。设置温度必须填写 temperature_c。",
  };
  return {
    type: "object",
    additionalProperties: false,
    required: source.required ?? ["version", "intent", "target", "arguments", "confidence"],
    properties,
  };
}

function parseIntent(response: ChatCompletionResponse): NormalizedIntent | null {
  const message = response.choices?.[0]?.message;
  const toolArguments = message?.tool_calls?.[0]?.function?.arguments;
  const raw = toolArguments ?? message?.content;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NormalizedIntent;
  } catch {
    throw new RouterError("AI Provider 返回了无效 JSON", "PROVIDER_INVALID_JSON");
  }
}

export class DisabledProvider implements IntentProvider {
  constructor(readonly id: string) {}

  async resolve(): Promise<ProviderResolution> {
    return { intent: null, llmRequest: null };
  }
}

export class OpenAICompatibleProvider implements IntentProvider {
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(
    readonly id: string,
    private readonly config: ProviderAdapterConfig,
    private readonly intentSchema: Record<string, unknown>,
    private readonly catalog: CapabilityCatalog,
    private readonly fetchImplementation: typeof globalThis.fetch,
  ) {}

  async resolve(request: TurnRequest): Promise<ProviderResolution> {
    if (!this.config.base_url || !this.config.api_key || !this.config.model) {
      throw new RouterError(
        `AI Provider ${this.id} 未完成配置`,
        "PROVIDER_NOT_CONFIGURED",
        503,
      );
    }
    if (this.openUntil > Date.now()) {
      throw new RouterError(
        `AI Provider ${this.id} 熔断中`,
        "PROVIDER_CIRCUIT_OPEN",
        503,
      );
    }

    const llmRequest = this.buildRequest(request);
    const attempts = Math.max(1, (this.config.retries ?? 0) + 1);
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await this.request(llmRequest);
        this.consecutiveFailures = 0;
        this.openUntil = 0;
        return { intent: result, llmRequest };
      } catch (error) {
        lastError = error;
        if (attempt + 1 < attempts) await delay(100 * (attempt + 1));
      }
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= (this.config.failure_threshold ?? 3)) {
      this.openUntil = Date.now() + (this.config.cooldown_ms ?? 30_000);
    }
    throw new ProviderCallError(
      `AI Provider 请求失败：${errorMessage(lastError)}`,
      "PROVIDER_FAILED",
      503,
      llmRequest,
    );
  }

  private buildRequest(request: TurnRequest): Record<string, unknown> {
    return {
      model: this.config.model,
      temperature: 0,
      ...(this.config.thinking
        ? { thinking: { type: this.config.thinking } }
        : {}),
      ...(this.config.max_completion_tokens
        ? { max_completion_tokens: this.config.max_completion_tokens }
        : {}),
      messages: [
        {
          role: "system",
          content:
            "你是家庭意图候选生成器。必须调用 resolve_home_intent，并完整填写 version、intent、target、arguments、confidence。只选择 catalog 中成对出现的逻辑能力和逻辑目标，不得生成 Home Assistant service、entity_id、凭证或额外字段。sensor.read 必须填写对应 metric；无参数意图的 arguments 填 {}。不确定或请求范围大于单项能力时，将 confidence 设低并填写 clarification。",
        },
        {
          role: "user",
          content: JSON.stringify({
            text: request.text,
            language: request.language,
            context: request.context ?? {},
            catalog: this.catalog.publicDescription(),
          }),
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "resolve_home_intent",
            description:
              "从当前 catalog 中选择且仅选择一项能力，返回完整的标准家庭意图候选",
            parameters: toolIntentSchema(this.intentSchema, this.catalog),
          },
        },
      ],
      tool_choice: this.config.tool_choice ?? "auto",
    };
  }

  private async request(
    llmRequest: Record<string, unknown>,
  ): Promise<NormalizedIntent | null> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeout_ms ?? 4_000,
    );
    try {
      const response = await this.fetchImplementation(
        `${this.config.base_url!.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.config.api_key!}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(llmRequest),
        },
      );
      if (!response.ok) {
        throw new RouterError(
          `HTTP ${response.status}`,
          "PROVIDER_HTTP_ERROR",
          503,
        );
      }
      return parseIntent((await response.json()) as ChatCompletionResponse);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class LlmResolver {
  readonly id = "llm";

  constructor(private readonly provider: IntentProvider) {}

  resolve(request: TurnRequest) {
    return this.provider.resolve(request).then(({ intent, llmRequest }) =>
      intent ? ({ kind: "intent", intent, llmRequest } as const) : null,
    );
  }
}
