import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { RouterError } from "./errors.js";
import type { CapabilityCatalog } from "./catalog.js";
import type {
  CapabilityExecutor,
  ExecutorAdapterConfig,
  IntentProvider,
  ProviderAdapterConfig,
  Resolver,
  RouterBundle,
} from "./types.js";

export interface PluginBuildContext {
  bundle: RouterBundle;
  fetch: typeof globalThis.fetch;
  catalog: CapabilityCatalog;
}

export type ResolverFactory = (context: PluginBuildContext) => Resolver;
export type ProviderFactory = (
  id: string,
  config: ProviderAdapterConfig,
  context: PluginBuildContext,
) => IntentProvider;
export type ExecutorFactory = (
  id: string,
  config: ExecutorAdapterConfig,
  context: PluginBuildContext,
) => CapabilityExecutor;

export class PluginRegistry {
  readonly resolvers = new Map<string, ResolverFactory>();
  readonly providers = new Map<string, ProviderFactory>();
  readonly executors = new Map<string, ExecutorFactory>();

  registerResolver(id: string, factory: ResolverFactory): void {
    this.resolvers.set(id, factory);
  }

  registerProvider(protocol: string, factory: ProviderFactory): void {
    this.providers.set(protocol, factory);
  }

  registerExecutor(protocol: string, factory: ExecutorFactory): void {
    this.executors.set(protocol, factory);
  }
}

export interface ExternalRouterPlugin {
  register(registry: PluginRegistry): void | Promise<void>;
}

export async function loadExternalPlugins(
  registry: PluginRegistry,
  bundle: RouterBundle,
): Promise<void> {
  for (const modulePath of bundle.config.plugins?.modules ?? []) {
    const absolutePath = resolve(bundle.projectRoot, modulePath);
    const loaded: unknown = await import(pathToFileURL(absolutePath).href);
    const candidate = loaded as {
      default?: ExternalRouterPlugin;
      register?: ExternalRouterPlugin["register"];
    };
    const register = candidate.default?.register ?? candidate.register;
    if (!register) {
      throw new RouterError(
        `插件没有导出 register：${modulePath}`,
        "INVALID_PLUGIN",
      );
    }
    await register(registry);
  }
}
