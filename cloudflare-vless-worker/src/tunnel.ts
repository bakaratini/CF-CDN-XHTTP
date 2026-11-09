import { checkDestination } from "./network-policy.ts";
import { MAX_VLESS_HEADER_BYTES, parseVlessHeader } from "./protocol.ts";

export interface SocketLike {
  opened: Promise<unknown>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): void;
}

export interface SocketAddress {
  hostname: string;
  port: number;
}

export type SocketConnector = (address: SocketAddress) => SocketLike;

export interface TunnelWebSocket {
  readonly bufferedAmount: number;
  accept(): void;
  send(data: ArrayBuffer | ArrayBufferView | string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

const HEADER_TIMEOUT_MS = 10_000;
const MAX_SOCKET_BUFFERED_BYTES = 1_048_576;
const MAX_QUEUED_INPUT_BYTES = 4_194_304;

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right;
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

async function messageBytes(value: unknown): Promise<Uint8Array> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  throw new Error("binary websocket messages required");
}

function messageByteLength(value: unknown): number | null {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
  return null;
}

async function sendWithBackpressure(
  webSocket: TunnelWebSocket,
  bytes: Uint8Array,
  isClosed: () => boolean,
): Promise<void> {
  while (webSocket.bufferedAmount > MAX_SOCKET_BUFFERED_BYTES && !isClosed()) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!isClosed()) webSocket.send(bytes);
}

export function runVlessTunnel(
  webSocket: TunnelWebSocket,
  uuid: string,
  originHostname: string,
  connect: SocketConnector,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let headerBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
    let socket: SocketLike | undefined;
    let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let inputQueue = Promise.resolve();
    let queuedInputBytes = 0;
    let headerTimer: ReturnType<typeof setTimeout>;

    const shutdown = (code: number, reason: string, closeWebSocket = true): void => {
      if (settled) return;
      settled = true;
      clearTimeout(headerTimer);
      void reader?.cancel().catch(() => undefined);
      void writer?.abort().catch(() => undefined);
      try {
        socket?.close();
      } catch {
        // A socket may already be closed by the runtime.
      }
      if (closeWebSocket) {
        try {
          webSocket.close(code, reason);
        } catch {
          // The peer may have closed while cleanup was running.
        }
      }
      resolve();
    };

    const fail = (code = 1008): void => shutdown(code, "Connection closed");

    const pumpRemote = async (): Promise<void> => {
      if (!reader) return;
      while (!settled) {
        const { value, done } = await reader.read();
        if (done) {
          shutdown(1000, "", true);
          return;
        }
        if (value) await sendWithBackpressure(webSocket, value, () => settled);
      }
    };

    const openDestination = async (
      hostname: string,
      port: number,
      version: number,
      initialPayload: Uint8Array,
    ): Promise<void> => {
      const policy = checkDestination({ hostname, port }, originHostname);
      if (!policy.allowed) throw new Error(policy.reason);

      socket = connect({ hostname: policy.hostname, port: policy.port });
      await socket.opened;
      if (settled) return;

      writer = socket.writable.getWriter();
      reader = socket.readable.getReader();
      clearTimeout(headerTimer);
      webSocket.send(new Uint8Array([version, 0]));
      void pumpRemote().catch(() => shutdown(1011, "Connection closed"));
      if (initialPayload.length > 0) await writer.write(initialPayload);
    };

    const handleMessage = async (data: unknown): Promise<void> => {
      if (settled) return;
      const bytes = await messageBytes(data);

      if (socket) {
        if (!writer) throw new Error("socket is not writable");
        await writer.write(bytes);
        return;
      }

      const pending = concatenate(headerBuffer, bytes);
      const parsed = parseVlessHeader(pending, uuid);
      if (parsed.status === "incomplete") {
        if (pending.length > MAX_VLESS_HEADER_BYTES) throw new Error("header too large");
        headerBuffer = pending;
        return;
      }
      if (parsed.status === "error") throw new Error(parsed.reason);

      headerBuffer = new Uint8Array();
      await openDestination(
        parsed.request.hostname,
        parsed.request.port,
        parsed.request.version,
        pending.subarray(parsed.headerLength),
      );
    };

    headerTimer = setTimeout(() => fail(), HEADER_TIMEOUT_MS);
    webSocket.addEventListener("message", (event) => {
      const data = (event as MessageEvent).data;
      const byteLength = messageByteLength(data);
      if (byteLength === null) {
        fail(1003);
        return;
      }
      if (byteLength === 0) {
        fail(1003);
        return;
      }
      if (byteLength > MAX_QUEUED_INPUT_BYTES - queuedInputBytes) {
        fail(1009);
        return;
      }

      queuedInputBytes += byteLength;
      inputQueue = inputQueue
        .then(() => handleMessage(data))
        .finally(() => {
          queuedInputBytes -= byteLength;
        });
      void inputQueue.catch(() => fail());
    });
    webSocket.addEventListener("close", () => shutdown(1000, "", false));
    webSocket.addEventListener("error", () => fail(1011));
  });
}
