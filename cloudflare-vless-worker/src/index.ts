import { connect } from "cloudflare:sockets";
import { handleHttpRequest, isTunnelUpgradeRequest, type WorkerEnv } from "./http.ts";
import { runVlessTunnel } from "./tunnel.ts";

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (!isTunnelUpgradeRequest(request, env)) {
      return handleHttpRequest(request, env);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    void runVlessTunnel(server, env.UUID, url.hostname, ({ hostname, port }) =>
      connect({ hostname, port }),
    );

    return new Response(null, { status: 101, webSocket: client });
  },
};

export default worker;
