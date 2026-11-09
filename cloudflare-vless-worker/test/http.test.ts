import { describe, expect, it } from "vitest";
import {
  buildVlessUri,
  getWebSocketPath,
  handleHttpRequest,
  isTunnelUpgradeRequest,
  isWebSocketUpgrade,
} from "../src/http.ts";
import { TEST_UUID } from "./helpers.ts";

describe("HTTP routes and VLESS link generation", () => {
  it("generates a v2rayN-compatible VLESS WebSocket TLS URI for the request host", () => {
    const uri = buildVlessUri(TEST_UUID, "node.example.com", "/private/ws");
    const parsed = new URL(uri);

    expect(parsed.protocol).toBe("vless:");
    expect(parsed.username).toBe(TEST_UUID);
    expect(parsed.hostname).toBe("node.example.com");
    expect(parsed.port).toBe("443");
    expect(parsed.searchParams.get("encryption")).toBe("none");
    expect(parsed.searchParams.get("security")).toBe("tls");
    expect(parsed.searchParams.get("sni")).toBe("node.example.com");
    expect(parsed.searchParams.get("type")).toBe("ws");
    expect(parsed.searchParams.get("host")).toBe("node.example.com");
    expect(parsed.searchParams.get("path")).toBe("/private/ws");
  });

  it("returns a link only from the UUID configuration path and uses its hostname", async () => {
    const request = new Request(`https://edge.example.net/${TEST_UUID}`);
    const response = handleHttpRequest(request, { UUID: TEST_UUID, WS_PATH: "/ws" });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain("@edge.example.net:443");
    expect(body).toContain("sni=edge.example.net");
  });

  it("serves a static page for ordinary and unmatched HTTP requests", async () => {
    const response = handleHttpRequest(new Request("https://edge.example.net/"), { UUID: TEST_UUID });
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Service status");
  });

  it("validates configured paths and WebSocket upgrade headers", () => {
    expect(getWebSocketPath(undefined)).toBe("/ws");
    expect(getWebSocketPath("/private/route-1")).toBe("/private/route-1");
    expect(getWebSocketPath("/bad?query=1")).toBeNull();
    expect(getWebSocketPath("/")).toBeNull();

    const request = new Request("https://edge.example.net/ws", {
      headers: { Upgrade: "websocket", Connection: "keep-alive, Upgrade" },
    });
    expect(isWebSocketUpgrade(request)).toBe(true);
    expect(isWebSocketUpgrade(new Request("https://edge.example.net/ws"))).toBe(false);
    expect(isTunnelUpgradeRequest(request, { UUID: TEST_UUID })).toBe(true);
    expect(isTunnelUpgradeRequest(request, { UUID: TEST_UUID, WS_PATH: "/other" })).toBe(false);
    expect(isTunnelUpgradeRequest(request, {})).toBe(false);
  });
});
