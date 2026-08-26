# Session-Bound Todos — Design

Date: 2026-08-26
Status: Approved

## Problem

`pi-todo` currently persists todos to `<project>/.pi/todo.json`. Every session
in a workspace reads and writes the *same* file, so todo lists are shared across
all sessions in a project. The user wants todos bound to the individual pi
session instead: each session gets its own independent list, durable across
restarts and resumptions, with no cross-session leakage through the workspace.

## Decisions (user-confirmed)

1. **Persist per-session-id.** Each session's todos are stored keyed by its
   session, so resuming the same session restores its list while other sessions
   are unaffected.
2. **Start fresh.** The legacy `<project>/.pi/todo.json` is no longer read or
   written and is not migrated. Every session starts with an empty list.
3. **Storage: sibling of the session file** (Approach A). Todo data lives next
   to pi's own session file, sharing its lifecycle and directory organization.

## Background: pi session model

- Sessions are JSONL files at `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
- The session UUID is globally unique and stable across extension reloads
  (`/reload`) and resumption (`/resume`) of the same session.
- `ctx.sessionManager.getSessionFile()` returns the current session file path,
  or `undefined` in ephemeral mode (`--no-session`, RPC-without-persistence).
- `ctx.sessionManager` is available in tool `execute`, command handlers, and
  event handlers (`session_start`, etc.).
- pi filters session directories by `.jsonl` extension, so a sibling
  `.todo.json` is invisible to the session picker and listing logic.
- On session switch/fork, pi emits `session_shutdown` for the old extension
  instance, rebinds extensions, then `session_start` with
  `event.reason` ∈ `"startup" | "reload" | "new" | "resume" | "fork"` and
  `event.previousSessionFile` present for `"new"`, `"resume"`, and `"fork"`.

## Storage

- Per-session todo file: `sessionTodoPath(sessionFile)` = the session file path
  with the `.jsonl` suffix replaced by `.todo.json`.
  Example: `<sessionDir>/2026-08-26T10-00-00-000Z_01a0…abc.jsonl`
  → `<sessionDir>/2026-08-26T10-00-00-000Z_01a0…abc.todo.json`.
- **Ephemeral sessions** (`getSessionFile()` → `undefined`): todos live in
  memory for the process lifetime; nothing is written to disk.
- The legacy `<project>/.pi/todo.json` is neither read nor written, and is not
  migrated.

## Components

### `src/store.ts` (pure persistence; no pi imports)

- Replace `storePathFor(cwd)` with:
  - `sessionTodoPath(sessionFile: string): string` — derive the sibling path.
  - `loadSessionState(file: string | undefined): TodoState` — empty state when
    `file` is `undefined`; otherwise `loadState(file)` behavior (missing →
    empty, corrupt → empty + warning, malformed records skipped).
- Keep `loadState` / `saveState` / `applyAndSave` machinery unchanged:
  atomic tmp+fsync+rename writes, tolerant loads.
- `applyAndSave(path: string | undefined, current, op, params)` — an
  `undefined` path applies the op in memory only and never writes (used by
  ephemeral sessions). `list` stays read-only regardless.
- New `copyState(from: string, to: string): void` — read `from`,
  write `to` (no-op if `from` is missing or has no tasks).

### `src/core.ts` / `src/widget.ts` (unchanged)

Pure reducer and renderer; no persistence or session knowledge.

### `index.ts` (wire-up)

- Remove module-level `state` and `todoPath`; keep module-level `widget`.
- **Tool `execute`**: derive `path = sessionTodoPath-or-undefined` from
  `ctx.sessionManager.getSessionFile()`; `loadSessionState(path)` →
  `applyAndSave(path, …)` → `widget.setState`.
- **`session_start`**:
  - Bind the active session (path from `ctx.sessionManager.getSessionFile()`).
  - If `event.reason === "fork"` and the new session's todo file does not exist,
    `copyState(sessionTodoPath(event.previousSessionFile) → new path)` so
    fork/clone inherit the source session's todos.
  - `resume` / `new` / `startup` / `reload` never copy.
  - Load state and `widget.setState`.
- **`/todos clear`**: same resolve→load→apply flow; confirmation copy updated to
  "removes every task from this session".
- **Tool description / guidelines**: "per-project todo list (.pi/todo.json)"
  replaced with session-bound wording.

## Data flow

1. Tool call or command → `ctx.sessionManager.getSessionFile()` → sibling path
   or `undefined`.
2. Load state (empty if missing/corrupt/undefined) → apply op → save (unless
   ephemeral/read-only/error) → widget refresh.
3. Session switch (`/resume`, `/new`, `/fork`, `/reload`) → `session_shutdown`
   → `session_start` rebinds the widget to the new session's state.

## Error handling

- Missing or corrupt per-session file → empty state + console warning
  (unchanged from today).
- Ephemeral mode (no session file) → in-memory only; widget still renders;
  no recovery later.
- Fork copy never overwrites an existing destination (only copies when the
  destination has no todo file), so no data loss.

## Testing

- `store.test.ts`:
  - `sessionTodoPath` derivation (`.jsonl` → `.todo.json`).
  - `applyAndSave(undefined, …)` applies in memory and never writes.
  - `copyState` round-trips; no-op when source missing.
  - Existing atomic-save / corrupt-load / malformed-record tests adapted to the
    new path shape.
- `core.test.ts` / `widget.test.ts`: unchanged.
- `npm test` and `npm run typecheck` green.

## Out of scope

- Migrating legacy `<project>/.pi/todo.json` (explicitly rejected).
- Automatic cleanup of orphaned `.todo.json` files whose session was deleted
  (session deletion is external to pi's extension events; files are small and
  sit next to their session for manual cleanup).
- Branching within a session tree (`/tree` navigation) — the session UUID and
  todo file are shared across a session's branches by design.