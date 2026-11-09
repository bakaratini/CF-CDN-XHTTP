import { describe, expect, it } from "vitest";
import { parseVlessHeader } from "../src/protocol.ts";
import { makeVlessHeader, TEST_UUID } from "./helpers.ts";

describe("parseVlessHeader", () => {
  it("parses a domain request and preserves the payload boundary", () => {
    const payload = new Uint8Array([22, 3, 1, 9]);
    const bytes = makeVlessHeader({ hostname: "example.com", port: 443, payload });
    const parsed = parseVlessHeader(bytes, TEST_UUID);

    expect(parsed.status).toBe("complete");
    if (parsed.status !== "complete") throw new Error("expected complete header");
    expect(parsed.request).toEqual({
      version: 0,
      command: 1,
      hostname: "example.com",
      port: 443,
    });
    expect(bytes.subarray(parsed.headerLength)).toEqual(payload);
  });

  it("parses IPv4 and IPv6 address types", () => {
    const ipv4 = parseVlessHeader(
      makeVlessHeader({ hostname: "1.2.3.4", port: 80, addressType: 1 }),
      TEST_UUID,
    );
    const ipv6 = parseVlessHeader(
      makeVlessHeader({ hostname: "2001:db8:0:0:0:0:0:1", port: 443, addressType: 3 }),
      TEST_UUID,
    );

    expect(ipv4.status === "complete" && ipv4.request.hostname).toBe("1.2.3.4");
    expect(ipv6.status === "complete" && ipv6.request.hostname).toBe("2001:db8:0:0:0:0:0:1");
  });

  it("skips optional add-on bytes", () => {
    const parsed = parseVlessHeader(
      makeVlessHeader({
        hostname: "example.com",
        port: 443,
        addons: new Uint8Array([1, 2, 3]),
      }),
      TEST_UUID,
    );
    expect(parsed.status).toBe("complete");
  });

  it("supports the VLESS header arriving one byte at a time", () => {
    const bytes = makeVlessHeader({ hostname: "example.com", port: 443 });
    let buffered = new Uint8Array();
    let result = parseVlessHeader(buffered, TEST_UUID);

    for (const byte of bytes) {
      buffered = new Uint8Array([...buffered, byte]);
      result = parseVlessHeader(buffered, TEST_UUID);
    }

    expect(result.status).toBe("complete");
  });

  it("rejects invalid UUIDs, versions, commands, and addresses", () => {
    const valid = makeVlessHeader({ hostname: "example.com", port: 443 });
    const wrongUuid = makeVlessHeader({
      uuid: "b12d4f8c-5269-4ebd-aed9-1ac51f008dd7",
      hostname: "example.com",
      port: 443,
    });
    const unsupportedVersion = valid.slice();
    unsupportedVersion[0] = 1;
    const unsupportedCommand = makeVlessHeader({
      hostname: "example.com",
      port: 53,
      command: 2,
    });
    const invalidAddress = valid.slice();
    invalidAddress[21] = 9;

    expect(parseVlessHeader(wrongUuid, TEST_UUID)).toMatchObject({ status: "error", reason: "invalid-auth" });
    expect(parseVlessHeader(unsupportedVersion, TEST_UUID)).toMatchObject({ status: "error" });
    expect(parseVlessHeader(unsupportedCommand, TEST_UUID)).toMatchObject({ status: "error", reason: "unsupported-command" });
    expect(parseVlessHeader(invalidAddress, TEST_UUID)).toMatchObject({ status: "error", reason: "invalid-address-type" });
  });
});
