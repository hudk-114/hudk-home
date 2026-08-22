import { randomUUID } from "node:crypto";
import { CapabilityCatalog } from "./catalog.js";
import { RouterError, errorMessage } from "./errors.js";
import { ProviderCallError } from "./providers.js";
import { SchemaValidator } from "./validators.js";
import type {
  CapabilityDefinition,
  CapabilityExecutor,
  CommandResponse,
  DiscoveryService,
  NormalizedIntent,
  ResolveResponse,
  Resolver,
  RouterConfig,
  TurnRequest,
} from "./types.js";

interface PendingConfirmation {
  id: string;
  source: string;
  actor?: string;
  expiresAt: number;
  requestId: string;
  resolver: string;
  intent: NormalizedIntent;
  capabilityKey: string;
  capability: CapabilityDefinition;
  llmRequest: Record<string, unknown> | null;
}

function baseResponse(
  requestId: string,
  overrides: Partial<CommandResponse>,
): CommandResponse {
  return {
    request_id: requestId,
    status: "failed",
    message: "请求失败。",
    intent: null,
    target: null,
    resolver: null,
    ha_context_id: null,
    confirmation_id: null,
    error_code: null,
    dry_run: false,
    data: null,
    llm_request: null,
    ...overrides,
  };
}

export class IntentPipeline {
  private readonly pending = new Map<string, PendingConfirmation>();

  constructor(
    private readonly config: RouterConfig,
    private readonly resolvers: Resolver[],
    private readonly executor: CapabilityExecutor,
    private readonly catalog: CapabilityCatalog,
    private readonly intentValidator: SchemaValidator<NormalizedIntent>,
    private readonly resolveResponseValidator: SchemaValidator<ResolveResponse>,
    private readonly commandResponseValidator: SchemaValidator<CommandResponse>,
    private readonly discovery?: DiscoveryService,
  ) {}

  async resolve(request: TurnRequest): Promise<ResolveResponse> {
    const requestId = request.request_id ?? randomUUID();
    if (!this.config.security.allowed_sources.includes(request.source)) {
      return this.validateResolve({
        request_id: requestId,
        status: "rejected",
        message: "该输入来源没有家庭意图服务权限。",
        intent: null,
        resolver: null,
        error_code: "SOURCE_NOT_ALLOWED",
      });
    }

    for (const resolver of this.resolvers) {
      let llmRequest: Record<string, unknown> | null = null;
      try {
        const outcome = await resolver.resolve({ ...request, request_id: requestId });
        if (!outcome) continue;
        if (outcome.kind === "clarification") {
          return this.validateResolve({
            request_id: requestId,
            status: "needs_clarification",
            message: outcome.message,
            intent: null,
            resolver: resolver.id,
            error_code: outcome.errorCode,
          });
        }
        if (outcome.kind === "rejected") {
          return this.validateResolve({
            request_id: requestId,
            status: "rejected",
            message: outcome.message,
            intent: null,
            resolver: resolver.id,
            error_code: outcome.errorCode,
          });
        }
        llmRequest = outcome.llmRequest ?? null;
        const intent = this.intentValidator.validate(outcome.intent, "INVALID_INTENT");
        if (
          resolver.id === "llm" &&
          intent.confidence <
            Math.max(
              this.config.resolution.llm_confidence_threshold,
              this.catalog.data.policies.model_confidence_threshold,
            )
        ) {
          return this.validateResolve({
            request_id: requestId,
            status: "needs_clarification",
            message: intent.clarification ?? "我还不能确定你的家庭控制意图。",
            intent: null,
            resolver: resolver.id,
            error_code: "LOW_CONFIDENCE",
            llm_request: llmRequest,
          });
        }
        return this.validateResolve({
          request_id: requestId,
          status: "resolved",
          message: "意图已识别。",
          intent,
          resolver: resolver.id,
          error_code: null,
          llm_request: llmRequest,
        });
      } catch (error) {
        if (resolver.id !== "llm") throw error;
        if (error instanceof ProviderCallError) {
          llmRequest = error.llmRequest;
        }
        const errorCode = error instanceof RouterError ? error.code : "RESOLVER_FAILED";
        const invalidCandidate = ["INVALID_INTENT", "PROVIDER_INVALID_JSON"].includes(
          errorCode,
        );
        return this.validateResolve({
          request_id: requestId,
          status: "failed",
          message: invalidCandidate
            ? "AI 返回结果未通过安全格式校验，未执行任何设备操作。"
            : errorMessage(error),
          intent: null,
          resolver: resolver.id,
          error_code: errorCode,
          llm_request: llmRequest,
        });
      }
    }

    return this.validateResolve({
      request_id: requestId,
      status: "needs_clarification",
      message: "我还不能确定你想查询或控制什么。",
      intent: null,
      resolver: null,
      error_code: "NO_INTENT_MATCH",
    });
  }

  async turn(request: TurnRequest): Promise<CommandResponse> {
    const dryRun = request.dry_run ?? this.config.resolution.dry_run;
    if (!dryRun && !this.config.resolution.allow_live_execution) {
      return this.validateCommand(
        baseResponse(request.request_id ?? randomUUID(), {
          status: "rejected",
          message: "服务端尚未允许真实执行；请开启调试或配置真实执行许可。",
          error_code: "LIVE_EXECUTION_DISABLED",
          dry_run: false,
        }),
      );
    }
    const resolved = await this.resolve(request);
    if (resolved.status !== "resolved" || !resolved.intent) {
      const status =
        resolved.status === "needs_clarification"
          ? "needs_clarification"
          : resolved.status === "rejected"
            ? "rejected"
            : "failed";
      return this.validateCommand(
        baseResponse(resolved.request_id, {
          status,
          message: resolved.message,
          resolver: resolved.resolver,
          error_code: resolved.error_code,
          dry_run: dryRun,
          llm_request: resolved.llm_request ?? null,
        }),
      );
    }

    const intent = resolved.intent;
    const capability = this.catalog.resolve(intent);
    if (!capability) {
      return this.validateCommand(
        baseResponse(resolved.request_id, {
          status: "rejected",
          message: "该意图不在家庭能力白名单中。",
          intent: intent.intent,
          target: intent.target,
          resolver: resolved.resolver,
          error_code: "CAPABILITY_NOT_ALLOWED",
          dry_run: dryRun,
          llm_request: resolved.llm_request ?? null,
        }),
      );
    }
    if (capability.definition.target !== intent.target) {
      const reject = this.catalog.data.policies.unknown_target === "reject";
      return this.validateCommand(
        baseResponse(resolved.request_id, {
          status: reject ? "rejected" : "needs_clarification",
          message: reject
            ? "识别到的目标不在能力目录中。"
            : "识别到的目标与能力目录不一致，请明确设备或房间。",
          intent: intent.intent,
          target: intent.target,
          resolver: resolved.resolver,
          error_code: reject ? "TARGET_NOT_ALLOWED" : "TARGET_AMBIGUOUS",
          dry_run: dryRun,
          llm_request: resolved.llm_request ?? null,
        }),
      );
    }

    if (
      capability.definition.allowed_sources &&
      !capability.definition.allowed_sources.includes(request.source)
    ) {
      return this.validateCommand(
        baseResponse(resolved.request_id, {
          status: "rejected",
          message: "该输入来源没有执行此家庭能力的权限。",
          intent: intent.intent,
          target: intent.target,
          resolver: resolved.resolver,
          error_code: "CAPABILITY_SOURCE_NOT_ALLOWED",
          dry_run: dryRun,
          llm_request: resolved.llm_request ?? null,
        }),
      );
    }

    if (dryRun) {
      return this.validateCommand(
        baseResponse(resolved.request_id, {
          status: "accepted",
          message: "调试结果：已匹配到设备和操作，不会调用 Home Assistant。",
          intent: intent.intent,
          target: intent.target,
          resolver: resolved.resolver,
          dry_run: true,
          llm_request: resolved.llm_request ?? null,
          data: {
            capability: capability.key,
            arguments: intent.arguments,
            kind: capability.definition.kind,
            risk: capability.definition.risk,
            confirmation: capability.definition.confirmation ?? "never",
          },
        }),
      );
    }

    if (this.catalog.hasPlaceholderMapping(capability.definition)) {
      return this.validateCommand(
        baseResponse(resolved.request_id, {
          status: "rejected",
          message: "该能力仍含占位 HA 映射，不能真实执行。",
          intent: intent.intent,
          target: intent.target,
          resolver: resolved.resolver,
          error_code: "CAPABILITY_PLACEHOLDER",
          dry_run: false,
          llm_request: resolved.llm_request ?? null,
        }),
      );
    }

    if (
      capability.definition.kind === "write" &&
      capability.definition.confirmation === "always"
    ) {
      const confirmation = this.createConfirmation(
        request,
        resolved.request_id,
        resolved.resolver ?? "unknown",
        intent,
        capability.key,
        capability.definition,
        resolved.llm_request ?? null,
      );
      return this.validateCommand(
        baseResponse(resolved.request_id, {
          status: "needs_confirmation",
          message: "该操作需要确认。",
          intent: intent.intent,
          target: intent.target,
          resolver: resolved.resolver,
          confirmation_id: confirmation.id,
          dry_run: false,
          llm_request: resolved.llm_request ?? null,
          data: {
            capability: capability.key,
            arguments: intent.arguments,
            kind: capability.definition.kind,
            risk: capability.definition.risk,
            confirmation: "always",
          },
        }),
      );
    }

    return this.execute(
      resolved.request_id,
      resolved.resolver ?? "unknown",
      intent,
      capability.key,
      capability.definition,
      resolved.llm_request ?? null,
    );
  }

  async confirm(input: {
    confirmation_id: string;
    source: string;
    actor?: string;
  }): Promise<CommandResponse> {
    const pending = this.pending.get(input.confirmation_id);
    if (!pending || pending.expiresAt < Date.now()) {
      if (pending) this.pending.delete(pending.id);
      return this.validateCommand(
        baseResponse(randomUUID(), {
          status: "rejected",
          message: "确认请求不存在或已过期。",
          error_code: "CONFIRMATION_EXPIRED",
        }),
      );
    }
    if (pending.source !== input.source || pending.actor !== input.actor) {
      return this.validateCommand(
        baseResponse(pending.requestId, {
          status: "rejected",
          message: "确认者与原请求不一致。",
          error_code: "CONFIRMATION_ACTOR_MISMATCH",
        }),
      );
    }
    this.pending.delete(pending.id);
    return this.execute(
      pending.requestId,
      pending.resolver,
      pending.intent,
      pending.capabilityKey,
      pending.capability,
      pending.llmRequest,
    );
  }

  async health() {
    const homeAssistant = await this.executor.health();
    const discovery = this.discovery?.status();
    return {
      status:
        homeAssistant.status === "ok" ? ("ok" as const) : ("degraded" as const),
      service: "hudk-home-intent-router",
      dry_run: this.config.resolution.dry_run,
      live_execution_allowed: this.config.resolution.allow_live_execution,
      dependencies: {
        home_assistant: homeAssistant,
        ...(discovery ? { discovery } : {}),
      },
    };
  }

  catalogDescription(): Record<string, unknown> {
    return {
      ...this.catalog.publicDescription(),
      ...(this.discovery ? { discovery: this.discovery.status() } : {}),
    };
  }

  discoveryStatus() {
    return this.discovery?.status() ?? null;
  }

  async syncDiscovery() {
    return this.discovery?.sync() ?? null;
  }

  private async execute(
    requestId: string,
    resolver: string,
    intent: NormalizedIntent,
    capabilityKey: string,
    capability: CapabilityDefinition,
    llmRequest: Record<string, unknown> | null,
  ): Promise<CommandResponse> {
    const result = await this.executor.execute(capabilityKey, capability, intent);
    return this.validateCommand(
      baseResponse(requestId, {
        status: result.status,
        message: result.message,
        intent: intent.intent,
        target: intent.target,
        resolver,
        llm_request: llmRequest,
        ha_context_id: result.haContextId ?? null,
        error_code: result.errorCode ?? null,
        data: {
          ...(result.data ?? {}),
          capability: capabilityKey,
          arguments: intent.arguments,
          risk: capability.risk,
        },
      }),
    );
  }

  private createConfirmation(
    request: TurnRequest,
    requestId: string,
    resolver: string,
    intent: NormalizedIntent,
    capabilityKey: string,
    capability: CapabilityDefinition,
    llmRequest: Record<string, unknown> | null,
  ): PendingConfirmation {
    const pending: PendingConfirmation = {
      id: randomUUID(),
      source: request.source,
      expiresAt:
        Date.now() + this.config.security.confirmation_ttl_seconds * 1_000,
      requestId,
      resolver,
      intent,
      capabilityKey,
      capability,
      llmRequest,
      ...(request.actor === undefined ? {} : { actor: request.actor }),
    };
    this.pending.set(pending.id, pending);
    return pending;
  }

  private validateResolve(value: ResolveResponse): ResolveResponse {
    return this.resolveResponseValidator.validate(value, "INVALID_RESOLVE_RESPONSE");
  }

  private validateCommand(value: CommandResponse): CommandResponse {
    return this.commandResponseValidator.validate(value, "INVALID_COMMAND_RESPONSE");
  }
}
