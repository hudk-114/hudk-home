import { describe, expect, it, vi } from "vitest";
import { CatalogAliasResolver } from "./catalog-resolver.js";
import { CapabilityCatalog } from "./catalog.js";
import {
  buildDiscoveredCatalog,
  HomeAssistantDiscovery,
  type WebSocketFactory,
} from "./discovery.js";
import type { CapabilityCatalogData, DiscoveryConfig } from "./types.js";

const config: DiscoveryConfig = {
  enabled: true,
  sync_interval_seconds: 300,
  request_timeout_ms: 5_000,
  selection_mode: "any",
  selectors: [{ id: "router_label", protocol: "ha_label", labels: ["intent_router"] }],
  exclude_entity_categories: ["config", "diagnostic"],
  exclude_hidden: true,
  read_fallback: {
    enabled: true,
    domains: ["sensor", "binary_sensor", "event"],
    include_entity_categories: [],
  },
  templates: [
    {
      id: "vacuum.dock",
      intent: "vacuum.dock",
      match: { domains: ["vacuum"] },
      kind: "write",
      risk: "routine",
      allowed_sources: ["openclaw"],
      ha_action: "vacuum.return_to_base",
      confirmation: "never",
      success_criteria: "state_confirmed",
      failure_message: "回充失败",
      completed_states: ["docked"],
    },
    {
      id: "sensor.read_temperature",
      intent: "sensor.read",
      arguments: { metric: "temperature" },
      match: { domains: ["sensor"], device_classes: ["temperature"] },
      kind: "read",
      risk: "read",
    },
    {
      id: "vacuum.dock",
      intent: "vacuum.dock",
      match: { domains: ["script"], name_patterns: ["^(扫地机器人)?回充$"] },
      kind: "write",
      risk: "routine",
      allowed_sources: ["openclaw"],
      ha_action: "script.turn_on",
      confirmation: "never",
      success_criteria: "ha_accepted",
      failure_message: "回充脚本失败",
    },
    {
      id: "pet_feeder.feed_once",
      intent: "pet_feeder.feed_once",
      match: {
        domains: ["button"],
        name_patterns: ["手动.*出.*粮\\s*1\\s*份|feed[_ ]?once"],
      },
      kind: "write",
      risk: "sensitive",
      allowed_sources: ["home_assistant", "openclaw"],
      ha_action: "button.press",
      confirmation: "always",
      success_criteria: "ha_accepted",
      accepted_message: "已向猫粮机提交固定 1 份出粮指令。",
      failure_message: "猫粮机出粮失败",
    },
  ],
};

const baseCatalog: CapabilityCatalogData = {
  version: 1,
  targets: {},
  capabilities: {},
  policies: {
    unknown_intent: "reject",
    unknown_target: "clarify",
    model_confidence_threshold: 0.8,
    never_allow_generated_ha_service: true,
    never_allow_generated_entity_id: true,
  },
};

describe("Home Assistant discovery", () => {
  it("只导入带 Router 标签、非隐藏、非诊断且命中安全模板的实体", () => {
    const snapshot = buildDiscoveredCatalog({
      config,
      states: [
        {
          entity_id: "vacuum.roborock_s8",
          state: "idle",
          attributes: { friendly_name: "客厅石头扫地机" },
        },
        {
          entity_id: "sensor.bedroom_temperature",
          state: "23.4",
          attributes: { friendly_name: "卧室温度", device_class: "temperature" },
        },
        {
          entity_id: "sensor.secret_temperature",
          state: "22",
          attributes: { friendly_name: "未暴露温度", device_class: "temperature" },
        },
        {
          entity_id: "sensor.bedroom_aux_temperature",
          state: "23.1",
          attributes: { friendly_name: "卧室备用温度", device_class: "temperature" },
        },
        {
          entity_id: "sensor.device_diagnostic",
          state: "21",
          attributes: { friendly_name: "诊断温度", device_class: "temperature" },
        },
        {
          entity_id: "script.vacuum_dock",
          state: "off",
          attributes: { friendly_name: "扫地机器人回充" },
        },
      ],
      registry: {
        entity_categories: { "0": "diagnostic" },
        entities: [
          { ei: "vacuum.roborock_s8", di: "device-vacuum", en: "石头 S8", lb: ["intent_router"] },
          { ei: "sensor.bedroom_temperature", di: "device-bedroom", en: "卧室温度", lb: ["intent_router"] },
          { ei: "sensor.secret_temperature", di: "device-secret" },
          { ei: "sensor.bedroom_aux_temperature", di: "device-bedroom", lb: ["intent_router"] },
          { ei: "sensor.device_diagnostic", di: "device-diag", ec: 0, lb: ["intent_router"] },
          { ei: "script.vacuum_dock", en: "扫地机器人回充", lb: ["intent_router"] },
        ],
      },
      exposure: { exposed_entities: {} },
      labels: [{ label_id: "intent_router", name: "intent_router" }],
      devices: [
        { id: "device-bedroom", area_id: "bedroom", name: "卧室传感器" },
      ],
      areas: [{ area_id: "bedroom", name: "卧室" }],
      services: [
        { domain: "vacuum", services: ["return_to_base"] },
        { domain: "script", services: ["turn_on"] },
      ],
    });

    expect(Object.keys(snapshot.targets)).toHaveLength(3);
    expect(Object.keys(snapshot.capabilities)).toHaveLength(3);
    expect(Object.values(snapshot.targets)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ display_name: "卧室", area: "卧室" }),
      ]),
    );
    expect(Object.values(snapshot.capabilities)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ha_action: "vacuum.return_to_base",
          ha_entity_id: "vacuum.roborock_s8",
        }),
        expect.objectContaining({ ha_entity_id: "sensor.bedroom_temperature" }),
        expect.objectContaining({
          ha_action: "script.turn_on",
          ha_entity_id: "script.vacuum_dock",
        }),
      ]),
    );

    const catalog = new CapabilityCatalog(baseCatalog);
    catalog.replaceDiscovered(snapshot);
    const publicCatalog = JSON.stringify(catalog.publicDescription());
    expect(publicCatalog).toContain("客厅石头扫地机");
    expect(publicCatalog).not.toContain("vacuum.roborock_s8");
    expect(publicCatalog).not.toContain("sensor.bedroom_temperature");
  });

  it("能按自动发现的友好名称直接解析，多个候选时要求澄清", async () => {
    const catalog = new CapabilityCatalog(baseCatalog);
    catalog.replaceDiscovered({
      targets: {
        ha_first: { display_name: "客厅石头扫地机", aliases: ["石头"] },
        ha_second: { display_name: "楼上扫地机", aliases: [] },
      },
      capabilities: {
        "vacuum.dock@ha_first": {
          target: "ha_first",
          kind: "write",
          risk: "routine",
        },
        "vacuum.dock@ha_second": {
          target: "ha_second",
          kind: "write",
          risk: "routine",
        },
      },
    });
    const resolver = new CatalogAliasResolver(catalog);

    await expect(
      resolver.resolve({ text: "让石头回充", language: "zh-CN", source: "openclaw" }),
    ).resolves.toMatchObject({
      kind: "intent",
      intent: { intent: "vacuum.dock", target: "ha_first" },
    });
    await expect(
      resolver.resolve({ text: "扫地机回充", language: "zh-CN", source: "openclaw" }),
    ).resolves.toMatchObject({ kind: "clarification", errorCode: "TARGET_AMBIGUOUS" });
  });

  it("给只读实体加标签后无需模板即可发现，并按实体而不是设备区分目标", async () => {
    const snapshot = buildDiscoveredCatalog({
      config: {
        ...config,
        read_fallback: {
          enabled: true,
          domains: ["sensor", "binary_sensor", "event"],
          include_entity_categories: ["diagnostic"],
        },
      },
      states: [
        {
          entity_id: "sensor.petkit_litter_weight",
          state: "3.2",
          attributes: { friendly_name: "小佩猫砂盆 猫砂重量", unit_of_measurement: "kg" },
        },
        {
          entity_id: "binary_sensor.petkit_litter_low",
          state: "off",
          attributes: { friendly_name: "小佩猫砂盆 猫砂缺少" },
        },
        {
          entity_id: "sensor.petkit_battery",
          state: "82",
          attributes: { friendly_name: "猫砂盆智能净味器 电池", unit_of_measurement: "%" },
        },
        {
          entity_id: "switch.petkit_clean",
          state: "off",
          attributes: { friendly_name: "小佩猫砂盆 清理" },
        },
      ],
      registry: {
        entity_categories: { "0": "diagnostic" },
        entities: [
          {
            ei: "sensor.petkit_litter_weight",
            di: "device-litter-box",
            en: "猫砂重量",
            lb: ["intent_router"],
          },
          {
            ei: "binary_sensor.petkit_litter_low",
            di: "device-litter-box",
            en: "猫砂缺少",
            lb: ["intent_router"],
          },
          {
            ei: "sensor.petkit_battery",
            di: "device-deodorizer",
            en: "电池",
            ec: 0,
            lb: ["intent_router"],
          },
          {
            ei: "switch.petkit_clean",
            di: "device-litter-box",
            en: "清理",
            lb: ["intent_router"],
          },
        ],
      },
      exposure: { exposed_entities: {} },
      labels: [{ label_id: "intent_router", name: "intent_router" }],
      devices: [
        { id: "device-litter-box", name: "小佩智能全自动猫厕所 MAX2", area_id: "living_room" },
        { id: "device-deodorizer", name: "猫砂盆-智能净味器", area_id: "living_room" },
      ],
      areas: [{ area_id: "living_room", name: "客厅" }],
      services: [],
    });

    expect(Object.keys(snapshot.targets)).toHaveLength(3);
    expect(Object.keys(snapshot.capabilities)).toHaveLength(3);
    expect(Object.keys(snapshot.capabilities)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^entity\.read@ha_/),
      ]),
    );
    expect(Object.values(snapshot.targets)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display_name: "小佩智能全自动猫厕所 MAX2 猫砂重量",
          area: "客厅",
        }),
        expect.objectContaining({
          display_name: "小佩智能全自动猫厕所 MAX2 猫砂缺少",
        }),
        expect.objectContaining({ display_name: "猫砂盆-智能净味器 电池" }),
      ]),
    );
    expect(JSON.stringify(snapshot)).not.toContain("switch.petkit_clean");

    const catalog = new CapabilityCatalog(baseCatalog);
    catalog.replaceDiscovered(snapshot);
    const publicCatalog = JSON.stringify(catalog.publicDescription());
    expect(publicCatalog).toContain("entity.read");
    expect(publicCatalog).not.toContain("sensor.petkit_litter_weight");
    expect(publicCatalog).not.toContain("binary_sensor.petkit_litter_low");

    const resolver = new CatalogAliasResolver(catalog);
    await expect(
      resolver.resolve({
        text: "客厅小佩猫砂盆的猫砂重量还有多少",
        language: "zh-CN",
        source: "openclaw",
      }),
    ).resolves.toMatchObject({
      kind: "intent",
      intent: { intent: "entity.read", arguments: {} },
    });
  });

  it("只把明确标记的固定一份出粮按钮映射为敏感写能力", async () => {
    const snapshot = buildDiscoveredCatalog({
      config,
      states: [
        {
          entity_id: "button.homerun_feed_once",
          state: "unknown",
          attributes: { friendly_name: "霍曼喂食器 手动出粮 1 份" },
        },
        {
          entity_id: "button.homerun_reset",
          state: "unknown",
          attributes: { friendly_name: "霍曼喂食器 恢复出厂设置" },
        },
      ],
      registry: {
        entities: [
          {
            ei: "button.homerun_feed_once",
            di: "device-homerun",
            en: "手动出粮 1 份",
            lb: ["intent_router"],
          },
          {
            ei: "button.homerun_reset",
            di: "device-homerun",
            en: "恢复出厂设置",
            lb: ["intent_router"],
          },
        ],
      },
      exposure: { exposed_entities: {} },
      labels: [{ label_id: "intent_router", name: "intent_router" }],
      devices: [{ id: "device-homerun", name: "霍曼智能喂食器", area_id: "living_room" }],
      areas: [{ area_id: "living_room", name: "客厅" }],
      services: [{ domain: "button", services: ["press"] }],
    });

    expect(Object.keys(snapshot.targets)).toHaveLength(1);
    expect(Object.keys(snapshot.capabilities)).toHaveLength(1);
    expect(Object.values(snapshot.capabilities)).toEqual([
      expect.objectContaining({
        kind: "write",
        risk: "sensitive",
        ha_action: "button.press",
        ha_entity_id: "button.homerun_feed_once",
        confirmation: "always",
        success_criteria: "ha_accepted",
      }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("button.homerun_reset");

    const catalog = new CapabilityCatalog(baseCatalog);
    catalog.replaceDiscovered(snapshot);
    const publicCatalog = JSON.stringify(catalog.publicDescription());
    expect(publicCatalog).toContain("pet_feeder.feed_once");
    expect(publicCatalog).not.toContain("button.homerun_feed_once");

    const resolver = new CatalogAliasResolver(catalog);
    await expect(
      resolver.resolve({
        text: "让霍曼出一份粮",
        language: "zh-CN",
        source: "openclaw",
      }),
    ).resolves.toMatchObject({
      kind: "intent",
      intent: { intent: "pet_feeder.feed_once", arguments: {} },
    });
  });

  it("已有 HA 实体时不再向 LLM 公开同类的静态占位能力", () => {
    const catalog = new CapabilityCatalog({
      ...baseCatalog,
      targets: {
        placeholder_sensor: {
          display_name: "环境传感器",
          aliases: [],
          area: "replace_locally",
        },
      },
      capabilities: {
        "sensor.read_temperature": {
          target: "placeholder_sensor",
          kind: "read",
          risk: "read",
          ha_entity_id: "sensor.REPLACE_WITH_TEMPERATURE_ENTITY_ID",
        },
      },
    });
    catalog.replaceDiscovered({
      targets: {
        ha_bedroom: {
          display_name: "青萍空气检测仪",
          aliases: ["卧室"],
          area: "卧室",
        },
      },
      capabilities: {
        "sensor.read_temperature@ha_bedroom": {
          target: "ha_bedroom",
          kind: "read",
          risk: "read",
          ha_entity_id: "sensor.real_temperature",
        },
      },
    });

    expect(catalog.publicDescription()).toMatchObject({
      targets: [{ id: "ha_bedroom", area: "卧室" }],
      capabilities: [{
        id: "sensor.read_temperature",
        target: "ha_bedroom",
        source: "home_assistant",
      }],
    });
  });

  it("发现真实 HA 能力后隐藏并禁用静态兼容 fallback", async () => {
    const catalog = new CapabilityCatalog({
      ...baseCatalog,
      targets: {
        main_pet_feeder: {
          display_name: "主猫粮机",
          aliases: ["猫粮机", "霍曼"],
        },
      },
      capabilities: {
        "pet_feeder.feed_once": {
          target: "main_pet_feeder",
          kind: "write",
          risk: "sensitive",
          fallback_when_discovered: true,
          allowed_sources: ["openclaw"],
          ha_action: "script.turn_on",
          ha_entity_id: "script.hudk_homerun_feed_once",
          confirmation: "always",
          success_criteria: "ha_accepted",
          failure_message: "出粮失败",
        },
      },
    });
    catalog.replaceDiscovered({
      targets: {
        ha_homerun: {
          display_name: "霍曼-Real 智能喂食器",
          aliases: ["霍曼", "喂食器"],
          area: "客厅",
        },
      },
      capabilities: {
        "pet_feeder.feed_once@ha_homerun": {
          target: "ha_homerun",
          kind: "write",
          risk: "sensitive",
          allowed_sources: ["openclaw"],
          ha_action: "button.press",
          ha_entity_id: "button.homerun_feed_once",
          confirmation: "always",
          success_criteria: "ha_accepted",
          failure_message: "出粮失败",
        },
      },
    });

    expect(catalog.publicDescription()).toMatchObject({
      targets: [{ id: "ha_homerun", display_name: "霍曼-Real 智能喂食器" }],
      capabilities: [{
        id: "pet_feeder.feed_once",
        target: "ha_homerun",
        source: "home_assistant",
      }],
    });
    expect(catalog.targetsForCapability("pet_feeder.feed_once")).toEqual([
      "ha_homerun",
    ]);
    expect(catalog.resolve({
      version: "1.0",
      intent: "pet_feeder.feed_once",
      target: "main_pet_feeder",
      arguments: {},
      confidence: 1,
      needs_confirmation: false,
      clarification: null,
    })).toBeNull();

    const resolver = new CatalogAliasResolver(catalog);
    await expect(resolver.resolve({
      text: "给猫加餐",
      language: "zh-CN",
      source: "openclaw",
    })).resolves.toMatchObject({
      kind: "intent",
      intent: { target: "ha_homerun", intent: "pet_feeder.feed_once" },
    });
  });

  it("没有发现真实 HA 能力时继续使用静态兼容 fallback", async () => {
    const catalog = new CapabilityCatalog({
      ...baseCatalog,
      targets: {
        main_pet_feeder: { display_name: "主猫粮机", aliases: ["猫粮机"] },
      },
      capabilities: {
        "pet_feeder.feed_once": {
          target: "main_pet_feeder",
          kind: "write",
          risk: "sensitive",
          fallback_when_discovered: true,
          allowed_sources: ["openclaw"],
          ha_action: "script.turn_on",
          ha_entity_id: "script.hudk_homerun_feed_once",
          confirmation: "always",
          success_criteria: "ha_accepted",
          failure_message: "出粮失败",
        },
      },
    });

    expect(catalog.targetsForCapability("pet_feeder.feed_once")).toEqual([
      "main_pet_feeder",
    ]);
    const resolver = new CatalogAliasResolver(catalog);
    await expect(resolver.resolve({
      text: "给猫加餐",
      language: "zh-CN",
      source: "openclaw",
    })).resolves.toMatchObject({
      kind: "intent",
      intent: { target: "main_pet_feeder", intent: "pet_feeder.feed_once" },
    });
  });

  it("同步失败时保留最近一次成功目录", async () => {
    let failRest = false;
    const mockedFetch = vi.fn<typeof fetch>(async (input) => {
      if (failRest) throw new Error("HA offline");
      const url = String(input);
      const body = url.endsWith("/api/states")
        ? [{
            entity_id: "vacuum.roborock_s8",
            state: "idle",
            attributes: { friendly_name: "客厅石头扫地机" },
          }]
        : [{ domain: "vacuum", services: { return_to_base: {} } }];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const socketFactory: WebSocketFactory = () => {
      let messageListener: ((event: { data: string }) => void) | null = null;
      return {
        addEventListener(type: string, listener: (event: { data: string }) => void) {
          if (type !== "message") return;
          messageListener = listener;
          queueMicrotask(() => listener({ data: JSON.stringify({ type: "auth_required" }) }));
        },
        send(data: string) {
          const message = JSON.parse(data) as { id?: number; type: string };
          if (message.type === "auth") {
            messageListener?.({ data: JSON.stringify({ type: "auth_ok" }) });
          } else if (message.id === 1) {
            messageListener?.({
              data: JSON.stringify({
                id: 1,
                type: "result",
                success: true,
                result: {
                  entities: [{
                    ei: "vacuum.roborock_s8",
                    di: "device-vacuum",
                    lb: ["intent_router"],
                  }],
                },
              }),
            });
          } else if (message.id === 2) {
            messageListener?.({
              data: JSON.stringify({
                id: 2,
                type: "result",
                success: true,
                result: {
                  exposed_entities: {},
                },
              }),
            });
          } else if (message.id === 3) {
            messageListener?.({
              data: JSON.stringify({
                id: 3,
                type: "result",
                success: true,
                result: [{ label_id: "intent_router", name: "intent_router" }],
              }),
            });
          } else if (message.id === 4) {
            messageListener?.({
              data: JSON.stringify({
                id: 4,
                type: "result",
                success: true,
                result: [{ id: "device-vacuum", area_id: "living_room" }],
              }),
            });
          } else if (message.id === 5) {
            messageListener?.({
              data: JSON.stringify({
                id: 5,
                type: "result",
                success: true,
                result: [{ area_id: "living_room", name: "客厅" }],
              }),
            });
          }
        },
        close() {},
      } as ReturnType<WebSocketFactory>;
    };
    const catalog = new CapabilityCatalog(baseCatalog);
    const discovery = new HomeAssistantDiscovery(
      config,
      {
        base_url: "http://ha.local:8123",
        token: "test-token",
        request_timeout_ms: 1_000,
      },
      catalog,
      mockedFetch,
      socketFactory,
    );

    await expect(discovery.sync()).resolves.toMatchObject({
      status: "ok",
      discovered_targets: 1,
      discovered_capabilities: 1,
    });
    failRest = true;
    await expect(discovery.sync()).resolves.toMatchObject({
      status: "degraded",
      discovered_targets: 1,
      discovered_capabilities: 1,
    });
    expect(JSON.stringify(catalog.publicDescription())).toContain("客厅石头扫地机");
  });

  it("通过 Supervisor 的专用 WebSocket 代理路径发现能力", async () => {
    let socketUrl = "";
    const mockedFetch = vi.fn<typeof fetch>(async (input) => {
      const body = String(input).endsWith("/api/states") ? [] : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const socketFactory: WebSocketFactory = (url) => {
      socketUrl = url;
      return {
        addEventListener() {},
        send() {},
        close() {},
      } as ReturnType<WebSocketFactory>;
    };
    const discovery = new HomeAssistantDiscovery(
      { ...config, request_timeout_ms: 1 },
      {
        base_url: "http://supervisor/core",
        token: "supervisor-token",
        request_timeout_ms: 1,
      },
      new CapabilityCatalog(baseCatalog),
      mockedFetch,
      socketFactory,
    );

    await discovery.sync();
    expect(socketUrl).toBe("ws://supervisor/core/websocket");
  });
});
