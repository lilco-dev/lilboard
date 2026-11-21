export const LIST_SCHEMA = `
CREATE TABLE IF NOT EXISTS list_schemas (
  board TEXT NOT NULL,
  id TEXT NOT NULL,
  definition TEXT NOT NULL,
  PRIMARY KEY (board, id)
);

CREATE TABLE IF NOT EXISTS list_channels (
  board TEXT NOT NULL,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  schema_id TEXT NOT NULL,
  columns_json TEXT NOT NULL,
  PRIMARY KEY (board, channel),
  FOREIGN KEY (board, channel) REFERENCES channels(board, path),
  FOREIGN KEY (board, schema_id) REFERENCES list_schemas(board, id)
);

CREATE TABLE IF NOT EXISTS space_defaults (
  board TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  FOREIGN KEY (board, channel) REFERENCES channels(board, path)
);

CREATE TABLE IF NOT EXISTS list_items (
  id INTEGER PRIMARY KEY REFERENCES messages(id),
  board TEXT NOT NULL,
  channel TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  request_key TEXT,
  UNIQUE (board, channel, request_key),
  FOREIGN KEY (board, channel) REFERENCES list_channels(board, channel)
);
CREATE INDEX IF NOT EXISTS idx_list_items_channel ON list_items (board, channel, id);
`;