import Ajv, { type ValidateFunction } from "ajv";
import { z } from "zod";
import { ListError, store } from "./core";
import { db } from "./db";

const key = z.string().regex(/^[a-z][a-zA-Z0-9_-]{0,47}$/);
const schemaId = z.string().regex(/^[a-z][a-z0-9-]{0,47}@[1-9][0-9]{0,5}$/);
const field = z.object({
  type: z.enum(["string", "number", "integer", "boolean"]),
  title: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  enum: z.array(z.string().min(1).max(80)).min(1).max(32).optional(),
  maxLength: z.number().int().nonnegative().max(10000).optional(),
  minLength: z.number().int().nonnegative().max(10000).optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  format: z.literal("uri").optional(),
}).strict();

const listDefinition = z.object({
  $schema: z.literal("http://json-schema.org/draft-07/schema#").optional(),
  type: z.literal("object"),
  title: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  properties: z.record(key, field),
  required: z.array(key).max(24),
  additionalProperties: z.literal(false),
}).strict();

export const createListInput = z.object({
  title: z.string().trim().min(1).max(80),
  schema_id: schemaId,
  columns: z.array(key).min(1).max(8).optional(),
  make_default: z.boolean().optional(),
}).strict();

const scalar = z.union([z.string().max(10000), z.number().finite(), z.boolean()]);
export const addItemInput = z.object({
  fields: z.record(key, scalar),
  request_key: z.string().min(1).max(128).optional(),
}).strict();
export const updateItemInput = z.object({
  fields: z.record(key, scalar.nullable()),
}).strict();
export const itemId = z.number().int().positive().safe();
const listPath = z.string().max(96).regex(/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/);

export type ListDefinition = z.infer<typeof listDefinition>;
export type ListChannel = { channel: string; title: string; schema_id: string };
export type BoardList = ListChannel & { columns: string[]; schema: ListDefinition };
export type ListItem = {
  id: number;
  fields: Record<string, z.infer<typeof scalar>>;
  created_at: number;
  updated_at: number;
  created_by: string;
  updated_by: string;
};
type ItemRow = Omit<ListItem, "fields"> & { fields_json: string };

const ajv = new Ajv({ strict: true, addUsedSchema: false });
ajv.addFormat("uri", (value: string) => {
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
});
const validators = new Map<string, ValidateFunction>();
const pageSize = 50;

export function parseInput<T>(shape: z.ZodType<T>, value: unknown): T {
  const result = shape.safeParse(value);
  if (!result.success) throw new ListError(result.error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "));
  return result.data;
}

function validator(schema: ListDefinition) {
  const document = JSON.stringify(schema);
  let validate = validators.get(document);
  if (!validate) {
    try { validate = ajv.compile(schema); }
    catch (error) { throw new ListError(error instanceof Error ? error.message : "Invalid JSON Schema"); }
    validators.set(document, validate);
  }
  return validate;
}

function encodeFields(schema: ListDefinition, fields: Record<string, unknown>) {
  if (typeof fields.title !== "string" || !fields.title.trim()) throw new ListError("An item needs a nonempty title.");
  const validate = validator(schema);
  if (!validate(fields)) throw new ListError(ajv.errorsText(validate.errors));
  const encoded = JSON.stringify(fields);
  if (encoded.length > 40000) throw new ListError("Item is too large.");
  return encoded;
}

function transaction<T>(work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = work();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function registerListSchema(board: string, id: string, definition: unknown) {
  parseInput(schemaId, id);
  const schema = parseInput(listDefinition, definition);
  const fields = Object.keys(schema.properties);
  if (fields.length > 24 || schema.properties.title?.type !== "string" || !schema.required.includes("title")) {
    throw new ListError("A schema must require a string title and have at most 24 fields.");
  }
  if (schema.required.some((name) => !Object.hasOwn(schema.properties, name))) throw new ListError("Every required field must be declared.");
  validator(schema);
  const result = db.prepare("INSERT INTO list_schemas VALUES (?, ?, ?) ON CONFLICT (board, id) DO NOTHING")
    .run(board, id, JSON.stringify(schema));
  if (Number(result.changes) === 0) throw new ListError("Schema versions are immutable. Register a new version instead.", 409);
  return schema;
}

export function getList(board: string, channel: string): BoardList | null {
  // SAFETY: the query returns the channel metadata and JSON written by createList/registerListSchema.
  const row = db.prepare(`
    SELECT l.channel, l.title, l.schema_id, l.columns_json, s.definition
    FROM list_channels l JOIN list_schemas s ON l.board = s.board AND l.schema_id = s.id
    WHERE l.board = ? AND l.channel = ?
  `).get(board, channel) as (ListChannel & { columns_json: string; definition: string }) | undefined;
  if (!row) return null;
  const { columns_json, definition, ...meta } = row;
  return { ...meta, columns: JSON.parse(columns_json), schema: JSON.parse(definition) };
}

function requireList(board: string, channel: string) {
  const list = getList(board, channel);
  if (!list) throw new ListError("List not found in this space.", 404);
  return list;
}

export function listChannelsWithSchema(board: string): ListChannel[] {
  // SAFETY: all three selected columns are non-null text in list_channels.
  return db.prepare("SELECT channel, title, schema_id FROM list_channels WHERE board = ? ORDER BY channel")
    .all(board) as ListChannel[];
}

export function defaultChannel(board: string): string | undefined {
  const row = db.prepare("SELECT channel FROM space_defaults WHERE board = ?").get(board) as { channel?: unknown } | undefined;
  return typeof row?.channel === "string" ? row.channel : undefined;
}

export function createList(board: string, channel: string, input: z.infer<typeof createListInput>) {
  parseInput(listPath, channel);
  return transaction(() => {
    if (db.prepare("SELECT 1 FROM channels WHERE board = ? AND path = ?").get(board, channel)) {
      throw new ListError("A chat or list already uses this path.", 409);
    }
    const document = db.prepare("SELECT definition FROM list_schemas WHERE board = ? AND id = ?")
      .get(board, input.schema_id) as { definition?: unknown } | undefined;
    if (typeof document?.definition !== "string") throw new ListError("Register that schema version first.", 404);
    const schema: ListDefinition = JSON.parse(document.definition);
    const columns = input.columns ?? ["title", ...Object.keys(schema.properties).filter((name) => name !== "title").slice(0, 4)];
    if (columns[0] !== "title" || new Set(columns).size !== columns.length ||
        columns.some((name) => !Object.hasOwn(schema.properties, name))) {
      throw new ListError("Columns must start with title and use distinct schema field names.");
    }

    db.prepare("INSERT INTO channels VALUES (?, ?, ?)").run(board, channel, Date.now());
    db.prepare("INSERT INTO list_channels VALUES (?, ?, ?, ?, ?)")
      .run(board, channel, input.title, input.schema_id, JSON.stringify(columns));
    if (input.make_default) db.prepare("INSERT OR REPLACE INTO space_defaults VALUES (?, ?)").run(board, channel);
    store.emit(board, "list", 0, channel);
    return { channel, title: input.title, schema_id: input.schema_id, schema, columns };
  });
}

function parseItem(row: ItemRow): ListItem {
  const { fields_json, ...meta } = row;
  return { ...meta, fields: JSON.parse(fields_json) };
}

export function getItem(board: string, channel: string, id: number): ListItem | null {
  // SAFETY: list_items matches ItemRow; extra DB fields are intentionally not selected.
  const row = db.prepare(`
    SELECT id, fields_json, created_at, updated_at, created_by, updated_by
    FROM list_items WHERE board = ? AND channel = ? AND id = ?
  `).get(board, channel, id) as ItemRow | undefined;
  return row ? parseItem(row) : null;
}

export function readItems(board: string, channel: string, options: { before?: number; field?: string; value?: string } = {}) {
  const list = requireList(board, channel);
  const { before, field, value } = options;
  if (field !== undefined && !list.schema.properties[field]?.enum?.includes(value ?? "")) {
    throw new ListError("Choose a value from a list schema’s choices.");
  }
  // SAFETY: the query selects all ItemRow fields. Filters use bound parameters.
  const rows = db.prepare(`
    SELECT i.id, i.fields_json, i.created_at, i.updated_at, i.created_by, i.updated_by
    FROM list_items i WHERE i.board = $board AND i.channel = $channel AND ($before IS NULL OR i.id < $before)
    AND ($field IS NULL OR EXISTS (
      SELECT 1 FROM json_each(i.fields_json) WHERE key = $field AND value = $value
    ))
    ORDER BY i.id DESC LIMIT $limit
  `).all({ $board: board, $channel: channel, $before: before ?? null, $field: field ?? null, $value: value ?? null, $limit: pageSize + 1 }) as ItemRow[];
  const items = rows.slice(0, pageSize).map(parseItem);
  return { list, items, before: rows.length > pageSize ? items.at(-1)?.id : undefined };
}

export function addItem(board: string, channel: string, actor: string, input: z.infer<typeof addItemInput>) {
  return transaction(() => {
    const list = requireList(board, channel);
    if (input.request_key) {
      const existing = db.prepare("SELECT id FROM list_items WHERE board = ? AND channel = ? AND request_key = ?")
        .get(board, channel, input.request_key) as { id?: unknown } | undefined;
      const item = typeof existing?.id === "number" ? getItem(board, channel, existing.id) : null;
      if (item) return item;
    }
    const encoded = encodeFields(list.schema, input.fields);
    const root = store.postMessage({ board, channel, actor, body: String(input.fields.title) }, { emitEvent: false });
    db.prepare(`
      INSERT INTO list_items (id, board, channel, fields_json, created_at, updated_at, created_by, updated_by, request_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(root.id, board, channel, encoded, root.created_at, root.created_at, actor, actor, input.request_key ?? null);
    store.emit(board, "list_item", root.id, channel);
    return { id: root.id, fields: input.fields, created_at: root.created_at, updated_at: root.created_at, created_by: actor, updated_by: actor };
  });
}

export function updateItem(board: string, channel: string, id: number, actor: string, input: z.infer<typeof updateItemInput>) {
  return transaction(() => {
    const list = requireList(board, channel);
    const item = getItem(board, channel, id);
    if (!item) throw new ListError("Item not found in this list.", 404);
    if (Object.keys(input.fields).some((name) => !Object.hasOwn(list.schema.properties, name))) {
      throw new ListError("Patch fields must exist in the schema.");
    }
    const fields = Object.fromEntries(Object.entries({ ...item.fields, ...input.fields }).filter(([, value]) => value !== null));
    const encoded = encodeFields(list.schema, fields);
    const updated_at = Date.now();
    db.prepare("UPDATE list_items SET fields_json = ?, updated_at = ?, updated_by = ? WHERE id = ?")
      .run(encoded, updated_at, actor, id);
    if (item.fields.title !== fields.title) db.prepare("UPDATE messages SET body = ? WHERE id = ?").run(String(fields.title), id);
    store.emit(board, "list_item", id, channel);
    return { ...item, fields, updated_at, updated_by: actor };
  });
}
