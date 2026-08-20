import { setTimeout as delay } from "node:timers/promises";
import { RouterError, errorMessage } from "./errors.js";
import type {
  CapabilityDefinition,
  CapabilityExecutor,
  DependencyHealth,
  ExecutionResult,
  NormalizedIntent,
  RouterConfig,
} from "./types.js";

interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated: string;
  last_reported?: string;
  context?: { id?: string };
}

const METRIC_NAMES: Record<string, string> = {
  temperature: "温度",
  humidity: "湿度",
  pm25: "PM2.5",
  co2: "二氧化碳浓度",
  tvoc: "TVOC 浓度",
};

export class HomeAssistantExecutor implements CapabilityExecutor {
  readonly id = "home_assistant";

  constructor(
    private readonly config: RouterConfig["home_assistant"],
    private readonly fetchImplementation: typeof globalThis.fetch,
  ) {}

  async execute(
    capabilityKey: string,
    capability: CapabilityDefinition,
    intent: NormalizedIntent,
  ): Promise<ExecutionResult> {
    try {
      if (capabilityKey === "system.health") return await this.executeHealth();
      if (capability.kind === "read") return await this.readState(capability, intent);
      return await this.callAction(capabilityKey, capability, intent);
    } catch (error) {
      return {
        status: "failed",
        message: `${capability.failure_message ?? "Home Assistant 调用失败"}：${errorMessage(error)}`,
        errorCode: error instanceof RouterError ? error.code : "HA_REQUEST_FAILED",
      };
    }
  }

  async health(): Promise<DependencyHealth> {
    if (!this.config.base_url || !this.config.token) {
      return { status: "unconfigured", detail: "Home Assistant 尚未配置" };
    }
    try {
      await this.request("/api/");
      return { status: "ok" };
    } catch (error) {
      return { status: "degraded", detail: errorMessage(error) };
    }
  }

  private async executeHealth(): Promise<ExecutionResult> {
    const health = await this.health();
    if (health.status === "ok") {
      return { status: "completed", message: "Home Assistant 连接正常。" };
    }
    return {
      status: "failed",
      message: health.detail ?? "Home Assistant 当前不可用。",
      errorCode: "HA_UNHEALTHY",
    };
  }

  private async readState(
    capability: CapabilityDefinition,
    intent: NormalizedIntent,
  ): Promise<ExecutionResult> {
    if (!capability.ha_entity_id) {
      throw new RouterError("读取能力缺少 ha_entity_id", "CAPABILITY_INVALID");
    }
    const state = await this.request<HaState>(
      `/api/states/${encodeURIComponent(capability.ha_entity_id)}`,
    );
    if (state.state === "unavailable" || state.state === "unknown") {
      return {
        status: "failed",
        message: "Home Assistant 中该实体当前不可用，无法返回可靠读数。",
        errorCode: "STATE_UNAVAILABLE",
      };
    }
    const freshnessTimestamp = state.last_reported ?? state.last_updated;
    const freshnessTime = Date.parse(freshnessTimestamp);
    if (!Number.isFinite(freshnessTime)) {
      return {
        status: "failed",
        message: "Home Assistant 没有返回有效的传感器上报时间，无法确认数据是否仍然新鲜。",
        errorCode: "STATE_TIMESTAMP_INVALID",
      };
    }
    const ageSeconds = Math.max(0, (Date.now() - freshnessTime) / 1_000);
    if (
      capability.max_state_age_seconds !== undefined &&
      ageSeconds > capability.max_state_age_seconds
    ) {
      const ageMinutes = Math.max(1, Math.round(ageSeconds / 60));
      return {
        status: "failed",
        message: `传感器最后上报于 ${freshnessTimestamp}（约 ${ageMinutes} 分钟前），已超过允许的新鲜度，不能当作实时数据返回。请在 Home Assistant 中检查该实体是否仍在更新。`,
        errorCode: "STATE_STALE",
        data: {
          last_reported: state.last_reported ?? null,
          last_updated: state.last_updated,
          age_seconds: Math.floor(ageSeconds),
        },
      };
    }
    const unit = state.attributes.unit_of_measurement;
    const metric = intent.arguments.metric;
    const domain = state.entity_id.split(".", 1)[0];
    const eventType = typeof state.attributes.event_type === "string"
      ? state.attributes.event_type
      : null;
    const readableState = domain === "binary_sensor"
      ? state.state === "on" ? "是" : state.state === "off" ? "否" : state.state
      : domain === "event" && eventType
        ? `${eventType}（发生于 ${state.state}）`
        : state.state;
    const displayValue = `${readableState}${typeof unit === "string" ? unit : ""}`;
    const isGenericRead = intent.intent === "entity.read";
    const friendlyName = typeof state.attributes.friendly_name === "string"
      ? state.attributes.friendly_name
      : "该实体";
    return {
      status: "completed",
      message: isGenericRead
        ? `Home Assistant 中记录的「${friendlyName}」为 ${displayValue}，最后上报于 ${freshnessTimestamp}。`
        : `${typeof metric === "string" ? (METRIC_NAMES[metric] ?? metric) : "传感器读数"}当前为 ${displayValue}。`,
      data: {
        state: state.state,
        ...(eventType ? { event_type: eventType } : {}),
        unit: typeof unit === "string" ? unit : null,
        last_reported: state.last_reported ?? null,
        last_updated: state.last_updated,
        last_changed: state.last_changed ?? null,
      },
      ...(state.context?.id ? { haContextId: state.context.id } : {}),
    };
  }

  private async callAction(
    capabilityKey: string,
    capability: CapabilityDefinition,
    intent: NormalizedIntent,
  ): Promise<ExecutionResult> {
    if (!capability.ha_action || !capability.ha_entity_id) {
      throw new RouterError("写能力缺少 HA 动作映射", "CAPABILITY_INVALID");
    }
    const [domain, action] = capability.ha_action.split(".");
    if (!domain || !action) {
      throw new RouterError("ha_action 格式必须是 domain.action", "CAPABILITY_INVALID");
    }
    const mappedArguments = Object.fromEntries(
      Object.entries(capability.argument_mapping ?? {})
        .filter(([intentArgument]) => intent.arguments[intentArgument] !== undefined)
        .map(([intentArgument, serviceField]) => [
          serviceField,
          intent.arguments[intentArgument],
        ]),
    );
    const response = await this.request<unknown>(`/api/services/${domain}/${action}`, {
      method: "POST",
      body: JSON.stringify({ ...mappedArguments, entity_id: capability.ha_entity_id }),
    });
    const contextId = this.extractContextId(response);

    const completedStates = capability.completed_states ?? [];
    const acceptedStates = capability.accepted_states ?? [];
    if (
      capability.success_criteria === "ha_accepted" ||
      !capability.verification_entity_id ||
      (completedStates.length === 0 && acceptedStates.length === 0)
    ) {
      return {
        status: "accepted",
        message: capability.accepted_message ?? "操作已提交给 Home Assistant。",
        ...(contextId ? { haContextId: contextId } : {}),
      };
    }

    const deadline = Date.now() + (capability.timeout_seconds ?? 15) * 1_000;
    let acceptedState: string | null = null;
    while (Date.now() < deadline) {
      const state = await this.request<HaState>(
        `/api/states/${encodeURIComponent(capability.verification_entity_id)}`,
      );
      if (completedStates.includes(state.state)) {
        const verifiedContextId = contextId ?? state.context?.id;
        return {
          status: "completed",
          message: capability.completed_message ?? "设备状态已确认，操作完成。",
          data: { state: state.state },
          ...(verifiedContextId ? { haContextId: verifiedContextId } : {}),
        };
      }
      if (acceptedStates.includes(state.state)) acceptedState = state.state;
      await delay(500);
    }

    return {
      status: "accepted",
      message: acceptedState
        ? (capability.accepted_message ?? `Home Assistant 已接受操作，设备当前状态为 ${acceptedState}。`)
        : (capability.accepted_message ?? "Home Assistant 已接受操作，但尚未从设备状态确认完成。"),
      ...(acceptedState ? { data: { state: acceptedState } } : {}),
      ...(contextId ? { haContextId: contextId } : {}),
    };
  }

  private extractContextId(value: unknown): string | undefined {
    if (!Array.isArray(value)) return undefined;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const context = (item as { context?: { id?: unknown } }).context;
      if (typeof context?.id === "string") return context.id;
    }
    return undefined;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.config.base_url || !this.config.token) {
      throw new RouterError("Home Assistant 尚未配置", "HA_NOT_CONFIGURED", 503);
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.request_timeout_ms,
    );
    try {
      const response = await this.fetchImplementation(
        `${this.config.base_url.replace(/\/$/, "")}${path}`,
        {
          ...init,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            "Content-Type": "application/json",
            ...(init.headers ?? {}),
          },
        },
      );
      if (!response.ok) {
        throw new RouterError(
          `Home Assistant 返回 HTTP ${response.status}`,
          "HA_HTTP_ERROR",
          502,
        );
      }
      const text = await response.text();
      return (text ? JSON.parse(text) : null) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
