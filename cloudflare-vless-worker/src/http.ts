import { isValidUuid } from "./protocol.ts";

export interface WorkerEnv {
  UUID?: string;
  WS_PATH?: string;
}

const LANDING_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Service status</title>
  <style>
    :root { color-scheme: light; font: 16px/1.55 system-ui, sans-serif; color: #202124; background: #f5f7f8; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
    main { width: min(34rem, calc(100% - 3rem)); padding: 2rem 0; }
    h1 { margin: 0 0 .5rem; font-size: 1.4rem; font-weight: 600; }
    p { margin: 0; color: #5f6368; }
    .status { display: inline-block; margin-top: 1.25rem; padding: .2rem .55rem; border: 1px solid #d6dfdc; border-radius: 4px; color: #24634b; font-size: .82rem; }
  </style>
</head>
<body><main><h1>Service status</h1><p>The service is available.</p><span class="status">Operational</span></main></body>
</html>`;

export function getWebSocketPath(value: string | undefined): string | null {
  if (!value) return "/ws";
  if (
    value.length > 128 ||
    !/^\/[A-Za-z0-9/_-]+$/.test(value) ||
    value === "/" ||
    value.includes("//") ||
    value.includes("..")
  ) {
    return null;
  }
  return value;
}

export function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = request.headers.get("Upgrade");
  const connection = request.headers.get("Connection");
  return (
    request.method === "GET" &&
    upgrade?.toLowerCase() === "websocket" &&
    Boolean(connection?.split(",").some((value) => value.trim().toLowerCase() === "upgrade"))
  );
}

export function isTunnelUpgradeRequest(
  request: Request,
  env: WorkerEnv,
): env is WorkerEnv & { UUID: string } {
  const wsPath = getWebSocketPath(env.WS_PATH);
  return Boolean(
    wsPath &&
      new URL(request.url).pathname === wsPath &&
      isWebSocketUpgrade(request) &&
      isValidUuid(env.UUID),
  );
}

function textResponse(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function landingResponse(): Response {
  return textResponse(LANDING_PAGE, "text/html; charset=utf-8");
}

export function buildVlessUri(uuid: string, hostname: string, wsPath: string): string {
  const authority = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  const query = new URLSearchParams({
    encryption: "none",
    security: "tls",
    sni: hostname,
    fp: "chrome",
    type: "ws",
    host: hostname,
    path: wsPath,
  });
  const name = encodeURIComponent(`CF ${hostname}`);
  return `vless://${uuid}@${authority}:443?${query.toString()}#${name}`;
}

export function handleHttpRequest(request: Request, env: WorkerEnv): Response {
  const url = new URL(request.url);
  const wsPath = getWebSocketPath(env.WS_PATH);
  const uuid = env.UUID;

  if (
    request.method === "GET" &&
    isValidUuid(uuid) &&
    url.pathname.toLowerCase() === `/${uuid.toLowerCase()}` &&
    wsPath
  ) {
    return textResponse(
      buildVlessUri(uuid, url.hostname, wsPath),
      "text/plain; charset=utf-8",
    );
  }

  return landingResponse();
}
