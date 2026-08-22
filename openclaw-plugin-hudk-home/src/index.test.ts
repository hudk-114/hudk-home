import { afterEach, describe, expect, it, vi } from "vitest";
import entry, { callIntentRouter } from "./index.js";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

const metadata = getToolPluginMetadata(entry);
const turn = metadata?.tools.find((tool) => tool.name === "hudk_home_turn");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hudk-home", () => {
  it("只声明受限家庭入口工具", () => {
    expect(metadata?.tools.map((tool) => tool.name)).toEqual(["hudk_home_turn"]);
  });

  it("固定调用 v1/turn 并标记 family 来源", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted", message: "卧室温度是 24°C。" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callIntentRouter(
        { text: "卧室温度" },
        {
          baseUrl: "http://192.168.56.2:8787/",
          sharedSecret: "router-secret",
          defaultDryRun: false,
        },
      ),
    ).resolves.toMatchObject({ status: "accepted" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://192.168.56.2:8787/v1/turn");
    expect(init.headers).toMatchObject({ Authorization: "Bearer router-secret" });
    expect(JSON.parse(String(init.body))).toEqual({
      text: "卧室温度",
      language: "zh-CN",
      source: "openclaw",
      actor: "family",
      dry_run: false,
    });
  });

  it("401 时给出可操作的错误且不泄漏密钥", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    await expect(
      callIntentRouter({ text: "开始扫地" }, { sharedSecret: "do-not-leak" }),
    ).rejects.toThrow("共享密钥不正确或尚未同步");

    await expect(
      callIntentRouter({ text: "开始扫地" }, { sharedSecret: "do-not-leak" }),
    ).rejects.not.toThrow("do-not-leak");
  });

  it("用户确认后用同一受限工具调用 v1/confirm", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted", message: "已提交出粮指令。" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callIntentRouter(
        { confirmation_id: "confirm-123" },
        { baseUrl: "http://192.168.56.2:8787/", sharedSecret: "router-secret" },
      ),
    ).resolves.toMatchObject({ status: "accepted" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://192.168.56.2:8787/v1/confirm");
    expect(JSON.parse(String(init.body))).toEqual({
      confirmation_id: "confirm-123",
      source: "openclaw",
      actor: "family",
    });
  });
});
