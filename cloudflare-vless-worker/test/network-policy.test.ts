import { describe, expect, it } from "vitest";
import { checkDestination } from "../src/network-policy.ts";

describe("checkDestination", () => {
  it("allows public TCP destinations", () => {
    expect(checkDestination({ hostname: "1.1.1.1", port: 443 }, "worker.example.com").allowed).toBe(true);
    expect(checkDestination({ hostname: "example.com", port: 22 }, "worker.example.com").allowed).toBe(true);
  });

  it("rejects non-public addresses and local names", () => {
    for (const hostname of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.1.2",
      "100.64.0.1",
      "192.0.2.1",
      "::1",
      "fc00::1",
      "2001:db8::1",
      "localhost",
      "printer.local",
    ]) {
      expect(checkDestination({ hostname, port: 443 }, "worker.example.com").allowed).toBe(false);
    }
  });

  it("rejects Cloudflare-prohibited SMTP and self connections", () => {
    expect(checkDestination({ hostname: "mail.example.com", port: 25 }, "worker.example.com")).toMatchObject({
      allowed: false,
      reason: "prohibited-port",
    });
    expect(checkDestination({ hostname: "worker.example.com", port: 443 }, "worker.example.com")).toMatchObject({
      allowed: false,
      reason: "self-destination",
    });
  });

  it("rejects invalid ports", () => {
    expect(checkDestination({ hostname: "example.com", port: 0 }, "worker.example.com").allowed).toBe(false);
    expect(checkDestination({ hostname: "example.com", port: 65_536 }, "worker.example.com").allowed).toBe(false);
  });
});
