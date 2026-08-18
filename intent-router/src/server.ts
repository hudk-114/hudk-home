import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { RouterError, errorMessage } from "./errors.js";
import type { IntentPipeline } from "./pipeline.js";
import type { RouterBundle, TurnRequest } from "./types.js";
import { readUiAsset } from "./ui.js";
import { SchemaValidator } from "./validators.js";

const MAX_BODY_BYTES = 64 * 1024;

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function staticContent(
  response: ServerResponse,
  contentType: string,
  body: string,
): void {
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'self'",
  });
  response.end(body);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new RouterError("请求体过大", "BODY_TOO_LARGE", 413);
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RouterError("请求体不是有效 JSON", "INVALID_JSON", 400);
  }
}

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function authorized(request: IncomingMessage, secret: string): boolean {
  if (trustedHomeAssistantIngress(request)) return true;
  if (!secret) return true;
  const authorization = request.headers.authorization ?? "";
  const prefix = "Bearer ";
  return (
    authorization.startsWith(prefix) &&
    secureEqual(authorization.slice(prefix.length), secret)
  );
}

/**
 * Home Assistant Supervisor authenticates Ingress sessions before proxying the
 * request. Only trust its documented internal source address; the public app
 * port must not be bypassable by spoofing X-Remote-User-Id from the LAN.
 */
function trustedHomeAssistantIngress(request: IncomingMessage): boolean {
  const remoteAddress = request.socket.remoteAddress ?? "";
  const fromSupervisor =
    remoteAddress === "172.30.32.2" || remoteAddress === "::ffff:172.30.32.2";
  const remoteUserId = request.headers["x-remote-user-id"];
  return (
    fromSupervisor &&
    typeof remoteUserId === "string" &&
    remoteUserId.trim().length > 0
  );
}

class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (bucket.count >= this.limit) return false;
    bucket.count += 1;
    return true;
  }
}

export function createIntentRouterHandler(
  bundle: RouterBundle,
  pipeline: IntentPipeline,
) {
  const turnValidator = new SchemaValidator<TurnRequest>(bundle.turnRequestSchema);
  const limiter = new FixedWindowRateLimiter(
    bundle.config.security.rate_limit_per_minute,
  );

  return async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://intent-router.local");
    try {
      if (request.method === "GET" && url.pathname === "/") {
        staticContent(response, "text/html; charset=utf-8", readUiAsset("index.html"));
        return;
      }
      if (request.method === "GET" && url.pathname === "/styles.css") {
        staticContent(response, "text/css; charset=utf-8", readUiAsset("styles.css"));
        return;
      }
      if (request.method === "GET" && url.pathname === "/app.js") {
        staticContent(response, "text/javascript; charset=utf-8", readUiAsset("app.js"));
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        json(response, 200, await pipeline.health());
        return;
      }
      if (!authorized(request, bundle.config.security.shared_secret)) {
        json(response, 401, { status: "rejected", error_code: "UNAUTHORIZED" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/catalog") {
        json(response, 200, pipeline.catalogDescription());
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/discovery") {
        json(response, 200, pipeline.discoveryStatus());
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/discovery/sync") {
        if (!limiter.allow(`${request.socket.remoteAddress ?? "unknown"}:discovery`)) {
          json(response, 429, { status: "rejected", error_code: "RATE_LIMITED" });
          return;
        }
        json(response, 200, await pipeline.syncDiscovery());
        return;
      }
      if (request.method !== "POST") {
        json(response, 404, { status: "failed", error_code: "NOT_FOUND" });
        return;
      }

      const body = await readJsonBody(request);
      if (url.pathname === "/v1/confirm") {
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw new RouterError("确认请求格式错误", "INVALID_CONFIRMATION", 400);
        }
        const confirmation = body as Record<string, unknown>;
        if (
          typeof confirmation.confirmation_id !== "string" ||
          typeof confirmation.source !== "string"
        ) {
          throw new RouterError("确认请求缺少必填字段", "INVALID_CONFIRMATION", 400);
        }
        const actor = confirmation.actor;
        const rateKey = `${request.socket.remoteAddress ?? "unknown"}:${confirmation.source}`;
        if (!limiter.allow(rateKey)) {
          json(response, 429, { status: "rejected", error_code: "RATE_LIMITED" });
          return;
        }
        const result = await pipeline.confirm({
          confirmation_id: confirmation.confirmation_id,
          source: confirmation.source,
          ...(typeof actor === "string" ? { actor } : {}),
        });
        json(response, 200, result);
        return;
      }

      const turn = turnValidator.validate(body, "INVALID_TURN_REQUEST");
      const rateKey = `${request.socket.remoteAddress ?? "unknown"}:${turn.source}`;
      if (!limiter.allow(rateKey)) {
        json(response, 429, { status: "rejected", error_code: "RATE_LIMITED" });
        return;
      }

      if (url.pathname === "/v1/intent/resolve") {
        const result = await pipeline.resolve(turn);
        audit(bundle, turn, result);
        json(response, 200, result);
        return;
      }
      if (url.pathname === "/v1/turn" || url.pathname === "/v1/command") {
        const result = await pipeline.turn(turn);
        if (url.pathname === "/v1/command") response.setHeader("Deprecation", "true");
        audit(bundle, turn, result);
        json(response, 200, result);
        return;
      }
      json(response, 404, { status: "failed", error_code: "NOT_FOUND" });
    } catch (error) {
      const status = error instanceof RouterError ? error.httpStatus : 500;
      json(response, status, {
        status: "failed",
        message: errorMessage(error),
        error_code: error instanceof RouterError ? error.code : "INTERNAL_ERROR",
      });
    }
  };
}

export function createIntentRouterServer(bundle: RouterBundle, pipeline: IntentPipeline) {
  const server = createServer(createIntentRouterHandler(bundle, pipeline));
  server.requestTimeout = bundle.config.server.request_timeout_ms;
  return server;
}

function audit(
  bundle: RouterBundle,
  request: TurnRequest,
  result: {
    request_id: string;
    status: string;
    intent?: string | object | null;
    target?: string | null;
    resolver?: string | null;
    error_code?: string | null;
  },
): void {
  if (!bundle.config.server.audit_log) return;
  const normalizedIntent =
    result.intent && typeof result.intent === "object"
      ? (result.intent as { intent?: string; target?: string })
      : null;
  console.log(
    JSON.stringify({
      event: "intent_router_request",
      request_id: result.request_id,
      source: request.source,
      actor: request.actor ?? null,
      status: result.status,
      intent:
        typeof result.intent === "string"
          ? result.intent
          : (normalizedIntent?.intent ?? null),
      target: result.target ?? normalizedIntent?.target ?? null,
      resolver: result.resolver ?? null,
      error_code: result.error_code ?? null,
      ...(bundle.config.server.log_raw_text ? { text: request.text } : {}),
    }),
  );
}
