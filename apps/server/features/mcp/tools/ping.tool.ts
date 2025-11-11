import { mcpServer } from "../../services/mcp/mcp.service";

mcpServer.registerTool({
  name: "ping",
  description: "Return a pong response to test connectivity",
  inputSchema: {
    type: "object",
    properties: {
      payload: {
        type: "object",
        description: "Tool-specific payload",
      },
    },
  },
  handler: async (input: { payload?: Record<string, unknown> }) => {
    return {
      tool: "ping",
      echo: input?.payload ?? null,
      timestamp: Date.now(),
    };
  },
});
