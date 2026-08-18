import { normalizeText } from "./normalizer.js";
import type {
  NormalizedIntent,
  Resolver,
  ResolverOutcome,
  RuleDefinition,
  RulesData,
  TurnRequest,
} from "./types.js";

interface CompiledRule {
  definition: RuleDefinition;
  patterns: RegExp[];
}

export class RuleResolver implements Resolver {
  private readonly rules: CompiledRule[];

  constructor(
    readonly id: "local_rules" | "conversation_context",
    rulesData: RulesData,
  ) {
    this.fillers = rulesData.normalization?.fillers ?? [];
    this.rules = rulesData.rules
      .filter((rule) => rule.resolver === id)
      .map((definition) => ({
        definition,
        patterns: definition.patterns.map((pattern) => new RegExp(pattern, "u")),
      }));
  }

  private readonly fillers: string[];

  async resolve(request: TurnRequest): Promise<ResolverOutcome | null> {
    const text = normalizeText(request.text, this.fillers);
    const rule = this.rules.find(({ patterns }) =>
      patterns.some((pattern) => pattern.test(text)),
    );
    if (!rule) return null;

    const definition = rule.definition;
    if (definition.action === "reject") {
      return {
        kind: "rejected",
        message: definition.message ?? "该请求不在允许的家庭能力范围内。",
        errorCode: definition.error_code ?? "RULE_REJECTED",
      };
    }

    let target = definition.target;
    if (target === "$context.last_target") {
      const lastTarget = request.context?.last_target;
      const allowed = definition.allowed_context_targets ?? [];
      if (!lastTarget || (allowed.length > 0 && !allowed.includes(lastTarget))) {
        return {
          kind: "clarification",
          message: definition.clarification ?? "你指的是哪个设备？",
          errorCode: "TARGET_AMBIGUOUS",
        };
      }
      target = lastTarget;
    }

    if (!definition.intent || !target) return null;
    const intent: NormalizedIntent = {
      version: "1.0",
      intent: definition.intent,
      target,
      arguments: definition.arguments ?? {},
      confidence: definition.confidence ?? 1,
      needs_confirmation: false,
      clarification: null,
    };
    return { kind: "intent", intent };
  }
}
