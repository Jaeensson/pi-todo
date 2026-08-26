# Session-Bound Todos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind each pi session's todo list to that session (stored beside its session file) instead of a shared per-project `.pi/todo.json`.

**Architecture:** `src/store.ts` gains session-scoped helpers (`sessionTodoPath`, `loadSessionState`, `inheritOnFork`) and `applyAndSave` accepts an `undefined` path for in-memory (ephemeral) sessions; `index.ts` derives the store path from `ctx.sessionManager.getSessionFile()` on every tool call, inherits todos on `fork`, and drops module-level state. `core.ts` and `widget.ts` are untouched.

**Tech Stack:** TypeScript, vitest. Test runner: `npm test` (vitest run) / `npx vitest run test/store.test.ts`. Typecheck: `npm run typecheck`. Repo: `~/pi-todo` (branch: current).

**Spec:** `docs/superpowers/specs/2026-08-26-session-bound-todos-design.md`

---

### Task 1: Session-scoped store in `src/store.ts`

**Files:**
- Rewrite: `test/store.test.ts`
- Modify: `src/store.ts`

- [ ] **Step 1: Rewrite `test/store.test.ts` with session-scoped expectations**

Replace the entire contents of `test/store.test.ts`:

```ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_STATE } from "../src/core.js";
import {
  applyAndSave,
  copyState,
  inheritOnFork,
  loadSessionState,
  loadState,
  sessionTodoPath,
} from "../src/store.js";

let dir: string;
let sessionFile: string; // fake <timestamp>_<uuid>.jsonl
let todoFile: string;    // its sibling .todo.json

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-todo-"));
  sessionFile = join(dir, "2026-08-26T08-00-00-000Z_01a0deadbeef.jsonl");
  todoFile = join(dir, "2026-08-26T08-00-00-000Z_01a0deadbeef.todo.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("store", () => {
  it("sessionTodoPath derives the sibling .todo.json path", () => {
    expect(sessionTodoPath(sessionFile)).toBe(todoFile);
    expect(sessionTodoPath(join(dir, "x.jsonl"))).toBe(join(dir, "x.todo.json"));
  });

  it("loadSessionState(undefined) returns empty state (ephemeral session)", () => {
    expect(loadSessionState(undefined)).toEqual(EMPTY_STATE);
  });

  it("loadSessionState on missing file returns empty state", () => {
    expect(loadSessionState(sessionFile)).toEqual(EMPTY_STATE);
    expect(loadSessionState(todoFile)).toEqual(EMPTY_STATE);
  });

  it("applyAndSave persists and loadState round-trips", () => {
    const r = applyAndSave(todoFile, EMPTY_STATE, "add", { text: "A" });
    expect(r.error).toBeUndefined();
    const loaded = loadState(todoFile);
    expect(loaded.tasks).toEqual(r.state.tasks);
    expect(loaded.nextId).toBe(r.state.nextId);
  });

  it("applyAndSave with undefined path applies in memory and never writes", () => {
    const r = applyAndSave(undefined, EMPTY_STATE, "add", { text: "A" });
    expect(r.error).toBeUndefined();
    expect(r.state.tasks).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("applyAndSave does not write for the read-only list op", () => {
    const r = applyAndSave(todoFile, EMPTY_STATE, "list", {});
    expect(r.error).toBeUndefined();
    expect(existsSync(todoFile)).toBe(false);
  });

  it("applyAndSave does not write on error", () => {
    const r = applyAndSave(todoFile, EMPTY_STATE, "done", { id: 42 });
    expect(r.error).toBe("no task with id 42");
    // No file should exist because nothing valid was written.
    expect(() => readFileSync(todoFile, "utf8")).toThrow();
  });

  it("loadState tolerates corrupt JSON with a warning, not a throw", () => {
    writeFileSync(todoFile, "{ not json !!!", "utf8");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(loadState(todoFile)).toEqual(EMPTY_STATE);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("loadState tolerates invalid shapes (tasks not an array)", () => {
    writeFileSync(todoFile, JSON.stringify({ version: 1, tasks: "nope" }), "utf8");
    expect(loadState(todoFile)).toEqual(EMPTY_STATE);
  });

  it("loadState skips malformed records but keeps valid ones", () => {
    writeFileSync(
      todoFile,
      JSON.stringify({
        version: 1,
        nextId: 2,
        tasks: [
          { id: 1, text: "good", status: "pending", createdAt: 1, updatedAt: 1 },
          { id: "x", text: true },
          null,
        ],
      }),
      "utf8",
    );
    const loaded = loadState(todoFile);
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]?.text).toBe("good");
  });

  it("every save is atomic — no temp files remain", () => {
    for (let i = 0; i < 5; i++) applyAndSave(todoFile, EMPTY_STATE, "add", { text: `t${i}` });
    expect(existsSync(todoFile)).toBe(true);
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("copyState copies one session's todos to another", () => {
    applyAndSave(todoFile, EMPTY_STATE, "add", { text: "A" });
    const other = join(dir, "other.todo.json");
    copyState(todoFile, other);
    expect(loadState(other).tasks[0]?.text).toBe("A");
  });

  it("copyState is a no-op when the source is missing or empty", () => {
    const other = join(dir, "other.todo.json");
    copyState(join(dir, "missing.todo.json"), other);
    expect(existsSync(other)).toBe(false);

    writeFileSync(todoFile, JSON.stringify({ version: 1, nextId: 1, tasks: [] }), "utf8");
    copyState(todoFile, other);
    expect(existsSync(other)).toBe(false);
  });

  it("inheritOnFork copies the previous session's todos to a new session", () => {
    const prev = join(dir, "2026-08-25T00-00-00-000Z_01a0feed.jsonl");
    applyAndSave(sessionTodoPath(prev), EMPTY_STATE, "add", { text: "A" });
    inheritOnFork(prev, sessionFile);
    expect(loadState(todoFile).tasks[0]?.text).toBe("A");
  });

  it("inheritOnFork never overwrites an existing destination", () => {
    const prev = join(dir, "2026-08-25T00-00-00-000Z_01a0feed.jsonl");
    applyAndSave(sessionTodoPath(prev), EMPTY_STATE, "add", { text: "from prev" });
    applyAndSave(todoFile, EMPTY_STATE, "add", { text: "existing" });
    inheritOnFork(prev, sessionFile);
    expect(loadState(todoFile).tasks).toHaveLength(1);
    expect(loadState(todoFile).tasks[0]?.text).toBe("existing");
  });

  it("inheritOnFork is a no-op without a previous session file", () => {
    inheritOnFork(undefined, sessionFile);
    expect(existsSync(todoFile)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL — the old `src/store.ts` doesn't export `sessionTodoPath`/`loadSessionState`/`copyState`/`inheritOnFork`, so vitest fails to resolve the new imports.

- [ ] **Step 3: Rewrite `src/store.ts`**

Replace the entire contents of `src/store.ts`:

```ts
// src/store.ts — pure persistence: load, atomic save, apply+save. No pi imports.

import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { applyOp, type Task, type TodoOp, type TodoResult, type TodoState } from "./core.js";

interface TodoFile {
  version: number;
  nextId: number;
  tasks: Task[];
}

/** Session-bounded storage: the todo file lives beside the session file. */
export function sessionTodoPath(sessionFile: string): string {
  return sessionFile.replace(/\.jsonl$/, ".todo.json");
}

function empty(): TodoState {
  return { tasks: [], nextId: 1 };
}

/** Load a session's todos: undefined file (ephemeral session) → empty, in-memory. */
export function loadSessionState(file: string | undefined): TodoState {
  return file === undefined ? empty() : loadState(file);
}

function normalizeStatus(s: unknown): Task["status"] {
  if (s === "pending" || s === "in_progress" || s === "completed") return s;
  return "pending";
}

export function loadState(path: string): TodoState {
  if (!existsSync(path)) return empty();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<TodoFile>;
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.tasks)) return empty();
    const tasks: Task[] = [];
    let maxId = 0;
    for (const t of raw.tasks) {
      if (!t || typeof t !== "object" || typeof t.id !== "number" || typeof t.text !== "string") continue;
      tasks.push({
        id: t.id,
        text: t.text,
        status: normalizeStatus(t.status),
        createdAt: typeof t.createdAt === "number" ? t.createdAt : 0,
        updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : 0,
      });
      if (t.id > maxId) maxId = t.id;
    }
    const nextId = typeof raw.nextId === "number" && raw.nextId > maxId ? raw.nextId : maxId + 1;
    return { tasks, nextId };
  } catch (e) {
    console.warn(`pi-todo: could not read ${path}, starting empty (${(e as Error).message})`);
    return empty();
  }
}

function saveState(path: string, state: TodoState): void {
  mkdirSync(dirname(path), { recursive: true });
  const data: TodoFile = { version: 1, nextId: state.nextId, tasks: state.tasks };
  const tmp = `${path}.tmp-${randomUUID()}`;
  const fd = openSync(tmp, "wx", 0o666);
  try {
    writeFileSync(fd, JSON.stringify(data, null, 2), "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore cleanup failure */
    }
    throw e;
  }
}

export function applyAndSave(
  path: string | undefined,
  current: TodoState,
  op: TodoOp,
  params: { text?: string; id?: number },
): TodoResult {
  const result = applyOp(current, op, params);
  // "list" is read-only — skip rewriting identical bytes (tmp+fsync+rename).
  // An undefined path means an ephemeral session — apply in memory, never write.
  if (!result.error && op !== "list" && path !== undefined) saveState(path, result.state);
  return result;
}

/** Copy one session's todo file to another (fork inheritance). No-op when the
 *  source is missing or has no tasks (nothing worth inheriting). */
export function copyState(from: string, to: string): void {
  const state = loadState(from);
  if (state.tasks.length === 0) return;
  saveState(to, state);
}

/** Fork inheritance: copy the previous session's todos to the new session's
 *  file unless the destination already has one (never overwrite). */
export function inheritOnFork(previousSessionFile: string | undefined, destSessionFile: string): void {
  if (previousSessionFile === undefined) return;
  const dest = sessionTodoPath(destSessionFile);
  if (existsSync(dest)) return;
  copyState(sessionTodoPath(previousSessionFile), dest);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/store.test.ts`
Expected: ALL PASS (all tests in the rewritten file — every test in Step 1's code block; the file contains 16 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/pi-todo
git add src/store.ts test/store.test.ts
git commit -m "feat: session-scoped todo storage beside the session file"
```

---

### Task 2: Wire `index.ts` to the session store

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Rewrite `index.ts`**

Replace the entire contents of `index.ts`:

```ts
/**
 * pi-todo — a human-facing, per-session todo tracker for the pi coding agent.
 *
 * - `todo` tool: add | start | done | list | clear (persists per session, beside
 *   the session file under ~/.pi/agent/sessions; ephemeral sessions stay in memory)
 * - `/todos`: toggle the widget · `/todos clear`: clear with confirmation
 * - Anchored aboveEditor widget (ASCII-safe markers: ○ ▸ ✓)
 *
 * Superpowers compliance: the Superpowers pi extension maps "create a todo /
 * mark complete" to "an installed todo/task tool if available" — this tool is
 * that hook; Superpowers plan/checklist workflows drive it via add/start/done.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { markerFor, type TodoOp, type TodoResult, type TodoState } from "./src/core.js";
import { applyAndSave, inheritOnFork, loadSessionState, sessionTodoPath } from "./src/store.js";
import { TodoWidget, type TodoTheme, type TodoUI } from "./src/widget.js";

/** Extract the plain text of a result's first content part (text-part array or bare string). */
function firstResultText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as Record<string, unknown>;
      if (p.type === "text" && typeof p.text === "string") return p.text;
    }
  }
  return undefined;
}

/** Storage path for the current session, or undefined when the session is
 *  ephemeral (no session file) — todos then stay in memory. */
function sessionStorePath(ctx: ExtensionContext): string | undefined {
  const file = ctx.sessionManager.getSessionFile();
  return file === undefined ? undefined : sessionTodoPath(file);
}

let widget: TodoWidget | undefined;

export default function (pi: ExtensionAPI): void {
  // ---- tool ---------------------------------------------------------------

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description:
      "Manage the persistent per-session todo list. Each pi session has its own " +
      "list, stored beside the session file; resuming a session restores its todos " +
      "and other sessions are unaffected. Ops: add (new task, requires text), start " +
      "(mark in_progress — only one task is in_progress at a time), done (mark " +
      "completed), list (show all), clear (delete all). " +
      "Use for multi-step work: create one todo per step or plan task, start before " +
      "beginning work, done immediately when finished.",
    promptSnippet: "Track multi-step work in a todo list",
    promptGuidelines: [
      "Create one todo per item when the user or a plan lists tasks, checklists, or multi-step work.",
      "Call start on a task before beginning it and done immediately when it is finished — never batch completions.",
      "Use list to review what remains on long-running work.",
    ],
    parameters: Type.Object({
      op: StringEnum(["add", "start", "done", "list", "clear"] as const, {
        description: "Operation to perform",
      }),
      text: Type.Optional(Type.String({ description: "Task text (required for add)" })),
      id: Type.Optional(Type.Number({ description: "Task id (required for start and done)" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = params as { op: TodoOp; text?: string; id?: number };
      const path = sessionStorePath(ctx);
      const r: TodoResult = applyAndSave(path, loadSessionState(path), p.op, { text: p.text, id: p.id });
      widget?.setState(r.state);
      // pi derives isError only from thrown exceptions — validation failures throw.
      if (r.error) throw new Error(r.error);
      return {
        content: [{ type: "text", text: r.content }],
        details: { op: p.op, params: { text: p.text, id: p.id }, state: r.state },
      };
    },

    renderCall(args: { op?: string; text?: string; id?: number }, theme: TodoTheme) {
      if ((args as { op?: string }).op === "add") {
        return new Text(`${theme.fg("toolTitle", "todo")} + ${args.text ?? ""}`, 0, 0);
      }
      const target = args.id !== undefined ? ` #${args.id}` : "";
      return new Text(`${theme.fg("toolTitle", "todo")} ${(args as { op?: string }).op ?? "?"}${target}`, 0, 0);
    },

    renderResult(result: { details?: unknown; content?: unknown }, _opts: unknown, theme: TodoTheme) {
      // When the todo tool throws (validation failure), pi synthesizes the result with
      // details:{} and no state — fall back to the result text so the error stays visible.
      const details = result.details as { op?: TodoOp; state?: TodoState; params?: { id?: number } } | undefined;
      const state = details?.state;
      if (!state) {
        const firstText = firstResultText(result.content);
        if (firstText) return new Text(theme.fg("error", firstText), 0, 0);
        return new Text(theme.fg("muted", "todo"), 0, 0);
      }
      const tasks = state.tasks;
      let line: string | undefined;
      if (details?.op === "add" && tasks.length > 0) {
        line = `${markerFor(tasks[tasks.length - 1]!.status)} #${tasks[tasks.length - 1]!.id} ${tasks[tasks.length - 1]!.text}`;
      } else if (details?.op === "start" || details?.op === "done") {
        const t = tasks.find((x) => x.id === details?.params?.id);
        if (t) line = `${markerFor(t.status)} #${t.id} ${t.text}`;
      }
      if (!line) return new Text(theme.fg("muted", "ok"), 0, 0);
      return new Text(line, 0, 0);
    },
  });

  // ---- commands -----------------------------------------------------------

  pi.registerCommand("todos", {
    description: "Toggle todo widget visibility (or: /todos clear)",
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (arg === "clear") {
        const ok = await ctx.ui.confirm("Clear all todos?", "Removes every task from this session");
        if (!ok) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }
        const path = sessionStorePath(ctx);
        const r = applyAndSave(path, loadSessionState(path), "clear", {});
        widget?.setState(r.state);
        ctx.ui.notify(r.content, "info");
        return;
      }
      if (!widget) return;
      const next = !widget.isVisible();
      widget.setVisible(next);
      ctx.ui.notify(next ? "Todo list visible" : "Todo list hidden", "info");
    },
  });

  // ---- events -------------------------------------------------------------

  pi.on("session_start", async (event, ctx: ExtensionContext) => {
    const file = ctx.sessionManager.getSessionFile();
    // Fork/clone mint a new session id — inherit the source session's todos
    // (only when the destination has none yet; never overwrite).
    if (event.reason === "fork" && file !== undefined) {
      inheritOnFork(event.previousSessionFile, file);
    }
    const path = file === undefined ? undefined : sessionTodoPath(file);
    const state = loadSessionState(path);
    if (ctx.hasUI) {
      widget ??= new TodoWidget();
      widget.attach(ctx.ui as unknown as TodoUI);
      widget.setState(state);
    }
  });

  pi.on("turn_end", async () => {
    widget?.refresh();
  });

  pi.on("session_shutdown", async () => {
    widget?.dispose();
    widget = undefined;
  });
}
```

- [ ] **Step 2: Run the full suite and typecheck**

Run: `npx vitest run` then `npm run typecheck`
Expected: ALL PASS; typecheck clean (no unused imports, no `storePathFor` references remaining).

- [ ] **Step 3: Verify no stale references in active code**

Run: `rg -n "storePathFor|todoPath|\.pi/todo\.json" src index.ts test README.md || true`
Expected: no matches (the legacy docs under `docs/superpowers/specs/2026-08-23-*.md` and `docs/superpowers/plans/2026-08-23-*.md` are historical records and may still mention the old design).

- [ ] **Step 4: Commit**

```bash
cd ~/pi-todo
git add index.ts
git commit -m "feat: bind todo tool and widget to the active session"
```

---

### Task 3: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the storage bullet**

In `README.md`, replace the storage bullet:

```markdown
- **Storage:** `<project>/.pi/todo.json` (atomic writes; survives restarts; tolerant of
  missing/corrupt files).
```

with:

```markdown
- **Storage:** session-bound — each pi session's list lives at
  `~/.pi/agent/sessions/<cwd>/<…>.todo.json`, beside its session file (atomic writes;
  survives restarts and resumes; tolerant of missing/corrupt files). Fork/clone
  inherit the source session's todos; ephemeral sessions (`--no-session`) keep todos
  in memory only.
```

- [ ] **Step 2: Update the intro line**

In `README.md`, replace:

```markdown
A human-facing, per-project todo tracker for the pi coding agent.
```

with:

```markdown
A human-facing, per-session todo tracker for the pi coding agent.
```

- [ ] **Step 3: Verify no stale references**

Run: `rg -n "per-project|\.pi/todo\.json|<project>" README.md || true`
Expected: no matches in `README.md`.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npm test` and `npm run typecheck`
Expected: ALL PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd ~/pi-todo
git add README.md
git commit -m "docs: session-bound storage in README"
```

---

### Task 4: Verify against spec (final check)

**Files:** none (verification only)

- [ ] **Step 1: Re-read the spec and confirm coverage**

Read `docs/superpowers/specs/2026-08-26-session-bound-todos-design.md` and confirm:

- Storage: `sessionTodoPath` sibling derivation + ephemeral in-memory → Task 1/2
- Components: `store.ts` helpers, `applyAndSave(undefined)`, `copyState`/`inheritOnFork`, `index.ts` tool/command/`session_start` wiring, no module-level state → Tasks 1–2
- Data flow: path derived from `ctx.sessionManager.getSessionFile()` per call → Task 2
- Error handling: corrupt/missing → empty + warning (kept in `loadState`); fork never overwrites (guarded in `inheritOnFork`) → Tasks 1–2
- Testing section → Tasks 1 and 3 (`core.test.ts`/`widget.test.ts` untouched — confirm via `git diff --stat` showing only `src/store.ts`, `test/store.test.ts`, `index.ts`, `README.md`)
- Out of scope: no migration, no orphan cleanup, `/tree` shares a session's list → no tasks implement them (correct)

- [ ] **Step 2: Final full run**

Run: `npm test` and `npm run typecheck`
Expected: ALL PASS, typecheck clean. Working tree clean after the Task 3 commit (`git status --short` empty).