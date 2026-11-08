// Streamable HTTP MCP endpoint (stateless), protected by a bearer token. Put HTTPS in front (Cloudflare Tunnel).
import { createServer, type IncomingMessage } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { connectDB, ensureSetup, mongoose } from "@finance/core";
import { createMcpServer } from "./tools";
import { checkBearer, rateLimiter } from "./auth";

const token = process.env.MCP_AUTH_TOKEN;
const port = Number(process.env.MCP_PORT ?? 8082);
const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const limit = rateLimiter(120, 60_000);
const log = (level: string, msg: string, extra: object = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), level, service: "mcp", msg, ...extra }));

const clientIp = (req: IncomingMessage) => (req.headers["cf-connecting-ip"] as string) ?? req.socket.remoteAddress ?? "?";

async function readJson(req: IncomingMessage, max = 1_000_000) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new Error("too_large");
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}

async function main() {
  if (!token || token.length < 32) throw new Error("MCP_AUTH_TOKEN must be set (>= 32 chars). Generate: openssl rand -hex 32");
  await connectDB();
  await ensureSetup();

  createServer(async (req, res) => {
    const send = (status: number, body: object) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (req.url === "/healthz") return send(mongoose.connection.readyState === 1 ? 200 : 503, { ok: mongoose.connection.readyState === 1 });
    if (!req.url?.startsWith("/mcp")) return send(404, { error: "not_found" });
    const ip = clientIp(req);
    if (!limit(ip)) return send(429, { error: "rate_limited" });
    // Reject browser cross-origin calls (DNS-rebinding protection); CLI clients send no Origin.
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) return send(403, { error: "origin_not_allowed" });
    if (!checkBearer(req.headers.authorization, token)) {
      log("warn", "mcp_auth_failed", { ip });
      return res.writeHead(401, { "www-authenticate": 'Bearer realm="finance-mcp"', "content-type": "application/json" }).end('{"error":"unauthorized"}');
    }
    if (req.method !== "POST") return send(405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: POST only)" }, id: null });
    try {
      const body = await readJson(req);
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log("error", "mcp_request_failed", { error: String(e) });
      if (!res.headersSent) send(e instanceof Error && e.message === "too_large" ? 413 : 400, { jsonrpc: "2.0", error: { code: -32700, message: "Bad request" }, id: null });
    }
  }).listen(port, () => log("info", "mcp_listening", { port }));
}

main().catch((e) => {
  log("error", "fatal", { error: String(e) });
  process.exit(1);
});
