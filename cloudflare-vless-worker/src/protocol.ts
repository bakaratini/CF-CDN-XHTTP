export const MAX_VLESS_HEADER_BYTES = 544;

export interface VlessRequest {
  version: number;
  command: number;
  hostname: string;
  port: number;
}

export type VlessParseResult =
  | { status: "incomplete" }
  | { status: "error"; reason: string }
  | {
      status: "complete";
      request: VlessRequest;
      headerLength: number;
    };

export function isValidUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  );
}

function uuidToBytes(value: string): Uint8Array {
  const compact = value.replaceAll("-", "");
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  let difference = 0;
  for (let index = 0; index < right.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function normalizeDomain(value: string): string | null {
  if (!value || value.length > 255 || /[\u0000-\u0020\\/?#@:%\[\]]/.test(value)) {
    return null;
  }

  try {
    const hostname = new URL(`http://${value}/`).hostname.toLowerCase().replace(/\.$/, "");
    if (
      hostname.length > 253 ||
      !hostname.includes(".") ||
      hostname.split(".").some((label) =>
        !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
    ) {
      return null;
    }
    return hostname;
  } catch {
    return null;
  }
}

function readAddress(bytes: Uint8Array, offset: number):
  | { status: "incomplete" }
  | { status: "error"; reason: string }
  | { status: "complete"; hostname: string; nextOffset: number } {
  if (bytes.length <= offset) return { status: "incomplete" };

  const type = bytes[offset];
  const valueOffset = offset + 1;

  if (type === 1) {
    const end = valueOffset + 4;
    if (bytes.length < end) return { status: "incomplete" };
    return {
      status: "complete",
      hostname: Array.from(bytes.subarray(valueOffset, end)).join("."),
      nextOffset: end,
    };
  }

  if (type === 2) {
    if (bytes.length <= valueOffset) return { status: "incomplete" };
    const length = bytes[valueOffset];
    if (length === 0) return { status: "error", reason: "empty-domain" };
    const end = valueOffset + 1 + length;
    if (bytes.length < end) return { status: "incomplete" };

    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(valueOffset + 1, end),
      );
    } catch {
      return { status: "error", reason: "invalid-domain-encoding" };
    }

    const hostname = normalizeDomain(decoded);
    if (!hostname) return { status: "error", reason: "invalid-domain" };
    return { status: "complete", hostname, nextOffset: end };
  }

  if (type === 3) {
    const end = valueOffset + 16;
    if (bytes.length < end) return { status: "incomplete" };
    const view = new DataView(bytes.buffer, bytes.byteOffset + valueOffset, 16);
    const groups: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      groups.push(view.getUint16(index * 2).toString(16));
    }
    return { status: "complete", hostname: groups.join(":"), nextOffset: end };
  }

  return { status: "error", reason: "invalid-address-type" };
}

export function parseVlessHeader(
  bytes: Uint8Array,
  expectedUuid: string,
): VlessParseResult {
  if (!isValidUuid(expectedUuid)) {
    return { status: "error", reason: "invalid-server-uuid" };
  }
  if (bytes.length < 1) return { status: "incomplete" };
  if (bytes[0] !== 0) return { status: "error", reason: "unsupported-version" };
  if (bytes.length < 17) return { status: "incomplete" };
  if (!sameBytes(bytes.subarray(1, 17), uuidToBytes(expectedUuid))) {
    return { status: "error", reason: "invalid-auth" };
  }
  if (bytes.length < 18) return { status: "incomplete" };

  const addonsLength = bytes[17];
  const commandOffset = 18 + addonsLength;
  if (bytes.length <= commandOffset) return { status: "incomplete" };
  if (bytes[commandOffset] !== 1) {
    return { status: "error", reason: "unsupported-command" };
  }

  const portOffset = commandOffset + 1;
  if (bytes.length < portOffset + 2) return { status: "incomplete" };
  const port = (bytes[portOffset] << 8) | bytes[portOffset + 1];
  if (port === 0) return { status: "error", reason: "invalid-port" };

  const address = readAddress(bytes, portOffset + 2);
  if (address.status !== "complete") return address;
  if (address.nextOffset > MAX_VLESS_HEADER_BYTES) {
    return { status: "error", reason: "header-too-large" };
  }

  return {
    status: "complete",
    request: {
      version: bytes[0],
      command: bytes[commandOffset],
      hostname: address.hostname,
      port,
    },
    headerLength: address.nextOffset,
  };
}
