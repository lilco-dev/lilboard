import crypto from "node:crypto";
import { db, hashToken } from "./db";

export const agentName = /^[a-zA-Z0-9_-]{1,64}$/;
export const actorKinds = ["agent", "person", "admin"] as const;
export type ActorKind = (typeof actorKinds)[number];

export function mintAgent(name: string, kind: ActorKind) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT OR REPLACE INTO actors (name, token_hash, kind) VALUES (?, ?, ?)")
    .run(name, hashToken(token), kind);
  return { name, kind, token };
}
