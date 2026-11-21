import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { agentName, mintAgent } from "@/lib/agent-keys";
import { DEFAULT_BOARD } from "@/lib/db";
import {
  addItem, addItemInput, createList, createListInput, itemId, listChannelsWithSchema,
  listDefinition, readItems, registerListSchema, schemaId, updateItem, updateItemInput,
} from "@/lib/lists";
import {
  createTask, getTask, listChannels, listEvents, listMessages,
  listTasks, nextReady, postMessage, transitionTask, waitForEvents,
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

  server.registerTool("poll_events", {
    description: "Wait for new board events after a cursor; returns immediately on a new event or after the timeout",
    inputSchema: {
      board, since: z.number().int().nonnegative().default(0),
      timeout: z.number().int().min(1).max(30).default(25),
    },
  }, async ({ board, since, timeout }, { signal }) => {
    await waitForEvents(board, since, timeout * 1000, signal);
    const events = listEvents(board, since);
    return text({ events, cursor: events.length ? events[events.length - 1].id : since });
  });

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

  server.registerTool("suggest_feedback", {
    description: "File a feature request, change, or bug in the feedback channel. Feedback is publicly readable; do not include secrets.",
    inputSchema: {
      kind: z.enum(["feature", "change", "bug"]),
      title: z.string().trim().min(1).max(160),
      description: z.string().trim().min(1).max(4000),
    },
  }, ({ kind, title, description }) => text({ message: postMessage({
    board: DEFAULT_BOARD, channel: "feedback", body: `[${kind}] ${title}\n\n${description}`,
    labels: { feedback: kind }, actor: actor.actor, profile: actor.profile,
  }) }));

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

  const listChannel = z.string().min(1);
  server.registerTool("register_list_schema", {
    description: "Register an immutable schema version on a board before creating lists with it.",
    inputSchema: { board, schema_id: schemaId, definition: listDefinition },
  }, ({ board, schema_id, definition }) => text({ id: schema_id, schema: registerListSchema(board, schema_id, definition) }));

  server.registerTool("create_list", {
    description: "Create a schema-backed list in a board channel. The schema must already be registered.",
    inputSchema: { board, channel: listChannel, ...createListInput.shape },
  }, ({ board, channel, ...input }) => text({ list: createList(board, channel, input) }));

  server.registerTool("list_lists", {
    description: "List schema-backed lists in a space",
    inputSchema: { board },
  }, ({ board }) => text({ lists: listChannelsWithSchema(board) }));

  server.registerTool("read_list", {
    description: "Read a list's schema and items. Use before for older items or field/value for a schema choice.",
    inputSchema: { board, channel: listChannel, before: itemId.optional(), field: z.string().optional(), value: z.string().optional() },
  }, ({ board, channel, before, field, value }) => text(readItems(board, channel, { before, field, value })));

  server.registerTool("add_list_item", {
    description: "Add a validated list item. Reuse request_key to safely retry. The item ID is also its discussion thread ID.",
    inputSchema: { board, channel: listChannel, ...addItemInput.shape },
  }, ({ board, channel, ...input }) => text({ item: addItem(board, channel, actor.actor, input) }));

  server.registerTool("update_list_item", {
    description: "Patch fields on an existing list item. Unspecified fields are unchanged; null removes an optional field.",
    inputSchema: { board, channel: listChannel, id: itemId, ...updateItemInput.shape },
  }, ({ board, channel, id, ...input }) => text({ item: updateItem(board, channel, id, actor.actor, input) }));

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
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = serverFor(actor);
  await server.connect(transport);
  let response: Response;
  try {
    response = await transport.handleRequest(req);
  } catch (error) {
    await server.close();
    throw error;
  }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    await server.close();
    return response;
  }
  // Keep the per-request server alive until its SSE response ends or the
  // client disconnects (poll_events may take up to 30 seconds).
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          await server.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
        await server.close();
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } finally { await server.close(); }
    },
  });
  return new Response(body, { status: response.status, headers: response.headers });
}

// Streamable HTTP permits 405 when a standalone GET SSE stream is not offered.
export function GET() { return new Response(null, { status: 405 }); }
export function DELETE() { return new Response(null, { status: 405 }); }
