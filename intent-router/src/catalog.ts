import { RouterError } from "./errors.js";
import type {
  CapabilityCatalogData,
  CapabilityDefinition,
  NormalizedIntent,
  TargetDefinition,
} from "./types.js";

export interface DiscoveredCatalogSnapshot {
  targets: Record<string, TargetDefinition>;
  capabilities: Record<string, CapabilityDefinition>;
}

export class CapabilityCatalog {
  private discovered: DiscoveredCatalogSnapshot = { targets: {}, capabilities: {} };

  constructor(readonly data: CapabilityCatalogData) {}

  replaceDiscovered(snapshot: DiscoveredCatalogSnapshot): void {
    this.discovered = structuredClone(snapshot);
  }

  capabilityKey(intent: NormalizedIntent): string | null {
    if (intent.intent === "sensor.read") {
      const metric = intent.arguments.metric;
      return typeof metric === "string" ? `sensor.read_${metric}` : null;
    }
    return intent.intent;
  }

  resolve(intent: NormalizedIntent): {
    key: string;
    definition: CapabilityDefinition;
  } | null {
    const key = this.capabilityKey(intent);
    if (!key) return null;
    const staticDefinition = this.data.capabilities[key];
    if (staticDefinition?.target === intent.target) {
      return { key, definition: staticDefinition };
    }
    const discoveredKey = `${key}@${intent.target}`;
    const discoveredDefinition = this.discovered.capabilities[discoveredKey];
    if (discoveredDefinition) {
      return { key: discoveredKey, definition: discoveredDefinition };
    }
    return staticDefinition ? { key, definition: staticDefinition } : null;
  }

  targetsForCapability(capabilityId: string): string[] {
    const discoveredTargets = new Set<string>();
    for (const [key, definition] of Object.entries(this.discovered.capabilities)) {
      if (key.startsWith(`${capabilityId}@`)) discoveredTargets.add(definition.target);
    }
    if (discoveredTargets.size > 0) return [...discoveredTargets];
    const staticDefinition = this.data.capabilities[capabilityId];
    return staticDefinition ? [staticDefinition.target] : [];
  }

  target(id: string): TargetDefinition | undefined {
    return this.data.targets[id] ?? this.discovered.targets[id];
  }

  hasPlaceholderMapping(capability: CapabilityDefinition): boolean {
    return [capability.ha_entity_id, capability.verification_entity_id].some(
      (value) => value?.toUpperCase().includes("REPLACE_WITH"),
    );
  }

  publicDescription(): Record<string, unknown> {
    const discoveredCapabilityIds = new Set(
      Object.keys(this.discovered.capabilities).map((key) => key.slice(0, key.indexOf("@"))),
    );
    const staticCapabilities = Object.entries(this.data.capabilities).filter(
      ([id, capability]) =>
        !(discoveredCapabilityIds.has(id) && this.hasPlaceholderMapping(capability)),
    );
    const discoveredCapabilities = Object.entries(this.discovered.capabilities);
    const referencedTargets = new Set([
      ...staticCapabilities.map(([, capability]) => capability.target),
      ...discoveredCapabilities.map(([, capability]) => capability.target),
    ]);
    const targets = Object.entries({
      ...this.data.targets,
      ...this.discovered.targets,
    }).filter(([id]) => referencedTargets.has(id));
    return {
      targets: targets.map(([id, target]) => ({
        id,
        display_name: target.display_name,
        aliases: target.aliases,
        ...(target.area ? { area: target.area } : {}),
      })),
      capabilities: [
        ...staticCapabilities.map(([id, capability]) => ({
          id,
          target: capability.target,
          kind: capability.kind,
          risk: capability.risk,
          source: "static",
        })),
        ...discoveredCapabilities.map(([key, capability]) => ({
          id: key.slice(0, key.indexOf("@")),
          target: capability.target,
          kind: capability.kind,
          risk: capability.risk,
          source: "home_assistant",
        })),
      ],
    };
  }

  assertValid(dryRun = true): void {
    if (
      !this.data.policies.never_allow_generated_ha_service ||
      !this.data.policies.never_allow_generated_entity_id
    ) {
      throw new RouterError(
        "能力目录不能关闭模型 HA service/entity_id 隔离策略",
        "INVALID_CAPABILITY_CATALOG",
      );
    }
    for (const [key, capability] of Object.entries(this.data.capabilities)) {
      if (!this.data.targets[capability.target] && capability.target !== "home") {
        throw new RouterError(
          `能力 ${key} 引用了未知目标 ${capability.target}`,
          "INVALID_CAPABILITY_CATALOG",
        );
      }
      if (capability.kind === "write") {
        const missing = [
          !capability.risk && "risk",
          !capability.allowed_sources?.length && "allowed_sources",
          !capability.ha_action && "ha_action",
          !capability.ha_entity_id && "ha_entity_id",
          !capability.confirmation && "confirmation",
          !capability.success_criteria && "success_criteria",
          !capability.failure_message && "failure_message",
        ].filter(Boolean);
        if (missing.length > 0) {
          throw new RouterError(
            `写能力 ${key} 缺少安全配置：${missing.join(", ")}`,
            "INVALID_CAPABILITY_CATALOG",
          );
        }
        if (
          capability.success_criteria === "state_confirmed" &&
          (!capability.verification_entity_id ||
            (capability.completed_states ?? []).length === 0)
        ) {
          throw new RouterError(
            `写能力 ${key} 的 state_confirmed 缺少验证实体或完成状态`,
            "INVALID_CAPABILITY_CATALOG",
          );
        }
        if (
          (capability.risk === "sensitive" || capability.risk === "critical") &&
          capability.confirmation !== "always"
        ) {
          throw new RouterError(
            `高风险写能力 ${key} 必须配置 confirmation: always`,
            "INVALID_CAPABILITY_CATALOG",
          );
        }
        if (Object.values(capability.argument_mapping ?? {}).includes("entity_id")) {
          throw new RouterError(
            `写能力 ${key} 不能把意图参数映射为 entity_id`,
            "INVALID_CAPABILITY_CATALOG",
          );
        }
      }
      if (
        !dryRun &&
        [capability.ha_entity_id, capability.verification_entity_id].some(
          (value) => value?.toUpperCase().includes("REPLACE_WITH"),
        )
      ) {
        throw new RouterError(
          `能力 ${key} 仍含占位实体，不能关闭 dry-run`,
          "CAPABILITY_PLACEHOLDER",
        );
      }
    }
  }
}
