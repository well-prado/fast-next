import { mcpServer } from "./mcp.service";
import "../../features/mcp/tools";

void mcpServer.start().catch((error) => {
  console.error("[mcp] failed to start", error);
});
