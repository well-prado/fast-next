import { mcpServer } from "@/server/services/mcp/mcp.service";
import { z, type ZodRawShape } from "zod";

const payloadSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Tool-specific payload");

const inputSchema: ZodRawShape = {
  payload: payloadSchema,
};

mcpServer.registerTool({
  name: "ping",
  description: "Return a pong response to test connectivity",
  inputSchema,
  handler: async (input: unknown) => {
    const parsed = z
      .object({
        payload: payloadSchema,
      })
      .safeParse(input);

    const payload = parsed.success ? (parsed.data.payload ?? null) : null;

    return {
      content: [
        {
          type: "text",
          text: "pong",
        },
      ],
      structuredContent: {
        tool: "ping",
        echo: payload,
        timestamp: Date.now(),
      },
    };
  },
});
