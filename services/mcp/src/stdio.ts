// Local stdio transport (e.g. Claude Desktop on the same machine). Logs go to stderr only.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectDB, ensureSetup } from "@finance/core";
import { createMcpServer } from "./tools";

console.log = console.error;
await connectDB();
await ensureSetup();
await createMcpServer().connect(new StdioServerTransport());
