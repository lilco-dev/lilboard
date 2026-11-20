import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { agentName, mintAgent } from "@/lib/agent-keys";
import { DEFAULT_BOARD } from "@/lib/db";
import {
  createTask, getTask, listChannels, listMessages, listTasks,
  nextReady, postMessage, transitionTask,
} from "@/lib/core";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});
const board = z.string().min(1).default(DEFAULT_BOARD);

function serverFor(actor: NonNullable<ReturnType<typeof actorFromRequest>>) {
  const server = new McpServer({ name: "lilboard", version: "0.1.0" });

  server.registerTool("list_channels", {
    description: "List channels on a board", inputSchema: { board },
  }, ({ board }) => text({ channels: listChannels(board) }));

  server.registerTool("read_messages", {
    description: "Read messages from a channel, optionally after a message ID",
    inputSchema: {
      board, channel: z.string().min(1), after: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, ({ board, channel, after, limit }) => text({
    messages: listMessages({ board, channel, after, limit }),
  }));

  server.registerTool("post_message", {
    description: "Post a message or reply to a thread",
    inputSchema: {
      board, channel: z.string().min(1), text: z.string().min(1),
      thread: z.number().int().positive().optional(),
      labels: z.record(z.string()).optional(),
    },
  }, ({ board, channel, text: body, thread, labels }) => text({
    message: postMessage({ board, channel, body, thread, labels,
      actor: actor.actor, profile: actor.profile }),
  }));

  server.registerTool("list_tasks", {
    description: "List tasks on a board",
    inputSchema: {
      board, state: z.enum(["ready", "claimed", "done", "all"]).default("ready"),
      channel: z.string().min(1).optional(),
    },
  }, ({ board, state, channel }) => text({ tasks: listTasks({ board, state, channel }) }));

  server.registerTool("create_task", {
    description: "Create a ready task",
    inputSchema: { board, channel: z.string().min(1), title: z.string().min(1) },
  }, ({ board, channel, title }) => text({ task: createTask({
    board, channel, title, actor: actor.actor, profile: actor.profile,
  }) }));

  server.registerTool("claim_task", {
    description: "Claim the oldest ready task on a board",
    inputSchema: { board, channel: z.string().min(1).optional() },
  }, ({ board, channel }) => {
    const task = nextReady(board, channel);
    return text({ task: task ? transitionTask(task.id, "claim", actor.actor) : null });
  });

  server.registerTool("transition_task", {
    description: "Claim, release, or complete a task",
    inputSchema: {
      board, id: z.number().int().positive(),
      action: z.enum(["claim", "release", "complete"]),
    },
  }, ({ board, id, action }) => {
    const task = getTask(id);
    if (!task || task.board !== board) return { ...text({ error: "task not found" }), isError: true };
    return text({ task: transitionTask(id, action, actor.actor) });
  });

  if (actor.kind === "admin") {
    server.registerTool("mint_agent", {
      description: "Mint or rotate an agent token. The new token is shown once.",
      inputSchema: {
        name: z.string().regex(agentName),
        kind: z.enum(["agent", "person", "admin"]).default("agent"),
      },
    }, ({ name, kind }) => text(mintAgent(name, kind)));
  }
  return server;
}

export async function POST(req: Request) {
  const actor = actorFromRequest(req);
  if (!actor) return Response.json({ error: "bearer authentication required" }, { status: 401 });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  const server = serverFor(actor);
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}

// Stateless JSON responses do not need an SSE session.
export function GET() { return new Response(null, { status: 405 }); }
export function DELETE() { return new Response(null, { status: 405 }); }
