import { CapabilityCatalog } from "./catalog.js";
import { CatalogAliasResolver } from "./catalog-resolver.js";
import { HomeAssistantDiscovery, type WebSocketFactory } from "./discovery.js";
import { RouterError } from "./errors.js";
import { HomeAssistantExecutor } from "./executors.js";
import { IntentPipeline } from "./pipeline.js";
import {
  DisabledProvider,
  LlmResolver,
  OpenAICompatibleProvider,
} from "./providers.js";
import {
  loadExternalPlugins,
  PluginRegistry,
  type PluginBuildContext,
} from "./plugins.js";
import { RuleResolver } from "./rules.js";
import type {
  CapabilityExecutor,
  CommandResponse,
  IntentProvider,
  NormalizedIntent,
  ResolveResponse,
  Resolver,
  RouterBundle,
} from "./types.js";
import { SchemaValidator } from "./validators.js";

function registerBuiltIns(registry: PluginRegistry): void {
  registry.registerResolver(
    "local_rules",
    ({ bundle }) => new RuleResolver("local_rules", bundle.rulesData),
  );
  registry.registerResolver(
    "conversation_context",
    ({ bundle }) =>
      new RuleResolver("conversation_context", bundle.rulesData),
  );
  registry.registerResolver(
    "catalog_aliases",
    ({ catalog }) => new CatalogAliasResolver(catalog),
  );
  registry.registerProvider("disabled", (id) => new DisabledProvider(id));
  registry.registerProvider(
    "openai_compatible",
    (id, config, { bundle, fetch, catalog }) =>
      new OpenAICompatibleProvider(
        id,
        config,
        bundle.intentSchema,
        catalog,
        fetch,
      ),
  );
  registry.registerExecutor(
    "home_assistant_rest",
    (_id, _config, { bundle, fetch }) =>
      new HomeAssistantExecutor(bundle.config.home_assistant, fetch),
  );
}

function buildProvider(
  registry: PluginRegistry,
  context: PluginBuildContext,
): IntentProvider {
  const active = context.bundle.config.provider.active;
  const config = context.bundle.config.provider.adapters[active];
  if (!config) {
    throw new RouterError(`未找到 Provider 配置：${active}`, "PROVIDER_UNKNOWN");
  }
  const factory = registry.providers.get(config.protocol);
  if (!factory) {
    throw new RouterError(
      `未注册 Provider protocol：${config.protocol}`,
      "PROVIDER_PROTOCOL_UNKNOWN",
    );
  }
  return factory(active, config, context);
}

function buildExecutor(
  registry: PluginRegistry,
  context: PluginBuildContext,
): CapabilityExecutor {
  const active = context.bundle.config.execution.active;
  const config = context.bundle.config.execution.adapters[active];
  if (!config) {
    throw new RouterError(`未找到 Executor 配置：${active}`, "EXECUTOR_UNKNOWN");
  }
  const factory = registry.executors.get(config.protocol);
  if (!factory) {
    throw new RouterError(
      `未注册 Executor protocol：${config.protocol}`,
      "EXECUTOR_PROTOCOL_UNKNOWN",
    );
  }
  return factory(active, config, context);
}

function buildResolvers(
  registry: PluginRegistry,
  context: PluginBuildContext,
  provider: IntentProvider,
): Resolver[] {
  return context.bundle.config.resolution.order.map((id) => {
    if (id === "llm") return new LlmResolver(provider);
    const factory = registry.resolvers.get(id);
    if (!factory) {
      throw new RouterError(`未注册 Resolver：${id}`, "RESOLVER_UNKNOWN");
    }
    return factory(context);
  });
}

export async function buildPipeline(
  bundle: RouterBundle,
  options: {
    fetch?: typeof globalThis.fetch;
    webSocketFactory?: WebSocketFactory;
  } = {},
): Promise<IntentPipeline> {
  const catalog = new CapabilityCatalog(bundle.catalogData);
  catalog.assertValid(bundle.config.resolution.dry_run);
  const context: PluginBuildContext = {
    bundle,
    fetch: options.fetch ?? globalThis.fetch,
    catalog,
  };
  const registry = new PluginRegistry();
  registerBuiltIns(registry);
  await loadExternalPlugins(registry, bundle);

  const discovery = new HomeAssistantDiscovery(
    bundle.config.discovery,
    bundle.config.home_assistant,
    catalog,
    context.fetch,
    options.webSocketFactory,
  );
  await discovery.sync();
  discovery.start();
  const provider = buildProvider(registry, context);
  const executor = buildExecutor(registry, context);
  const resolvers = buildResolvers(registry, context, provider);

  return new IntentPipeline(
    bundle.config,
    resolvers,
    executor,
    catalog,
    new SchemaValidator<NormalizedIntent>(bundle.intentSchema),
    new SchemaValidator<ResolveResponse>(bundle.resolveResponseSchema),
    new SchemaValidator<CommandResponse>(bundle.commandResponseSchema),
    discovery,
  );
}
