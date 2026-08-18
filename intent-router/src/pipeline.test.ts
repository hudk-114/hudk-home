import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { buildPipeline } from "./bootstrap.js";
import { loadRouterBundle } from "./config.js";
import type { RouterBundle, TurnContext } from "./types.js";

interface UtteranceCase {
  text: string;
  context?: TurnContext;
  expected_status?: string;
  expected_intent?: string;
  expected_target?: string;
  expected_arguments?: Record<string, unknown>;
}

interface UtteranceSuite {
  cases: UtteranceCase[];
}

const here = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(here, "../../config/intent-router.example.yaml");

async function loadBundle(): Promise<RouterBundle> {
  return loadRouterBundle(configPath, {});
}

describe("IntentPipeline", () => {
  it("通过配置中的中文样例，明确命中时完全不调用 AI", async () => {
    const bundle = await loadBundle();
    bundle.catalogData.targets.test_environment_sensor = {
      display_name: "测试环境传感器",
      aliases: ["卧室", "家里"],
      area: "卧室",
    };
    bundle.catalogData.capabilities["sensor.read_temperature"] = {
      target: "test_environment_sensor",
      kind: "read",
      risk: "read",
      ha_entity_id: "sensor.test_temperature",
    };
    bundle.catalogData.capabilities["sensor.read_humidity"] = {
      target: "test_environment_sensor",
      kind: "read",
      risk: "read",
      ha_entity_id: "sensor.test_humidity",
    };
    const aiMustNotRun: typeof fetch = async () => {
      throw new Error("local rule unexpectedly called AI");
    };
    const pipeline = await buildPipeline(bundle, { fetch: aiMustNotRun });
    const suite = parse(
      await readFile(resolve(bundle.projectRoot, bundle.config.files.utterance_tests), "utf8"),
    ) as UtteranceSuite;

    for (const testCase of suite.cases) {
      const result = await pipeline.resolve({
        text: testCase.text,
        language: "zh-CN",
        source: "openclaw",
        ...(testCase.context ? { context: testCase.context } : {}),
      });

      expect(result.status, testCase.text).toBe(
        testCase.expected_status ?? "resolved",
      );
      if (testCase.expected_intent) {
        expect(result.intent?.intent, testCase.text).toBe(testCase.expected_intent);
        if (testCase.expected_target) {
          expect(result.intent?.target, testCase.text).toBe(testCase.expected_target);
        }
        expect(result.intent?.arguments, testCase.text).toEqual(
          testCase.expected_arguments ?? {},
        );
        expect(result.resolver, testCase.text).not.toBe("llm");
      }
    }
  });

  it("拒绝 AI 在标准意图之外夹带 HA entity_id", async () => {
    const bundle = await loadBundle();
    const fakeAi: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: JSON.stringify({
                        version: "1.0",
                        intent: "vacuum.start",
                        target: "main_vacuum",
                        arguments: {},
                        confidence: 0.99,
                        ha_entity_id: "vacuum.generated_by_model",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    bundle.config.provider.adapters.minimax!.api_key = "test";
    const pipeline = await buildPipeline(bundle, { fetch: fakeAi });

    const result = await pipeline.resolve({
      text: "把地面处理干净吧",
      language: "zh-CN",
      source: "openclaw",
    });

    expect(result.status).toBe("failed");
    expect(result.error_code).toBe("INVALID_INTENT");
    expect(result.message).toBe(
      "AI 返回结果未通过安全格式校验，未执行任何设备操作。",
    );
    expect(result.llm_request).toMatchObject({
      model: bundle.config.provider.adapters.minimax!.model,
    });
    expect(JSON.stringify(result.llm_request)).not.toContain("Authorization");
    expect(JSON.stringify(result.llm_request)).not.toContain("api_key");
  });

  it("命中能力后 dry-run 返回稳定逻辑能力，不调用 HA", async () => {
    const bundle = await loadBundle();
    const externalCallMustNotRun: typeof fetch = async () => {
      throw new Error("dry-run unexpectedly called an external service");
    };
    const pipeline = await buildPipeline(bundle, { fetch: externalCallMustNotRun });

    const result = await pipeline.turn({
      text: "开始扫地",
      language: "zh-CN",
      source: "openclaw",
    });

    expect(result).toMatchObject({
      status: "accepted",
      intent: "vacuum.start",
      target: "main_vacuum",
      resolver: "catalog_aliases",
      dry_run: true,
      data: { capability: "vacuum.start" },
    });
  });

  it("AI 解析失败时仍准确标记 dry-run，避免页面误报真实执行", async () => {
    const bundle = await loadBundle();
    bundle.config.provider.adapters.minimax!.api_key = "test";
    const pipeline = await buildPipeline(bundle, {
      fetch: async () => {
        throw new Error("provider timeout");
      },
    });

    const result = await pipeline.turn({
      text: "用一种没写进规则的说法处理地面",
      language: "zh-CN",
      source: "openclaw",
      dry_run: true,
    });

    expect(result).toMatchObject({
      status: "failed",
      resolver: "llm",
      dry_run: true,
      error_code: "PROVIDER_FAILED",
      llm_request: { model: bundle.config.provider.adapters.minimax!.model },
    });
  });

  it("能力级来源白名单可独立拒绝已认证输入源", async () => {
    const bundle = await loadBundle();
    bundle.config.security.allowed_sources.push("test_client");
    const pipeline = await buildPipeline(bundle, {
      fetch: async () => {
        throw new Error("external call must not run");
      },
    });

    const result = await pipeline.turn({
      text: "开始扫地",
      language: "zh-CN",
      source: "test_client",
    });

    expect(result).toMatchObject({
      status: "rejected",
      error_code: "CAPABILITY_SOURCE_NOT_ALLOWED",
    });
  });

  it("只有服务端许可后，请求才能关闭调试并真实调用执行器", async () => {
    const bundle = await loadBundle();
    bundle.config.discovery.enabled = false;
    bundle.config.home_assistant = {
      base_url: "http://ha.local:8123",
      token: "test-token",
      request_timeout_ms: 1_000,
    };
    const calls: string[] = [];
    const pipeline = await buildPipeline(bundle, {
      fetch: async (input) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ message: "API running." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const denied = await pipeline.turn({
      text: "检查系统健康",
      language: "zh-CN",
      source: "openclaw",
      dry_run: false,
    });
    expect(denied).toMatchObject({
      status: "rejected",
      error_code: "LIVE_EXECUTION_DISABLED",
    });
    expect(calls).toHaveLength(0);

    bundle.config.resolution.allow_live_execution = true;
    const allowedPipeline = await buildPipeline(bundle, {
      fetch: async (input) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ message: "API running." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const completed = await allowedPipeline.turn({
      text: "检查系统健康",
      language: "zh-CN",
      source: "openclaw",
      dry_run: false,
    });
    expect(completed).toMatchObject({ status: "completed", dry_run: false });
    expect(calls).toHaveLength(1);
  });

  it("存在占位 HA 实体时拒绝关闭全局 dry-run", async () => {
    const bundle = await loadRouterBundle(configPath, {
      INTENT_ROUTER_DRY_RUN: "false",
      INTENT_ROUTER_ALLOW_LIVE_EXECUTION: "true",
      HA_BASE_URL: "http://ha.local:8123",
      HA_TOKEN: "test-token",
    });

    await expect(buildPipeline(bundle)).rejects.toMatchObject({
      code: "CAPABILITY_PLACEHOLDER",
    });
  });
});
