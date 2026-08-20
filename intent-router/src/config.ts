import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { RouterError } from "./errors.js";
import type {
  CapabilityCatalogData,
  RouterBundle,
  RouterConfig,
  RulesData,
} from "./types.js";

function interpolateEnvironment(source: string, env: NodeJS.ProcessEnv): string {
  return source.replace(
    /\$\{([A-Z][A-Z0-9_]*)(?::-(.*?))?\}/g,
    (_match, name: string, fallback: string | undefined) =>
      env[name] ?? fallback ?? "",
  );
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouterError(`JSON 文件不是对象：${path}`, "INVALID_JSON_FILE");
  }
  return value as Record<string, unknown>;
}

async function readYaml<T>(path: string, env: NodeJS.ProcessEnv): Promise<T> {
  return parse(interpolateEnvironment(await readFile(path, "utf8"), env)) as T;
}

function mergeCatalog(
  base: CapabilityCatalogData,
  overlays: CapabilityCatalogData[],
): CapabilityCatalogData {
  return overlays.reduce<CapabilityCatalogData>(
    (merged, overlay) => ({
      version: overlay.version ?? merged.version,
      targets: Object.fromEntries(
        Object.entries({ ...merged.targets, ...overlay.targets }).map(([id, target]) => [
          id,
          { ...(merged.targets[id] ?? {}), ...target },
        ]),
      ) as CapabilityCatalogData["targets"],
      capabilities: Object.fromEntries(
        Object.entries({ ...merged.capabilities, ...overlay.capabilities }).map(
          ([id, capability]) => [
            id,
            { ...(merged.capabilities[id] ?? {}), ...capability },
          ],
        ),
      ) as CapabilityCatalogData["capabilities"],
      policies: { ...merged.policies, ...overlay.policies },
    }),
    structuredClone(base),
  );
}

function mergeRules(base: RulesData, overlays: RulesData[]): RulesData {
  return overlays.reduce<RulesData>((merged, overlay) => {
    const byId = new Map(merged.rules.map((rule) => [rule.id, rule]));
    for (const rule of overlay.rules ?? []) {
      byId.set(rule.id, { ...(byId.get(rule.id) ?? {}), ...rule } as typeof rule);
    }
    return {
      version: overlay.version ?? merged.version,
      normalization: {
        ...merged.normalization,
        ...overlay.normalization,
        fillers: [
          ...(merged.normalization?.fillers ?? []),
          ...(overlay.normalization?.fillers ?? []),
        ],
      },
      rules: [...byId.values()],
    };
  }, structuredClone(base));
}

function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "localhost";
}

function validateConfig(config: RouterConfig): void {
  if (
    !config.server ||
    !config.resolution ||
    !config.security ||
    !config.discovery ||
    !config.files
  ) {
    throw new RouterError("Intent Router 配置缺少必填段落", "INVALID_CONFIG");
  }
  if (!config.discovery.selectors.length) {
    throw new RouterError("HA discovery 至少需要一个 selector", "INVALID_CONFIG");
  }
  const safeFallbackDomains = new Set(["sensor", "binary_sensor", "event"]);
  if (config.discovery.read_fallback.enabled) {
    if (!config.discovery.read_fallback.domains.length) {
      throw new RouterError(
        "HA discovery read_fallback 至少需要一个只读 domain",
        "INVALID_CONFIG",
      );
    }
    for (const domain of config.discovery.read_fallback.domains) {
      if (!safeFallbackDomains.has(domain)) {
        throw new RouterError(
          `HA discovery read_fallback 不允许 domain：${domain}`,
          "INVALID_CONFIG",
        );
      }
    }
    if (config.discovery.read_fallback.include_entity_categories.includes("config")) {
      throw new RouterError(
        "HA discovery read_fallback 不能开放 config 类实体",
        "INVALID_CONFIG",
      );
    }
  }
  if (!["any", "all"].includes(config.discovery.selection_mode)) {
    throw new RouterError("HA discovery selection_mode 无效", "INVALID_CONFIG");
  }
  const selectorIds = new Set<string>();
  for (const selector of config.discovery.selectors) {
    if (selectorIds.has(selector.id)) {
      throw new RouterError(`发现 selector ID 重复：${selector.id}`, "INVALID_CONFIG");
    }
    selectorIds.add(selector.id);
    if (!["ha_label", "conversation_exposure"].includes(selector.protocol)) {
      throw new RouterError(
        `发现 selector ${selector.id} 的 protocol 无效`,
        "INVALID_CONFIG",
      );
    }
    if (selector.protocol === "ha_label" && !selector.labels?.length) {
      throw new RouterError(
        `标签 selector ${selector.id} 至少需要一个 label`,
        "INVALID_CONFIG",
      );
    }
  }
  if (
    !config.resolution.dry_run &&
    (!config.home_assistant.base_url || !config.home_assistant.token)
  ) {
    throw new RouterError(
      "非 dry-run 模式必须配置 HA_BASE_URL 和 HA_TOKEN",
      "HA_TOKEN_REQUIRED",
    );
  }
  if (!isLoopback(config.server.bind) && !config.security.shared_secret) {
    throw new RouterError(
      "监听非回环地址时必须配置 INTENT_ROUTER_SHARED_SECRET",
      "SHARED_SECRET_REQUIRED",
    );
  }
  if (config.security.allowed_sources.length === 0) {
    throw new RouterError("allowed_sources 不能为空", "INVALID_CONFIG");
  }
  if (!config.resolution.require_schema_validation) {
    throw new RouterError(
      "require_schema_validation 是不可关闭的安全边界",
      "INVALID_CONFIG",
    );
  }
  if (
    !config.resolution.dry_run &&
    !config.resolution.allow_live_execution
  ) {
    throw new RouterError(
      "默认真实执行需要显式开启 allow_live_execution",
      "INVALID_CONFIG",
    );
  }
  for (const [id, provider] of Object.entries(config.provider.adapters)) {
    if (
      provider.thinking !== undefined &&
      !["disabled", "adaptive"].includes(provider.thinking)
    ) {
      throw new RouterError(
        `Provider ${id} 的 thinking 配置无效`,
        "INVALID_CONFIG",
      );
    }
    if (
      provider.max_completion_tokens !== undefined &&
      provider.max_completion_tokens <= 0
    ) {
      throw new RouterError(
        `Provider ${id} 的 max_completion_tokens 必须大于 0`,
        "INVALID_CONFIG",
      );
    }
  }
  if (
    config.discovery.sync_interval_seconds <= 0 ||
    config.discovery.request_timeout_ms <= 0
  ) {
    throw new RouterError("HA discovery 时间配置必须大于 0", "INVALID_CONFIG");
  }
  const templateSignatures = new Set<string>();
  for (const template of config.discovery.templates) {
    const signature = JSON.stringify({
      id: template.id,
      match: template.match,
      ha_action: template.ha_action,
    });
    if (templateSignatures.has(signature)) {
      throw new RouterError(`发现模板重复：${template.id}`, "INVALID_CONFIG");
    }
    templateSignatures.add(signature);
    const expectedId = template.intent === "sensor.read"
      ? `sensor.read_${String(template.arguments?.metric ?? "")}`
      : template.intent;
    if (template.id !== expectedId) {
      throw new RouterError(
        `发现模板 ${template.id} 与标准意图能力键 ${expectedId} 不一致`,
        "INVALID_CONFIG",
      );
    }
    if (!template.match.domains.length) {
      throw new RouterError(`发现模板 ${template.id} 缺少 domain`, "INVALID_CONFIG");
    }
    for (const pattern of template.match.name_patterns ?? []) {
      try {
        new RegExp(pattern, "iu");
      } catch {
        throw new RouterError(
          `发现模板 ${template.id} 的名称正则无效`,
          "INVALID_CONFIG",
        );
      }
    }
    if (template.kind === "write") {
      const missing = [
        !template.allowed_sources?.length && "allowed_sources",
        !template.ha_action && "ha_action",
        !template.confirmation && "confirmation",
        !template.success_criteria && "success_criteria",
        !template.failure_message && "failure_message",
      ].filter(Boolean);
      if (missing.length) {
        throw new RouterError(
          `写发现模板 ${template.id} 缺少安全配置：${missing.join(", ")}`,
          "INVALID_CONFIG",
        );
      }
      if (
        (template.risk === "sensitive" || template.risk === "critical") &&
        template.confirmation !== "always"
      ) {
        throw new RouterError(
          `高风险发现模板 ${template.id} 必须始终确认`,
          "INVALID_CONFIG",
        );
      }
      if (
        template.success_criteria === "state_confirmed" &&
        !(template.completed_states?.length || template.accepted_states?.length)
      ) {
        throw new RouterError(
          `发现模板 ${template.id} 缺少状态成功条件`,
          "INVALID_CONFIG",
        );
      }
      if (Object.values(template.argument_mapping ?? {}).includes("entity_id")) {
        throw new RouterError(
          `发现模板 ${template.id} 不能把意图参数映射为 entity_id`,
          "INVALID_CONFIG",
        );
      }
    }
  }
}

export async function loadRouterBundle(
  configPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RouterBundle> {
  const absoluteConfigPath = resolve(configPath);
  const config = await readYaml<RouterConfig>(absoluteConfigPath, env);
  if (config.discovery) {
    config.discovery.read_fallback ??= {
      enabled: true,
      domains: ["sensor", "binary_sensor", "event"],
      include_entity_categories: ["diagnostic"],
    };
  }
  validateConfig(config);

  const projectRoot = resolve(dirname(absoluteConfigPath), config.files.root);
  const file = (path: string) => resolve(projectRoot, path);

  const [
    intentSchema,
    turnRequestSchema,
    resolveResponseSchema,
    commandResponseSchema,
    baseCatalogData,
    baseRulesData,
  ] = await Promise.all([
    readJson(file(config.files.intent_schema)),
    readJson(file(config.files.turn_request_schema)),
    readJson(file(config.files.resolve_response_schema)),
    readJson(file(config.files.command_response_schema)),
    readYaml<CapabilityCatalogData>(file(config.files.capabilities), env),
    readYaml<RulesData>(file(config.files.local_rules), env),
  ]);

  const [catalogOverlays, ruleOverlays] = await Promise.all([
    Promise.all(
      (config.files.capability_overlays ?? []).map((path) =>
        readYaml<CapabilityCatalogData>(file(path), env),
      ),
    ),
    Promise.all(
      (config.files.rule_overlays ?? []).map((path) =>
        readYaml<RulesData>(file(path), env),
      ),
    ),
  ]);
  const catalogData = mergeCatalog(baseCatalogData, catalogOverlays);
  const rulesData = mergeRules(baseRulesData, ruleOverlays);

  return {
    config,
    projectRoot,
    intentSchema,
    turnRequestSchema,
    resolveResponseSchema,
    commandResponseSchema,
    catalogData,
    rulesData,
  };
}
