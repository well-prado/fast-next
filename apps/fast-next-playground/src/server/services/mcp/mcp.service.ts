import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShape } from "zod";

type TextContent = {
  type: "text";
  text: string;
  _meta?: Record<string, unknown>;
};

type ToolCallResult = {
  content: TextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

type ToolConfig = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  handler: (input: unknown) => Promise<unknown>;
};

export class FastNextMcpServer {
  private readonly server = new McpServer({
    name: "fast-next-mcp",
    version: "0.1.0",
  });

  private readonly tools = new Map<string, ToolConfig>();

  registerTool(tool: ToolConfig) {
    if (this.tools.has(tool.name)) {
      return;
    }
    this.tools.set(tool.name, tool);
    this.server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema as any,
      },
      async (args: unknown) => normalizeToolResult(await tool.handler(args))
    );
  }

  listTools() {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  getTool(name: string) {
    return this.tools.get(name);
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    await transport.start();
    console.log("[mcp] stdio transport started");
  }
}

export const mcpServer = new FastNextMcpServer();

function normalizeToolResult(result: unknown): ToolCallResult {
  if (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown }).content)
  ) {
    const cast = result as ToolCallResult;
    return {
      ...cast,
      structuredContent: cast.structuredContent ?? {},
    };
  }

  const text =
    typeof result === "string"
      ? result
      : JSON.stringify(result ?? { message: "ok" }, null, 2);

  const structuredContent =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : { value: result ?? null };

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    structuredContent,
  };
}
