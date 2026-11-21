"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import type { ListDefinition, ListItem } from "@/lib/lists";
import styles from "./item-editor.module.css";

type Field = ListDefinition["properties"][string];
type Value = ListItem["fields"][string];

// Keep the writer credential in memory, never in browser storage or a URL.
let writeToken = "";

function ItemField({ name, field, value, required }: {
  name: string;
  field: Field;
  value?: Value;
  required: boolean;
}) {
  const props = { name: `field-${name}`, defaultValue: String(value ?? ""), required };
  const bounds = { minLength: field.minLength, maxLength: field.maxLength };
  const numeric = field.type === "number" || field.type === "integer";
  return (
    <label>
      <span>{field.title ?? name}{required && <span aria-hidden="true"> *</span>}</span>
      {field.enum ? (
        <select {...props}>
          <option value="">{required ? "Choose…" : "Not set"}</option>
          {field.enum.map((choice) => <option key={choice}>{choice}</option>)}
        </select>
      ) : field.type === "boolean" ? (
        <select {...props}>
          <option value="">{required ? "Choose…" : "Not set"}</option>
          <option value="true">Yes</option><option value="false">No</option>
        </select>
      ) : numeric ? (
        <input {...props} type="number" min={field.minimum} max={field.maximum} step={field.type === "integer" ? 1 : "any"} />
      ) : field.format === "uri" ? (
        <input {...props} {...bounds} type="url" placeholder="https://…" />
      ) : (field.maxLength ?? 0) > 200 ? (
        <textarea {...props} {...bounds} rows={3} />
      ) : (
        <input {...props} {...bounds} type="text" />
      )}
      {field.description && <small>{field.description}</small>}
    </label>
  );
}

export function ItemEditor({ board, channel, schema, item }: {
  board: string;
  channel: string;
  schema: ListDefinition;
  item?: ListItem;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const token = useRef<HTMLInputElement>(null);
  const requestKey = useRef("");
  const [initial, setInitial] = useState<ListItem["fields"]>();
  const [needsToken, setNeedsToken] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const label = item ? "Edit item" : "Add item";

  useEffect(() => {
    if (initial && !dialog.current?.open) dialog.current?.showModal();
  }, [initial]);

  function open() {
    setNeedsToken(!writeToken);
    setError("");
    requestKey.current = crypto.getRandomValues(new Uint32Array(4)).join("-");
    setInitial(item?.fields ?? {});
  }

  async function write(method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    const credential = token.current?.value.trim() || writeToken;
    if (!credential) {
      setNeedsToken(true);
      setError("Enter a lilboard writer token to save changes.");
      token.current?.focus();
      return;
    }
    setPending(true);
    setError("");
    const locationAtSave = window.location.href;
    try {
      const path = `/api/boards/${encodeURIComponent(board)}/channels/${encodeURIComponent(channel)}/list`;
      const res = await fetch(item ? `${path}/items/${item.id}` : path, {
        method,
        headers: { Authorization: `Bearer ${credential}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) {
        writeToken = "";
        setNeedsToken(true);
        throw new Error("That token wasn’t accepted. Enter a valid lilboard writer token.");
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Could not save changes (${res.status}).`);
      }
      writeToken = credential;
      const newItem = method === "POST" ? (await res.json()).item : undefined;
      dialog.current?.close();
      if (window.location.href === locationAtSave) {
        const params = new URLSearchParams(window.location.search);
        if (newItem) {
          params.set("item", String(newItem.id));
          router.push(`?${params}`);
        }
        if (method === "DELETE") {
          params.delete("item");
          router.replace(`?${params}`);
        }
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save changes.");
    } finally {
      setPending(false);
    }
  }

  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const inputs = new FormData(event.currentTarget);
    const fields: Record<string, Value | null> = {};
    for (const [name, field] of Object.entries(schema.properties)) {
      const raw = String(inputs.get(`field-${name}`) ?? "");
      const starting = initial?.[name];
      if (item && raw === String(starting ?? "")) continue;
      if (!raw && !item) continue;
      fields[name] = !raw ? null : field.type === "boolean" ? raw === "true"
        : field.type === "number" || field.type === "integer" ? Number(raw) : raw;
    }
    if (item && Object.keys(fields).length === 0) dialog.current?.close();
    else void write(item ? "PATCH" : "POST", { fields, ...(!item ? { request_key: requestKey.current } : {}) });
  }

  return (
    <>
      <button ref={trigger} type="button" className={styles.trigger} onClick={open} aria-haspopup="dialog">{label}</button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId}
        onCancel={(event) => { if (pending) event.preventDefault(); }}
        onClose={() => { setInitial(undefined); trigger.current?.focus(); }}>
        {initial && (
          <form onSubmit={save}>
            <h2 id={titleId}>{label}</h2>
            <fieldset disabled={pending} className={styles.fields}>
              {Object.entries(schema.properties).map(([name, field]) => (
                <ItemField key={name} name={name} field={field} value={initial[name]} required={schema.required.includes(name)} />
              ))}
              {needsToken && (
                <label>
                  <span>Writer token</span>
                  <input ref={token} type="password" autoComplete="off" aria-describedby={`${titleId}-token`} />
                  <small id={`${titleId}-token`}>Use a lilboard writer token. It’s kept only until you reload.</small>
                </label>
              )}
            </fieldset>
            {error && <p role="alert" className={styles.error}>{error}</p>}
            <footer>
              {item && <button type="button" className={styles.remove} disabled={pending} onClick={() => {
                if (window.confirm("Remove this item from the list? Its discussion remains in history.")) void write("DELETE");
              }}>Remove item</button>}
              <button type="button" disabled={pending} onClick={() => dialog.current?.close()}>Cancel</button>
              <button type="submit" className={styles.save} disabled={pending}>{pending ? "Saving…" : item ? "Save changes" : label}</button>
            </footer>
          </form>
        )}
      </dialog>
    </>
  );
}
