/**
 * 진입점 — 전송(transport) 부트스트랩.
 *   MCP_TRANSPORT=stdio (기본): 로컬·MCP Inspector·Claude Desktop용.
 *   MCP_TRANSPORT=http        : 카카오클라우드/PlayMCP 배포용 Streamable HTTP.
 *
 * HTTP는 무상태(stateless) 패턴 — 요청마다 server+transport 생성(수평 확장에 안전).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { createServer, SERVER_INFO } from "./server.js";
import { startAutoRefresh } from "./data/refresh.js";
import { loadStore } from "./data/store.js";

async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio에서는 stderr로만 로깅(프로토콜은 stdout 사용)
  console.error(`[${SERVER_INFO.name}] stdio transport ready`);
  startAutoRefresh(); // 공고 자동 갱신(기동 1회 + 주기, 실패 시 기존 유지)
}

async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // 헬스체크 (카카오클라우드 LB용) — 공고 수집시점·건수 노출로 신선도 확인 가능
  app.get("/health", (_req, res) => {
    const store = loadStore();
    res.json({
      status: "ok",
      server: SERVER_INFO.name,
      version: SERVER_INFO.version,
      grants: store.count,
      collected_at: store.collected_at,
    });
  });

  // MCP 엔드포인트 (무상태)
  app.post("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // 무상태
      enableDnsRebindingProtection: allowedOrigins.length > 0,
      allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp] 요청 처리 오류:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // 무상태 모드에서는 GET(SSE 스트림)·DELETE 미지원 안내
  const methodNotAllowed = (_req: express.Request, res: express.Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless mode: use POST /mcp)" },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  const port = parseInt(process.env.PORT ?? "8080", 10);
  app.listen(port, () => {
    console.error(`[${SERVER_INFO.name}] HTTP transport on :${port} (POST /mcp, GET /health)`);
    startAutoRefresh(); // 공고 자동 갱신(기동 1회 + 주기, 실패 시 기존 유지)
  });
}

const transport = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
(transport === "http" ? runHttp() : runStdio()).catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
