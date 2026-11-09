import { isValidUuid } from "../src/protocol.ts";

export const TEST_UUID = "a12d4f8c-5269-4ebd-aed9-1ac51f008dd7";

export function makeVlessHeader(options: {
  uuid?: string;
  hostname: string;
  port: number;
  addressType?: 1 | 2 | 3;
  command?: number;
  version?: number;
  addons?: Uint8Array;
  payload?: Uint8Array;
}): Uint8Array {
  const uuid = options.uuid ?? TEST_UUID;
  if (!isValidUuid(uuid)) throw new Error("invalid fixture uuid");
  const compact = uuid.replaceAll("-", "");
  const uuidBytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    uuidBytes[index] = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16);
  }

  const encoder = new TextEncoder();
  const addressType = options.addressType ?? 2;
  let address: Uint8Array;
  if (addressType === 1) {
    address = new Uint8Array([1, ...options.hostname.split(".").map(Number)]);
  } else if (addressType === 2) {
    const domain = encoder.encode(options.hostname);
    address = new Uint8Array([2, domain.length, ...domain]);
  } else {
    const groups = options.hostname.split(":").map((part) => Number.parseInt(part || "0", 16));
    const view = new DataView(new ArrayBuffer(16));
    groups.forEach((part, index) => view.setUint16(index * 2, part));
    address = new Uint8Array([3, ...new Uint8Array(view.buffer)]);
  }

  const addons = options.addons ?? new Uint8Array();
  const port = options.port;
  return new Uint8Array([
    options.version ?? 0,
    ...uuidBytes,
    addons.length,
    ...addons,
    options.command ?? 1,
    (port >> 8) & 0xff,
    port & 0xff,
    ...address,
    ...(options.payload ?? new Uint8Array()),
  ]);
}
