import { describe, expect, it, vi } from "vitest";
import { HomeAssistantExecutor } from "./executors.js";
import type { CapabilityDefinition, NormalizedIntent } from "./types.js";

const intent: NormalizedIntent = {
  version: "1.0",
  intent: "vacuum.start",
  target: "main_vacuum",
  arguments: { entity_id: "vacuum.untrusted" },
  confidence: 1,
};

describe("HomeAssistantExecutor", () => {
  it("只调用能力目录映射的 HA action 和 entity_id", async () => {
    const mockedFetch = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify([{ context: { id: "ctx-1" } }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const executor = new HomeAssistantExecutor(
      {
        base_url: "http://ha.local:8123",
        token: "test-token",
        request_timeout_ms: 1_000,
      },
      mockedFetch,
    );
    const capability: CapabilityDefinition = {
      target: "main_vacuum",
      kind: "write",
      risk: "routine",
      ha_action: "script.turn_on",
      ha_entity_id: "script.hudk_vacuum_start",
      confirmation: "never",
      accepted_message: "已通知扫地机器人开始清扫。",
    };

    const result = await executor.execute("vacuum.start", capability, intent);

    expect(result).toMatchObject({
      status: "accepted",
      message: "已通知扫地机器人开始清扫。",
      haContextId: "ctx-1",
    });
    expect(mockedFetch).toHaveBeenCalledOnce();
    const [url, init] = mockedFetch.mock.calls[0]!;
    expect(url).toBe("http://ha.local:8123/api/services/script/turn_on");
    expect(JSON.parse(String(init?.body))).toEqual({
      entity_id: "script.hudk_vacuum_start",
    });
  });

  it("只把模板明确声明的意图参数映射到 HA action", async () => {
    const mockedFetch = vi.fn<typeof fetch>(async () =>
      new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const executor = new HomeAssistantExecutor(
      {
        base_url: "http://ha.local:8123",
        token: "test-token",
        request_timeout_ms: 1_000,
      },
      mockedFetch,
    );
    const capability: CapabilityDefinition = {
      target: "ha_climate",
      kind: "write",
      risk: "routine",
      ha_action: "climate.set_temperature",
      ha_entity_id: "climate.living_room",
      argument_mapping: { temperature_c: "temperature" },
      confirmation: "never",
      success_criteria: "ha_accepted",
    };
    const climateIntent: NormalizedIntent = {
      version: "1.0",
      intent: "climate.set_temperature",
      target: "ha_climate",
      arguments: { temperature_c: 24, entity_id: "climate.untrusted" },
      confidence: 1,
    };

    await executor.execute("climate.set_temperature", capability, climateIntent);

    const [, init] = mockedFetch.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      entity_id: "climate.living_room",
      temperature: 24,
    });
  });

  it("优先使用 HA last_reported 判断传感器是否仍在上报", async () => {
    const now = Date.now();
    const mockedFetch = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          entity_id: "sensor.bedroom_temperature",
          state: "24.3",
          attributes: { unit_of_measurement: "°C" },
          last_updated: new Date(now - 60 * 60 * 1_000).toISOString(),
          last_reported: new Date(now - 30 * 1_000).toISOString(),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const executor = new HomeAssistantExecutor(
      {
        base_url: "http://ha.local:8123",
        token: "test-token",
        request_timeout_ms: 1_000,
      },
      mockedFetch,
    );
    const capability: CapabilityDefinition = {
      target: "bedroom_sensor",
      kind: "read",
      risk: "read",
      ha_entity_id: "sensor.bedroom_temperature",
      max_state_age_seconds: 900,
    };

    const result = await executor.execute("sensor.read_temperature", capability, {
      version: "1.0",
      intent: "sensor.read",
      target: "bedroom_sensor",
      arguments: { metric: "temperature" },
      confidence: 1,
    });

    expect(result).toMatchObject({
      status: "completed",
      message: "温度当前为 24.3°C。",
      data: {
        state: "24.3",
        last_reported: new Date(now - 30 * 1_000).toISOString(),
      },
    });
  });

  it("last_reported 确实过期时返回时间和过期时长", async () => {
    const oldTimestamp = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
    const mockedFetch = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          entity_id: "sensor.bedroom_temperature",
          state: "24.3",
          attributes: { unit_of_measurement: "°C" },
          last_updated: oldTimestamp,
          last_reported: oldTimestamp,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const executor = new HomeAssistantExecutor(
      {
        base_url: "http://ha.local:8123",
        token: "test-token",
        request_timeout_ms: 1_000,
      },
      mockedFetch,
    );
    const capability: CapabilityDefinition = {
      target: "bedroom_sensor",
      kind: "read",
      risk: "read",
      ha_entity_id: "sensor.bedroom_temperature",
      max_state_age_seconds: 900,
    };

    const result = await executor.execute("sensor.read_temperature", capability, {
      version: "1.0",
      intent: "sensor.read",
      target: "bedroom_sensor",
      arguments: { metric: "temperature" },
      confidence: 1,
    });

    expect(result).toMatchObject({
      status: "failed",
      errorCode: "STATE_STALE",
      data: { last_reported: oldTimestamp },
    });
    expect(result.message).toContain(oldTimestamp);
    expect(result.message).toContain("约 60 分钟前");
  });
});
