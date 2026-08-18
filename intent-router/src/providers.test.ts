import { describe, expect, it } from "vitest";
import { CapabilityCatalog } from "./catalog.js";
import { OpenAICompatibleProvider } from "./providers.js";
import type { CapabilityCatalogData } from "./types.js";

describe("OpenAICompatibleProvider", () => {
  it("为 M3 关闭推理并发送按能力目录收窄的工具 Schema", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchMock: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  arguments: JSON.stringify({
                    version: "1.0",
                    intent: "sensor.read",
                    target: "bedroom_air",
                    arguments: { metric: "pm25" },
                    confidence: 0.95,
                    needs_confirmation: false,
                    clarification: null,
                  }),
                },
              }],
            },
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const catalog = new CapabilityCatalog({
      version: 1,
      targets: {
        bedroom_air: { display_name: "卧室空气检测仪", aliases: [] },
      },
      capabilities: {
        "sensor.read_pm25": {
          target: "bedroom_air",
          kind: "read",
          risk: "read",
          ha_entity_id: "sensor.bedroom_pm25",
        },
      },
      policies: {
        unknown_intent: "reject",
        unknown_target: "clarify",
        model_confidence_threshold: 0.8,
        never_allow_generated_ha_service: true,
        never_allow_generated_entity_id: true,
      },
    } satisfies CapabilityCatalogData);
    const provider = new OpenAICompatibleProvider(
      "minimax",
      {
        protocol: "openai_compatible",
        base_url: "https://example.invalid/v1",
        api_key: "test",
        model: "MiniMax-M3",
        thinking: "disabled",
        max_completion_tokens: 1024,
      },
      {
        type: "object",
        required: ["version", "intent", "target", "arguments", "confidence"],
        properties: {
          version: { const: "1.0" },
          intent: { type: "string", enum: ["sensor.read", "vacuum.start"] },
          target: { type: "string" },
          arguments: {
            type: "object",
            properties: {
              metric: { type: "string", enum: ["pm25", "co2"] },
            },
          },
          confidence: { type: "number" },
        },
        allOf: [{ if: {}, then: {} }],
      },
      catalog,
      fetchMock,
    );

    await provider.resolve({
      text: "看看空气",
      language: "zh-CN",
      source: "openclaw",
    });

    expect(requestBody).toMatchObject({
      model: "MiniMax-M3",
      thinking: { type: "disabled" },
      max_completion_tokens: 1024,
    });
    const parameters = ((requestBody?.tools as Array<{
      function: { parameters: Record<string, unknown> };
    }>)[0]?.function.parameters);
    expect(parameters).not.toHaveProperty("allOf");
    expect(parameters).not.toHaveProperty("$schema");
    expect(parameters).toMatchObject({
      required: ["version", "intent", "target", "arguments", "confidence"],
      properties: {
        version: { type: "string", enum: ["1.0"] },
        intent: { enum: ["sensor.read"] },
        target: { enum: ["bedroom_air"] },
        arguments: { properties: { metric: { enum: ["pm25"] } } },
      },
    });
  });
});
