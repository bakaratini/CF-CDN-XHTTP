import { describe, expect, it } from "vitest";
import { runVlessTunnel, type SocketAddress, type SocketLike, type TunnelWebSocket } from "../src/tunnel.ts";
import { makeVlessHeader, TEST_UUID } from "./helpers.ts";

class FakeWebSocket extends EventTarget implements TunnelWebSocket {
  bufferedAmount = 0;
  readonly sent: Uint8Array[] = [];
  closeCode: number | undefined;

  accept(): void {}

  send(data: ArrayBuffer | ArrayBufferView | string): void {
    if (typeof data === "string") throw new Error("text frame");
    if (data instanceof ArrayBuffer) this.sent.push(new Uint8Array(data));
    else this.sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
  }

  close(code?: number): void {
    this.closeCode = code;
    this.dispatchEvent(new Event("close"));
  }

  receive(bytes: Uint8Array): void {
    this.dispatchEvent(new MessageEvent("message", { data: bytes }));
  }
}

class FakeSocket implements SocketLike {
  readonly opened = Promise.resolve({});
  readonly writes: Uint8Array[] = [];
  readonly closed = new Promise<void>(() => undefined);
  controller!: ReadableStreamDefaultController<Uint8Array>;
  readonly readable = new ReadableStream<Uint8Array>({
    start: (controller) => {
      this.controller = controller;
    },
  });
  readonly writable = new WritableStream<Uint8Array>({
    write: (chunk) => {
      this.writes.push(chunk.slice());
    },
  });
  wasClosed = false;

  close(): void {
    this.wasClosed = true;
    try {
      this.controller.close();
    } catch {
      // The test may already have closed the readable side.
    }
  }
}

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - started > 1_000) return reject(new Error("condition timed out"));
      setTimeout(check, 2);
    };
    check();
  });
}

describe("runVlessTunnel", () => {
  it("buffers a split header, connects once, and relays data in both directions", async () => {
    const webSocket = new FakeWebSocket();
    const socket = new FakeSocket();
    const connections: SocketAddress[] = [];
    const task = runVlessTunnel(webSocket, TEST_UUID, "worker.example.com", (address) => {
      connections.push(address);
      return socket;
    });
    const bytes = makeVlessHeader({
      hostname: "example.com",
      port: 443,
      payload: new Uint8Array([9, 8, 7]),
    });

    webSocket.receive(bytes.slice(0, 8));
    webSocket.receive(bytes.slice(8));
    await waitFor(() => socket.writes.length === 1);

    expect(connections).toEqual([{ hostname: "example.com", port: 443 }]);
    expect(socket.writes[0]).toEqual(new Uint8Array([9, 8, 7]));
    expect(webSocket.sent[0]).toEqual(new Uint8Array([0, 0]));

    socket.controller.enqueue(new Uint8Array([4, 5, 6]));
    await waitFor(() => webSocket.sent.length === 2);
    expect(webSocket.sent[1]).toEqual(new Uint8Array([4, 5, 6]));

    webSocket.close(1000);
    await task;
    expect(socket.wasClosed).toBe(true);
  });

  it("does not connect for invalid authentication, UDP, or private destinations", async () => {
    for (const bytes of [
      makeVlessHeader({ uuid: "b12d4f8c-5269-4ebd-aed9-1ac51f008dd7", hostname: "example.com", port: 443 }),
      makeVlessHeader({ hostname: "example.com", port: 53, command: 2 }),
      makeVlessHeader({ hostname: "127.0.0.1", port: 443, addressType: 1 }),
      makeVlessHeader({ hostname: "mail.example.com", port: 25 }),
    ]) {
      const webSocket = new FakeWebSocket();
      let connected = false;
      const task = runVlessTunnel(webSocket, TEST_UUID, "worker.example.com", () => {
        connected = true;
        return new FakeSocket();
      });
      webSocket.receive(bytes);
      await waitFor(() => webSocket.closeCode !== undefined);
      await task;
      expect(connected).toBe(false);
      expect(webSocket.closeCode).toBe(1008);
    }
  });

  it("rejects text and empty WebSocket messages", async () => {
    for (const data of ["not binary", new Uint8Array()]) {
      const webSocket = new FakeWebSocket();
      const task = runVlessTunnel(webSocket, TEST_UUID, "worker.example.com", () => new FakeSocket());
      webSocket.dispatchEvent(new MessageEvent("message", { data }));
      await waitFor(() => webSocket.closeCode !== undefined);
      await task;
      expect(webSocket.closeCode).toBe(1003);
    }
  });
});
