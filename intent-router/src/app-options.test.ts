import { describe, expect, it } from "vitest";
import { buildHomeAssistantAppEnvironment } from "./app-options.js";

describe("Home Assistant App options", () => {
  it("使用 Supervisor Token 并映射 Router 配置", () => {
    const environment = buildHomeAssistantAppEnvironment(
      {
        minimax_api_key: "minimax-secret",
        shared_secret: "openclaw-secret",
        minimax_model: "MiniMax-M3",
        minimax_thinking: "disabled",
        minimax_timeout_ms: 30_000,
        minimax_max_completion_tokens: 1024,
        discovery_enabled: true,
        default_dry_run: true,
        allow_live_execution: false,
      },
      { SUPERVISOR_TOKEN: "supervisor-token" },
    );

    expect(environment).toMatchObject({
      HA_BASE_URL: "http://supervisor/core",
      HA_TOKEN: "supervisor-token",
      INTENT_ROUTER_BIND: "0.0.0.0",
      INTENT_ROUTER_PORT: "8787",
      INTENT_ROUTER_CONFIG: "/app/config/intent-router.example.yaml",
      MINIMAX_API_KEY: "minimax-secret",
      MINIMAX_MODEL: "MiniMax-M3",
      MINIMAX_THINKING: "disabled",
      MINIMAX_TIMEOUT_MS: "30000",
      MINIMAX_MAX_COMPLETION_TOKENS: "1024",
      HA_DISCOVERY_ENABLED: "true",
      INTENT_ROUTER_DRY_RUN: "true",
      INTENT_ROUTER_ALLOW_LIVE_EXECUTION: "false",
      INTENT_ROUTER_SHARED_SECRET: "openclaw-secret",
    });
  });

  it("拒绝缺少 Supervisor Token 或共享密钥的配置", () => {
    expect(() =>
      buildHomeAssistantAppEnvironment(
        { minimax_api_key: "key", shared_secret: "secret" },
        {},
      ),
    ).toThrow("Supervisor API Token");
    expect(() =>
      buildHomeAssistantAppEnvironment(
        { minimax_api_key: "key", shared_secret: "" },
        { SUPERVISOR_TOKEN: "token" },
      ),
    ).toThrow("OpenClaw 共享密钥");
  });
});
