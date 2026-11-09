# Cloudflare Workers VLESS TCP

轻量级 VLESS TCP 转发 Worker，使用 Cloudflare 边缘提供的 HTTPS/WebSocket 和 `cloudflare:sockets`。节点为标准 VLESS + WebSocket + TLS，可导入使用 Xray Core 的 v2rayN。

## 配置

1. 将本项目根目录上传到 GitHub。
2. 在 Cloudflare Dashboard 的 **Workers & Pages** 中连接该 GitHub 仓库并启用 Workers Builds。项目根目录保持为仓库根目录；构建命令设为 `npm ci && npm run check`，部署命令设为 `npx wrangler deploy`。Worker 名称使用 `cloudflare-vless-worker`。
3. Worker 创建后，在 **Settings → Variables and Secrets** 添加 Secret：名称为 `UUID`，值填入你自行生成的 UUID。不要把 UUID 写进仓库、`wrangler.jsonc` 或公开截图。也可以在已登录 Cloudflare 的终端执行 `npx wrangler secret put UUID`。
4. 可选：添加普通变量 `WS_PATH` 设置 WebSocket 路径。默认值为 `/ws`；自定义值只能包含字母、数字、`_`、`-` 和 `/`，不能包含查询字符串。
5. 可选：在 Worker 的 **Settings → Domains & Routes → Add → Custom Domain** 绑定你自己的域名。域名需要在此 Cloudflare 账号中启用 DNS，Cloudflare 会为该域名配置 TLS。`workers.dev` 域名仍可使用。

UUID 可在 macOS/Linux 使用 `uuidgen` 生成，也可在 Windows PowerShell 使用 `[guid]::NewGuid().ToString()` 生成。

## 获取 v2rayN 节点

部署并设置 `UUID` 后，打开 `https://你的域名/你的UUID`。页面会返回一条 `vless://` 分享链接，复制该链接后在 v2rayN 使用“从剪贴板导入”。如果绑定了自定义域名，请通过自定义域名访问这个配置地址；链接会自动使用当前访问域名作为服务器地址、TLS SNI 和 WebSocket Host。

部署配置默认生成 `security=tls`、`type=ws`、`encryption=none` 的标准 VLESS 链接。WebSocket 路径使用 `WS_PATH` 的实际值。

## 本地开发

安装依赖并设置本地变量：

```sh
npm ci
```

在本地创建未跟踪的 `.dev.vars` 文件：

```dotenv
UUID="你自己的UUID"
WS_PATH="/ws"
```

`.dev.vars` 已加入 `.gitignore`。运行检查和本地 Worker：

```sh
npm run check
npm run dev
```

## 行为与限制

- 仅支持 VLESS TCP 命令。UDP 和 MUX 请求会关闭连接。
- 允许公网 TCP 目标；拒绝私网/保留 IP、localhost、本地域名、Worker 自身域名和 TCP 25 端口。Cloudflare Runtime 还会拒绝其禁止的网络目标。部分端口可能受 Cloudflare 平台策略限制。
- 普通 HTTP 路径返回静态状态页；只有配置的 WebSocket 路径接受隧道连接。VLESS UUID 才是认证凭据，WebSocket 路径不替代 UUID 鉴权。
- TLS 在 Cloudflare 边缘终止。Worker 无法提供 XTLS 或 Reality 握手；实际可达性取决于域名和访问者到 Cloudflare 的网络连通情况。
- 配置地址和节点分享链接都包含 UUID，按密码保护，不要公开分享。
