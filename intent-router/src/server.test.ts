import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { buildPipeline } from "./bootstrap.js";
import { loadRouterBundle } from "./config.js";
import { createIntentRouterHandler } from "./server.js";

interface CapturedResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

async function invoke(
  handler: ReturnType<typeof createIntentRouterHandler>,
  options: {
    authorization?: string;
    headers?: Record<string, string>;
    method?: string;
    path?: string;
    remoteAddress?: string;
  } = {},
): Promise<CapturedResponse> {
  const body = JSON.stringify({
    text: "扫地机回充",
    language: "zh-CN",
    source: "openclaw",
    dry_run: true,
  });
  const request = Readable.from(options.method === "GET" ? [] : [body]) as IncomingMessage;
  Object.assign(request, {
    method: options.method ?? "POST",
    url: options.path ?? "/v1/turn",
    headers: {
      "content-type": "application/json",
      ...(options.authorization ? { authorization: options.authorization } : {}),
      ...options.headers,
    },
  });
  Object.defineProperty(request, "socket", {
    value: { remoteAddress: options.remoteAddress ?? "127.0.0.1" },
  });

  const captured: CapturedResponse = { status: 0, headers: {}, body: null };
  const response = {
    writeHead(status: number, headers: Record<string, string>) {
      captured.status = status;
      Object.assign(captured.headers, headers);
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
      return this;
    },
    end(body?: string) {
      const contentType = captured.headers["Content-Type"] ?? "";
      captured.body = body
        ? contentType.includes("application/json")
          ? JSON.parse(body)
          : body
        : null;
      return this;
    },
  } as unknown as ServerResponse;

  await handler(request, response);
  return captured;
}

describe("Intent Router HTTP API", () => {
  it("认证后从统一 /v1/turn 入口返回 dry-run 结果", async () => {
    const bundle = await loadRouterBundle(
      new URL("../../config/intent-router.example.yaml", import.meta.url).pathname,
      { INTENT_ROUTER_SHARED_SECRET: "test-secret" },
    );
    const pipeline = await buildPipeline(bundle, {
      fetch: async () => {
        throw new Error("external call must not run");
      },
    });
    const handler = createIntentRouterHandler(bundle, pipeline);

    const unauthorized = await invoke(handler);
    expect(unauthorized.status).toBe(401);

    const response = await invoke(handler, {
      authorization: "Bearer test-secret",
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "accepted",
      intent: "vacuum.dock",
      resolver: "catalog_aliases",
      dry_run: true,
      data: {
        capability: "vacuum.dock",
        risk: "routine",
      },
    });
  });

  it("接受 Supervisor 已认证的 Ingress 请求但拒绝外部伪造头", async () => {
    const bundle = await loadRouterBundle(
      new URL("../../config/intent-router.example.yaml", import.meta.url).pathname,
      { INTENT_ROUTER_SHARED_SECRET: "test-secret" },
    );
    const pipeline = await buildPipeline(bundle);
    const handler = createIntentRouterHandler(bundle, pipeline);
    const ingressHeaders = {
      "x-remote-user-id": "ha-user-id",
      "x-ingress-path": "/api/hassio_ingress/session-id",
    };

    const ingress = await invoke(handler, {
      method: "GET",
      path: "/v1/catalog",
      headers: ingressHeaders,
      remoteAddress: "172.30.32.2",
    });
    expect(ingress.status).toBe(200);

    const spoofed = await invoke(handler, {
      method: "GET",
      path: "/v1/catalog",
      headers: ingressHeaders,
      remoteAddress: "192.168.1.20",
    });
    expect(spoofed.status).toBe(401);
  });

  it("提供无需 HA 的测试页面和脱敏逻辑能力目录", async () => {
    const bundle = await loadRouterBundle(
      new URL("../../config/intent-router.example.yaml", import.meta.url).pathname,
      { INTENT_ROUTER_SHARED_SECRET: "test-secret" },
    );
    const pipeline = await buildPipeline(bundle);
    const handler = createIntentRouterHandler(bundle, pipeline);

    const page = await invoke(handler, { method: "GET", path: "/" });
    expect(page.status).toBe(200);
    expect(page.body).toContain("Intent Router 测试台");
    expect(page.body).toContain('href="styles.css"');
    expect(page.body).toContain('src="app.js"');
    expect(page.headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'self'",
    );

    const unauthorized = await invoke(handler, {
      method: "GET",
      path: "/v1/catalog",
    });
    expect(unauthorized.status).toBe(401);

    const catalog = await invoke(handler, {
      method: "GET",
      path: "/v1/catalog",
      authorization: "Bearer test-secret",
    });
    expect(catalog.status).toBe(200);
    expect(JSON.stringify(catalog.body)).toContain("vacuum.dock");
    expect(JSON.stringify(catalog.body)).not.toContain("ha_entity_id");
    expect(JSON.stringify(catalog.body)).not.toContain("script.hudk");

    const discovery = await invoke(handler, {
      method: "GET",
      path: "/v1/discovery",
      authorization: "Bearer test-secret",
    });
    expect(discovery).toMatchObject({
      status: 200,
      body: { status: "unconfigured", discovered_targets: 0 },
    });

    const synchronized = await invoke(handler, {
      method: "POST",
      path: "/v1/discovery/sync",
      authorization: "Bearer test-secret",
    });
    expect(synchronized).toMatchObject({
      status: 200,
      body: { status: "unconfigured", discovered_capabilities: 0 },
    });
  });
});
