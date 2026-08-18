import { createHash } from "node:crypto";
import { RouterError, errorMessage } from "./errors.js";
import type { DiscoveredCatalogSnapshot } from "./catalog.js";
import { CapabilityCatalog } from "./catalog.js";
import type {
  CapabilityDefinition,
  DiscoveryConfig,
  DiscoveryService,
  DiscoverySelector,
  DiscoveryStatus,
  DiscoveryTemplate,
  RouterConfig,
  TargetDefinition,
} from "./types.js";

export interface HaStateSummary {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface HaEntityRegistryDisplay {
  ei: string;
  di?: string | null;
  ai?: string | null;
  en?: string | null;
  ec?: number | null;
  hb?: boolean | null;
  lb?: string[];
}

export interface HaEntityRegistryResult {
  entity_categories?: Record<string, string>;
  entities?: HaEntityRegistryDisplay[];
}

export interface HaExposureResult {
  exposed_entities?: Record<string, Record<string, boolean>>;
}

export interface HaDeviceRegistryEntry {
  id: string;
  area_id?: string | null;
  name?: string | null;
  name_by_user?: string | null;
}

export interface HaAreaRegistryEntry {
  area_id: string;
  name: string;
  aliases?: string[];
}

export interface HaLabelRegistryEntry {
  label_id?: string;
  id?: string;
  name: string;
}

export interface HaServiceSummary {
  domain: string;
  services: Record<string, unknown> | string[];
}

interface WebSocketMessageEventLike {
  data: string | ArrayBuffer | ArrayBufferView;
}

interface WebSocketLike {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: WebSocketMessageEventLike) => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(type: "close", listener: () => void): void;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

function targetId(seed: string): string {
  return `ha_${createHash("sha256").update(seed).digest("hex").slice(0, 12)}`;
}

function textAttribute(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function entityDomain(entityId: string): string {
  return entityId.split(".", 1)[0] ?? "";
}

function serviceSet(services: HaServiceSummary[]): Set<string> {
  const result = new Set<string>();
  for (const domain of services) {
    const actions = Array.isArray(domain.services)
      ? domain.services
      : Object.keys(domain.services ?? {});
    for (const action of actions) {
      result.add(`${domain.domain}.${action}`);
    }
  }
  return result;
}

function templateMatches(
  template: DiscoveryTemplate,
  state: HaStateSummary,
  entity: HaEntityRegistryDisplay,
): boolean {
  if (!template.match.domains.includes(entityDomain(state.entity_id))) return false;
  const classes = template.match.device_classes;
  if (classes?.length) {
    const deviceClass = textAttribute(state.attributes.device_class);
    if (deviceClass === null || !classes.includes(deviceClass)) return false;
  }
  const units = template.match.units;
  if (units?.length) {
    const unit = textAttribute(state.attributes.unit_of_measurement);
    if (unit === null || !units.includes(unit)) return false;
  }
  const patterns = template.match.name_patterns;
  if (patterns?.length) {
    const names = [
      textAttribute(state.attributes.friendly_name),
      textAttribute(entity.en),
    ].filter((name): name is string => Boolean(name));
    if (
      !patterns.some((pattern) => {
        const expression = new RegExp(pattern, "iu");
        return names.some((name) => expression.test(name));
      })
    ) return false;
  }
  return true;
}

function resolvedLabelIds(
  selector: DiscoverySelector,
  labels: HaLabelRegistryEntry[],
): Set<string> {
  const requested = new Set(selector.labels ?? []);
  return new Set(
    labels
      .filter((label) => {
        const id = label.label_id ?? label.id;
        return requested.has(label.name) || (id !== undefined && requested.has(id));
      })
      .map((label) => label.label_id ?? label.id)
      .filter((id): id is string => Boolean(id)),
  );
}

function selectorMatches(input: {
  selector: DiscoverySelector;
  entity: HaEntityRegistryDisplay;
  exposure: HaExposureResult;
  labels: HaLabelRegistryEntry[];
}): boolean {
  if (input.selector.protocol === "conversation_exposure") {
    return input.exposure.exposed_entities?.[input.entity.ei]?.conversation === true;
  }
  const allowedLabels = resolvedLabelIds(input.selector, input.labels);
  return (input.entity.lb ?? []).some((label) => allowedLabels.has(label));
}

function mergeAliases(target: TargetDefinition, aliases: Array<string | null>): void {
  const normalized = new Set(target.aliases);
  for (const alias of aliases) {
    if (alias && alias !== target.display_name) normalized.add(alias);
  }
  target.aliases = [...normalized];
}

function commonDisplayName(names: string[]): string | null {
  if (names.length < 2) return null;
  let prefix = names[0] ?? "";
  for (const name of names.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < name.length && prefix[index] === name[index]) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
    if (!prefix) return null;
  }
  const cleaned = prefix.replace(/[\s\-_/：:]+$/u, "").replace(/\s+/gu, " ").trim();
  return cleaned.length >= 2 ? cleaned : null;
}

function capabilityFromTemplate(
  template: DiscoveryTemplate,
  target: string,
  entityId: string,
): CapabilityDefinition {
  return {
    target,
    kind: template.kind,
    risk: template.risk,
    ha_entity_id: entityId,
    ...(template.allowed_sources ? { allowed_sources: [...template.allowed_sources] } : {}),
    ...(template.ha_action ? { ha_action: template.ha_action } : {}),
    ...(template.kind === "write" && template.success_criteria === "state_confirmed"
      ? { verification_entity_id: entityId }
      : {}),
    ...(template.confirmation ? { confirmation: template.confirmation } : {}),
    ...(template.success_criteria ? { success_criteria: template.success_criteria } : {}),
    ...(template.accepted_message ? { accepted_message: template.accepted_message } : {}),
    ...(template.completed_message ? { completed_message: template.completed_message } : {}),
    ...(template.failure_message ? { failure_message: template.failure_message } : {}),
    ...(template.timeout_seconds !== undefined
      ? { timeout_seconds: template.timeout_seconds }
      : {}),
    ...(template.accepted_states ? { accepted_states: [...template.accepted_states] } : {}),
    ...(template.completed_states
      ? { completed_states: [...template.completed_states] }
      : {}),
    ...(template.max_state_age_seconds !== undefined
      ? { max_state_age_seconds: template.max_state_age_seconds }
      : {}),
    ...(template.argument_mapping
      ? { argument_mapping: { ...template.argument_mapping } }
      : {}),
  };
}

export function buildDiscoveredCatalog(input: {
  config: DiscoveryConfig;
  states: HaStateSummary[];
  registry: HaEntityRegistryResult;
  exposure: HaExposureResult;
  labels: HaLabelRegistryEntry[];
  services: HaServiceSummary[];
  devices?: HaDeviceRegistryEntry[];
  areas?: HaAreaRegistryEntry[];
}): DiscoveredCatalogSnapshot {
  const targets: Record<string, TargetDefinition> = {};
  const capabilities: Record<string, CapabilityDefinition> = {};
  const preferredNames = new Map<string, Set<string>>();
  const states = new Map(input.states.map((state) => [state.entity_id, state]));
  const availableServices = serviceSet(input.services);
  const categories = input.registry.entity_categories ?? {};
  const devices = new Map((input.devices ?? []).map((device) => [device.id, device]));
  const areas = new Map((input.areas ?? []).map((area) => [area.area_id, area]));

  for (const entity of input.registry.entities ?? []) {
    const state = states.get(entity.ei);
    if (!state || state.state === "unavailable" || state.state === "unknown") continue;
    if (input.config.exclude_hidden && entity.hb === true) continue;
    const category = entity.ec === null || entity.ec === undefined
      ? null
      : categories[String(entity.ec)] ?? null;
    if (category && input.config.exclude_entity_categories.includes(category)) continue;
    const selectorResults = input.config.selectors.map((selector) =>
      selectorMatches({ selector, entity, exposure: input.exposure, labels: input.labels }),
    );
    const selected = input.config.selection_mode === "all"
      ? selectorResults.every(Boolean)
      : selectorResults.some(Boolean);
    if (!selected) {
      continue;
    }

    const matchingTemplates = input.config.templates.filter(
      (template) =>
        templateMatches(template, state, entity) &&
        (template.kind === "read" ||
          (template.ha_action !== undefined && availableServices.has(template.ha_action))),
    );
    if (!matchingTemplates.length) continue;

    const friendlyName = textAttribute(state.attributes.friendly_name);
    const registryName = textAttribute(entity.en);
    const device = entity.di ? devices.get(entity.di) : undefined;
    const areaId = textAttribute(entity.ai) ?? textAttribute(device?.area_id);
    const areaEntry = areaId ? areas.get(areaId) : undefined;
    const area = textAttribute(areaEntry?.name) ?? areaId;
    const areaAliases = areaEntry?.aliases ?? [];
    const opaqueTarget = targetId(entity.di ?? entity.ei);
    const preferredName = friendlyName ?? registryName;
    if (preferredName) {
      const names = preferredNames.get(opaqueTarget) ?? new Set<string>();
      names.add(preferredName);
      preferredNames.set(opaqueTarget, names);
    }
    const displayName = friendlyName ?? registryName ?? area ?? "Home Assistant 设备";
    const existingTarget = targets[opaqueTarget];
    if (existingTarget) {
      mergeAliases(existingTarget, [friendlyName, registryName, area, ...areaAliases]);
    } else {
      targets[opaqueTarget] = {
        display_name: displayName,
        aliases: [friendlyName, registryName, area, ...areaAliases].filter(
          (value): value is string => Boolean(value && value !== displayName),
        ),
        ...(area ? { area } : {}),
      };
    }

    for (const template of matchingTemplates) {
      const key = `${template.id}@${opaqueTarget}`;
      if (!capabilities[key]) {
        capabilities[key] = capabilityFromTemplate(
          template,
          opaqueTarget,
          entity.ei,
        );
      }
    }
  }

  for (const [id, names] of preferredNames) {
    const sharedName = commonDisplayName([...names]);
    const target = targets[id];
    if (!sharedName || !target || sharedName === target.display_name) continue;
    const previousDisplayName = target.display_name;
    target.display_name = sharedName;
    mergeAliases(target, [previousDisplayName]);
  }

  return { targets, capabilities };
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  const constructor = (globalThis as unknown as {
    WebSocket?: new (address: string) => WebSocketLike;
  }).WebSocket;
  if (!constructor) {
    throw new RouterError("当前 Node.js 不支持 WebSocket", "WEBSOCKET_UNAVAILABLE");
  }
  return new constructor(url);
}

export class HomeAssistantDiscovery implements DiscoveryService {
  private current: DiscoveryStatus;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<DiscoveryStatus> | null = null;

  constructor(
    private readonly config: DiscoveryConfig,
    private readonly homeAssistant: RouterConfig["home_assistant"],
    private readonly catalog: CapabilityCatalog,
    private readonly fetchImplementation: typeof globalThis.fetch,
    private readonly webSocketFactory: WebSocketFactory = defaultWebSocketFactory,
  ) {
    this.current = {
      status: !config.enabled
        ? "disabled"
        : !homeAssistant.base_url || !homeAssistant.token
          ? "unconfigured"
          : "degraded",
      last_success_at: null,
      last_attempt_at: null,
      discovered_targets: 0,
      discovered_capabilities: 0,
      selectors: config.selectors.map((selector) => selector.id),
      error: null,
    };
  }

  status(): DiscoveryStatus {
    return { ...this.current, selectors: [...this.current.selectors] };
  }

  start(): void {
    if (!this.config.enabled || this.timer) return;
    this.timer = setInterval(
      () => void this.sync(),
      this.config.sync_interval_seconds * 1_000,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sync(): Promise<DiscoveryStatus> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performSync().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async performSync(): Promise<DiscoveryStatus> {
    if (!this.config.enabled) {
      this.current = { ...this.current, status: "disabled", error: null };
      return this.status();
    }
    if (!this.homeAssistant.base_url || !this.homeAssistant.token) {
      this.current = {
        ...this.current,
        status: "unconfigured",
        error: "Home Assistant 尚未配置",
      };
      return this.status();
    }

    const attemptedAt = new Date().toISOString();
    this.current = {
      ...this.current,
      status: "syncing",
      last_attempt_at: attemptedAt,
      error: null,
    };
    try {
      const [states, services, registryData] = await Promise.all([
        this.rest<HaStateSummary[]>("/api/states"),
        this.rest<HaServiceSummary[]>("/api/services"),
        this.registryAndSelectionData(),
      ]);
      const snapshot = buildDiscoveredCatalog({
        config: this.config,
        states,
        services,
        registry: registryData.registry,
        exposure: registryData.exposure,
        labels: registryData.labels,
        devices: registryData.devices,
        areas: registryData.areas,
      });
      this.catalog.replaceDiscovered(snapshot);
      this.current = {
        status: "ok",
        last_success_at: new Date().toISOString(),
        last_attempt_at: attemptedAt,
        discovered_targets: Object.keys(snapshot.targets).length,
        discovered_capabilities: Object.keys(snapshot.capabilities).length,
        selectors: this.config.selectors.map((selector) => selector.id),
        error: null,
      };
    } catch (error) {
      this.current = {
        ...this.current,
        status: "degraded",
        last_attempt_at: attemptedAt,
        error: errorMessage(error),
      };
    }
    return this.status();
  }

  private async rest<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.request_timeout_ms);
    try {
      const response = await this.fetchImplementation(
        `${this.homeAssistant.base_url.replace(/\/$/, "")}${path}`,
        {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${this.homeAssistant.token}` },
        },
      );
      if (!response.ok) {
        throw new RouterError(
          `Home Assistant 发现接口返回 HTTP ${response.status}`,
          "HA_DISCOVERY_HTTP_ERROR",
          502,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private registryAndSelectionData(): Promise<{
    registry: HaEntityRegistryResult;
    exposure: HaExposureResult;
    labels: HaLabelRegistryEntry[];
    devices: HaDeviceRegistryEntry[];
    areas: HaAreaRegistryEntry[];
  }> {
    const httpUrl = new URL(this.homeAssistant.base_url);
    httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
    const basePath = httpUrl.pathname.replace(/\/$/, "");
    httpUrl.pathname = basePath.endsWith("/core")
      ? `${basePath}/websocket`
      : `${basePath}/api/websocket`;
    httpUrl.search = "";
    httpUrl.hash = "";

    return new Promise((resolve, reject) => {
      let socket: WebSocketLike;
      try {
        socket = this.webSocketFactory(httpUrl.toString());
      } catch (error) {
        reject(error);
        return;
      }
      let authenticated = false;
      let settled = false;
      let registry: HaEntityRegistryResult | null = null;
      let exposure: HaExposureResult | null = null;
      let labels: HaLabelRegistryEntry[] | null = null;
      let devices: HaDeviceRegistryEntry[] | null = null;
      let areas: HaAreaRegistryEntry[] | null = null;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.close();
        if (error) reject(error);
        else if (registry && exposure && labels && devices && areas) {
          resolve({ registry, exposure, labels, devices, areas });
        }
        else reject(new RouterError("HA 发现响应不完整", "HA_DISCOVERY_INCOMPLETE"));
      };
      const timer = setTimeout(
        () => finish(new RouterError("HA 发现 WebSocket 超时", "HA_DISCOVERY_TIMEOUT")),
        this.config.request_timeout_ms,
      );

      socket.addEventListener("message", (event) => {
        try {
          const raw = typeof event.data === "string"
            ? event.data
            : Buffer.from(event.data as ArrayBuffer).toString("utf8");
          const message = JSON.parse(raw) as {
            id?: number;
            type?: string;
            success?: boolean;
            result?: unknown;
            message?: string;
          };
          if (message.type === "auth_required") {
            socket.send(JSON.stringify({ type: "auth", access_token: this.homeAssistant.token }));
            return;
          }
          if (message.type === "auth_invalid") {
            finish(new RouterError("HA WebSocket 认证失败", "HA_DISCOVERY_AUTH_FAILED"));
            return;
          }
          if (message.type === "auth_ok" && !authenticated) {
            authenticated = true;
            socket.send(JSON.stringify({ id: 1, type: "config/entity_registry/list_for_display" }));
            socket.send(JSON.stringify({ id: 2, type: "homeassistant/expose_entity/list" }));
            socket.send(JSON.stringify({ id: 3, type: "config/label_registry/list" }));
            socket.send(JSON.stringify({ id: 4, type: "config/device_registry/list" }));
            socket.send(JSON.stringify({ id: 5, type: "config/area_registry/list" }));
            return;
          }
          if (message.type !== "result") return;
          if (message.success !== true) {
            finish(new RouterError("HA 发现命令失败", "HA_DISCOVERY_COMMAND_FAILED"));
            return;
          }
          if (message.id === 1) registry = message.result as HaEntityRegistryResult;
          if (message.id === 2) exposure = message.result as HaExposureResult;
          if (message.id === 3) labels = message.result as HaLabelRegistryEntry[];
          if (message.id === 4) devices = message.result as HaDeviceRegistryEntry[];
          if (message.id === 5) areas = message.result as HaAreaRegistryEntry[];
          if (registry && exposure && labels && devices && areas) finish();
        } catch {
          finish(new RouterError("HA WebSocket 响应格式错误", "HA_DISCOVERY_PROTOCOL_ERROR"));
        }
      });
      socket.addEventListener("error", () => {
        finish(new RouterError("HA 发现 WebSocket 连接失败", "HA_DISCOVERY_SOCKET_ERROR"));
      });
      socket.addEventListener("close", () => {
        if (!settled) finish(new RouterError("HA 发现 WebSocket 提前关闭", "HA_DISCOVERY_SOCKET_CLOSED"));
      });
    });
  }
}
