export type IntentName =
  | "entity.read"
  | "sensor.read"
  | "vacuum.start"
  | "vacuum.dock"
  | "pet_feeder.feed_once"
  | "light.turn_on"
  | "light.turn_off"
  | "climate.set_temperature"
  | "scene.activate"
  | "system.health";

export interface NormalizedIntent {
  version: "1.0";
  intent: IntentName;
  target: string;
  arguments: Record<string, unknown>;
  confidence: number;
  needs_confirmation?: boolean;
  clarification?: string | null;
}

export interface TurnContext {
  last_target?: string;
  [key: string]: unknown;
}

export interface TurnRequest {
  text: string;
  language: string;
  source: string;
  actor?: string;
  conversation_id?: string;
  request_id?: string;
  context?: TurnContext;
  dry_run?: boolean;
}

export type ResolveStatus =
  | "resolved"
  | "needs_clarification"
  | "rejected"
  | "failed";

export interface ResolveResponse {
  request_id: string;
  status: ResolveStatus;
  message: string;
  intent: NormalizedIntent | null;
  resolver: string | null;
  error_code: string | null;
  llm_request?: Record<string, unknown> | null;
}

export type CommandStatus =
  | "accepted"
  | "completed"
  | "needs_clarification"
  | "needs_confirmation"
  | "rejected"
  | "failed";

export interface CommandResponse {
  request_id: string;
  status: CommandStatus;
  message: string;
  intent: string | null;
  target: string | null;
  resolver: string | null;
  ha_context_id: string | null;
  confirmation_id: string | null;
  error_code: string | null;
  dry_run: boolean;
  data: Record<string, unknown> | null;
  llm_request: Record<string, unknown> | null;
}

export interface TargetDefinition {
  display_name: string;
  aliases: string[];
  area?: string;
}

export interface CapabilityDefinition {
  target: string;
  kind: "read" | "write";
  risk: "read" | "routine" | "sensitive" | "critical";
  /** Hide this static compatibility mapping while HA discovery provides the same capability. */
  fallback_when_discovered?: boolean;
  allowed_sources?: string[];
  ha_action?: string;
  ha_entity_id?: string;
  verification_entity_id?: string;
  confirmation?: "never" | "always";
  success_criteria?: "ha_accepted" | "state_confirmed";
  accepted_message?: string;
  completed_message?: string;
  failure_message?: string;
  timeout_seconds?: number;
  accepted_states?: string[];
  completed_states?: string[];
  max_state_age_seconds?: number;
  argument_mapping?: Record<string, string>;
}

export interface DiscoveryTemplate {
  id: string;
  intent: IntentName;
  arguments?: Record<string, unknown>;
  match: {
    domains: string[];
    device_classes?: string[];
    units?: string[];
    name_patterns?: string[];
  };
  kind: "read" | "write";
  risk: "read" | "routine" | "sensitive" | "critical";
  allowed_sources?: string[];
  ha_action?: string;
  confirmation?: "never" | "always";
  success_criteria?: "ha_accepted" | "state_confirmed";
  accepted_message?: string;
  completed_message?: string;
  failure_message?: string;
  timeout_seconds?: number;
  accepted_states?: string[];
  completed_states?: string[];
  max_state_age_seconds?: number;
  argument_mapping?: Record<string, string>;
}

export interface DiscoverySelector {
  id: string;
  protocol: "ha_label" | "conversation_exposure";
  labels?: string[];
}

export interface DiscoveryConfig {
  enabled: boolean;
  sync_interval_seconds: number;
  request_timeout_ms: number;
  selection_mode: "any" | "all";
  selectors: DiscoverySelector[];
  exclude_entity_categories: string[];
  exclude_hidden: boolean;
  read_fallback: {
    enabled: boolean;
    domains: string[];
    include_entity_categories: string[];
  };
  templates: DiscoveryTemplate[];
}

export interface CapabilityCatalogData {
  version: number;
  targets: Record<string, TargetDefinition>;
  capabilities: Record<string, CapabilityDefinition>;
  policies: {
    unknown_intent: "reject";
    unknown_target: "clarify" | "reject";
    model_confidence_threshold: number;
    never_allow_generated_ha_service: boolean;
    never_allow_generated_entity_id: boolean;
  };
}

export interface RuleDefinition {
  id: string;
  resolver: "local_rules" | "conversation_context";
  patterns: string[];
  action?: "reject";
  message?: string;
  error_code?: string;
  intent?: IntentName;
  target?: string;
  arguments?: Record<string, unknown>;
  confidence?: number;
  allowed_context_targets?: string[];
  clarification?: string;
}

export interface RulesData {
  version: number;
  normalization?: {
    fillers?: string[];
  };
  rules: RuleDefinition[];
}

export interface ProviderAdapterConfig {
  protocol: string;
  base_url?: string;
  api_key?: string;
  model?: string;
  thinking?: "disabled" | "adaptive";
  max_completion_tokens?: number;
  timeout_ms?: number;
  retries?: number;
  failure_threshold?: number;
  cooldown_ms?: number;
  tool_choice?: string;
}

export interface ExecutorAdapterConfig {
  protocol: string;
}

export interface RouterConfig {
  server: {
    bind: string;
    port: number;
    request_timeout_ms: number;
    audit_log: boolean;
    log_raw_text: boolean;
  };
  home_assistant: {
    base_url: string;
    token: string;
    request_timeout_ms: number;
  };
  resolution: {
    order: string[];
    llm_confidence_threshold: number;
    require_schema_validation: boolean;
    dry_run: boolean;
    allow_live_execution: boolean;
  };
  provider: {
    active: string;
    adapters: Record<string, ProviderAdapterConfig>;
  };
  execution: {
    active: string;
    adapters: Record<string, ExecutorAdapterConfig>;
  };
  discovery: DiscoveryConfig;
  security: {
    shared_secret: string;
    allowed_sources: string[];
    confirmation_ttl_seconds: number;
    rate_limit_per_minute: number;
  };
  plugins?: {
    modules?: string[];
  };
  files: {
    root: string;
    intent_schema: string;
    turn_request_schema: string;
    resolve_response_schema: string;
    command_response_schema: string;
    capabilities: string;
    capability_overlays?: string[];
    local_rules: string;
    rule_overlays?: string[];
    utterance_tests: string;
  };
}

export interface RouterBundle {
  config: RouterConfig;
  projectRoot: string;
  intentSchema: Record<string, unknown>;
  turnRequestSchema: Record<string, unknown>;
  resolveResponseSchema: Record<string, unknown>;
  commandResponseSchema: Record<string, unknown>;
  catalogData: CapabilityCatalogData;
  rulesData: RulesData;
}

export type ResolverOutcome =
  | {
      kind: "intent";
      intent: NormalizedIntent;
      llmRequest?: Record<string, unknown> | null;
    }
  | { kind: "clarification"; message: string; errorCode: string }
  | { kind: "rejected"; message: string; errorCode: string };

export interface Resolver {
  readonly id: string;
  resolve(request: TurnRequest): Promise<ResolverOutcome | null>;
}

export interface IntentProvider {
  readonly id: string;
  resolve(request: TurnRequest): Promise<{
    intent: NormalizedIntent | null;
    llmRequest: Record<string, unknown> | null;
  }>;
}

export interface ExecutionResult {
  status: "accepted" | "completed" | "failed";
  message: string;
  data?: Record<string, unknown>;
  haContextId?: string;
  errorCode?: string;
}

export interface DependencyHealth {
  status: "ok" | "degraded" | "unconfigured";
  detail?: string;
}

export interface DiscoveryStatus {
  status: "disabled" | "unconfigured" | "syncing" | "ok" | "degraded";
  last_success_at: string | null;
  last_attempt_at: string | null;
  discovered_targets: number;
  discovered_capabilities: number;
  selectors: string[];
  error: string | null;
}

export interface DiscoveryService {
  status(): DiscoveryStatus;
  sync(): Promise<DiscoveryStatus>;
  start(): void;
  stop(): void;
}

export interface CapabilityExecutor {
  readonly id: string;
  execute(
    capabilityKey: string,
    capability: CapabilityDefinition,
    intent: NormalizedIntent,
  ): Promise<ExecutionResult>;
  health(): Promise<DependencyHealth>;
}
