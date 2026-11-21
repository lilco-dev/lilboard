"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./command-palette.module.css";

type Group = "Overview" | "Spaces" | "Chats" | "Lists";
export type Destination = {
  label: string;
  group: Group;
  href: string;
  shortcut?: "g t" | "g a";
};

const sectionKeys = new Map<string, Group>([["s", "Spaces"], ["c", "Chats"], ["l", "Lists"]]);
const preference = "lilboard.letterShortcuts";

export function CommandPalette({ destinations }: { destinations: Destination[] }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const titleId = useId();
  const fallback = useRef(true);
  const [scope, setScope] = useState<Group>();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [letters, setLetters] = useState(true);

  const readLetters = useCallback(() => {
    try { return localStorage.getItem(preference) !== "off"; }
    catch { return fallback.current; }
  }, []);

  const open = useCallback((group?: Group) => {
    setScope(group);
    setQuery("");
    setActive(0);
    setLetters(readLetters());
    if (!dialog.current?.open) dialog.current?.showModal();
    search.current?.focus();
  }, [readLetters]);

  useEffect(() => {
    let prefixUntil = 0;
    function keydown(event: globalThis.KeyboardEvent) {
      const target = event.target;
      const editing = target instanceof Element && target.closest(
        "input, textarea, select, [role=textbox], [contenteditable]:not([contenteditable=false])",
      );
      if (event.defaultPrevented || event.isComposing || event.repeat || editing || dialog.current?.open) {
        prefixUntil = 0;
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === "k") {
        prefixUntil = 0;
        event.preventDefault();
        open();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !readLetters()) {
        prefixUntil = 0;
        return;
      }
      if (key === "g") {
        prefixUntil = performance.now() + 1500;
        return;
      }
      const prefixed = performance.now() < prefixUntil;
      prefixUntil = 0;
      if (!prefixed) return;
      const direct = destinations.find(({ shortcut }) => shortcut === `g ${key}`);
      const group = sectionKeys.get(key);
      if (!direct && group === undefined) return;
      event.preventDefault();
      if (direct) router.push(direct.href);
      else open(group);
    }
    const reset = () => { prefixUntil = 0; };
    window.addEventListener("keydown", keydown);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("blur", reset);
    };
  }, [destinations, open, readLetters, router]);

  const words = query.trim().toLowerCase().split(/\s+/);
  const results = destinations.filter(({ group, label }) =>
    (scope === undefined || group === scope) && words.every((word) => `${group} ${label}`.toLowerCase().includes(word)),
  );
  const index = Math.min(active, results.length - 1);
  const optionId = index >= 0 ? `${listId}-${index}` : undefined;

  useEffect(() => {
    if (dialog.current?.open && optionId) document.getElementById(optionId)?.scrollIntoView({ block: "nearest" });
  }, [optionId]);

  function restoreFocus() {
    if (dialog.current?.contains(document.activeElement)) trigger.current?.focus();
  }

  function close() {
    dialog.current?.close();
    restoreFocus();
  }

  function choose(destination: Destination) {
    close();
    router.push(destination.href);
  }

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (index < 0) return;
    if (event.key === "Enter") {
      event.preventDefault();
      choose(results[index]);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActive((index + delta + results.length) % results.length);
    }
  }

  function setLetterShortcuts(enabled: boolean) {
    fallback.current = enabled;
    try { localStorage.setItem(preference, enabled ? "on" : "off"); } catch { /* Use the in-memory setting. */ }
    setLetters(enabled);
  }

  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={styles.commandButton}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => open()}
      >
        <span className={styles.desktopCommand}>Go to…</span>
        <span className={styles.mobileCommand}>Browse</span>
        <kbd aria-hidden="true">⌘/Ctrl K</kbd>
      </button>
      <dialog ref={dialog} className={styles.commandDialog} aria-labelledby={titleId} onClose={restoreFocus}>
        <header className={styles.commandHeader}>
          <h2 id={titleId}>{scope ? `Go to ${scope.toLowerCase()}` : "Go to…"}</h2>
          <button type="button" onClick={close} aria-label="Close navigation">Esc</button>
        </header>
        <input
          ref={search}
          type="search"
          role="combobox"
          aria-label="Find a destination"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={optionId}
          placeholder={scope ? `Search ${scope.toLowerCase()}…` : "Search spaces, chats, lists, Tasks, or Activity…"}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={handleSearchKey}
        />
        <ul role="listbox" id={listId} aria-label="Destinations" className={styles.commandResults}>
          {results.map((destination, i) => (
            <li
              key={destination.href}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === index}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(destination)}
            >
              <strong>{destination.label}</strong>
              <span>{destination.group}</span>
              {letters && destination.shortcut && <kbd>{destination.shortcut}</kbd>}
            </li>
          ))}
        </ul>
        {!results.length && <p className={styles.commandEmpty} role="status">No matching destinations.</p>}
        <footer className={styles.commandFooter}>
          <span><kbd>↑</kbd> <kbd>↓</kbd> move <kbd>Enter</kbd> open</span>
          <label><input type="checkbox" checked={letters} onChange={(event) => setLetterShortcuts(event.target.checked)} /> Letter shortcuts</label>
          {letters && <p><kbd>g s</kbd> Spaces · <kbd>g c</kbd> Chats · <kbd>g l</kbd> Lists</p>}
        </footer>
      </dialog>
    </>
  );
}
