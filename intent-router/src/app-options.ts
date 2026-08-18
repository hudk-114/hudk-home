export interface HomeAssistantAppOptions {
  minimax_api_key: string;
  shared_secret: string;
  minimax_model?: string;
  minimax_thinking?: "disabled" | "adaptive";
  minimax_timeout_ms?: number;
  minimax_max_completion_tokens?: number;
  discovery_enabled?: boolean;
  default_dry_run?: boolean;
  allow_live_execution?: boolean;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Home Assistant App 配置缺少 ${name}`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function setIfDefined(
  target: NodeJS.ProcessEnv,
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (value !== undefined) target[key] = String(value);
}

/**
 * Translate Supervisor-managed App options into the existing environment-based
 * Router configuration. Secrets stay in /data/options.json and are never copied
 * into the image or repository.
 */
export function buildHomeAssistantAppEnvironment(
  options: HomeAssistantAppOptions,
  baseEnvironment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const supervisorToken = requiredString(
    baseEnvironment.SUPERVISOR_TOKEN,
    "Supervisor API Token",
  );
  const environment: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    HA_BASE_URL: "http://supervisor/core",
    HA_TOKEN: supervisorToken,
    INTENT_ROUTER_BIND: "0.0.0.0",
    INTENT_ROUTER_PORT: "8787",
    INTENT_ROUTER_CONFIG: "/app/config/intent-router.example.yaml",
    INTENT_PROVIDER: "minimax",
    MINIMAX_API_KEY: requiredString(options.minimax_api_key, "MiniMax API Key"),
    INTENT_ROUTER_SHARED_SECRET: requiredString(
      options.shared_secret,
      "OpenClaw 共享密钥",
    ),
  };

  setIfDefined(environment, "MINIMAX_MODEL", optionalString(options.minimax_model));
  setIfDefined(environment, "MINIMAX_THINKING", options.minimax_thinking);
  setIfDefined(environment, "MINIMAX_TIMEOUT_MS", options.minimax_timeout_ms);
  setIfDefined(
    environment,
    "MINIMAX_MAX_COMPLETION_TOKENS",
    options.minimax_max_completion_tokens,
  );
  setIfDefined(environment, "HA_DISCOVERY_ENABLED", options.discovery_enabled);
  setIfDefined(environment, "INTENT_ROUTER_DRY_RUN", options.default_dry_run);
  setIfDefined(
    environment,
    "INTENT_ROUTER_ALLOW_LIVE_EXECUTION",
    options.allow_live_execution,
  );
  return environment;
}
