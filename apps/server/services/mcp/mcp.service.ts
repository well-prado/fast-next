import { MCPServer } from "@modelcontextprotocol/sdk";

type ToolConfig = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  handler: (input: unknown) => Promise<unknown>;
};

export class FastNextMcpServer {
  private readonly server = new MCPServer({
    name: "fast-next-mcp",
    version: "0.1.0",
    capabilities: {
      tools: true,
    },
  });

  private readonly tools = new Map<string, ToolConfig>();

  registerTool(tool: ToolConfig) {
    if (this.tools.has(tool.name)) {
      return;
    }
    this.tools.set(tool.name, tool);
    this.server.addTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler: tool.handler,
    });
  }

  listTools() {
    return Array.from(this.tools.values()).map(({ handler, ...meta }) => meta);
  }

  getTool(name: string) {
    return this.tools.get(name);
  }

  async start(port = Number(process.env.MCP_PORT ?? 3001)) {
    await this.server.listen(port);
    console.log("[mcp] server listening on port " + port);
  }
}

export const mcpServer = new FastNextMcpServer();
