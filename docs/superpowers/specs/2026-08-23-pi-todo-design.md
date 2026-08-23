# pi-todo — Specification

**Date:** 2026-08-23
**Status:** Approved design (chat, 2026-08-23); pending implementation plan
**Scope:** A human-facing todo tracker extension for the pi coding agent, developed at `~/pi-todo`.

## 1. Goal

The user follows long-running tasks poorly without a visible task list. pi-todo gives them a
**persistent, per-project todo list** with a **toggleable, always-anchored, ASCII-only TUI widget**
above the editor, managed by a minimal `todo` tool the model can call, and compliant with the
Superpowers skill system's task-tracking expectations.

Named `pi-todo`. Will not be published to npm. Name collisions are out of scope.

## 2. Context and research

Seven existing pi todo/task extensions were analyzed (kirang89/pi-todo; @jerryan/pi-todo-lite;
rpiv-todo/@juicesharp; @tintinweb/pi-tasks; mrg2400xx/pi-todo; @minhduydev/pi-todo; nczz/pi-tasks).
Their main design forks: **persistence** (branch replay vs JSON file vs markdown file), **state model**
(boolean vs 3-state vs 4-state vs plan/evidence contracts), **tool surface** (single op tool vs
per-action tools), **widget mechanics**, and **reminder strategy**.

### 2.1 Superpowers compliance requirement (top priority)

The Superpowers pi extension (superpowers repo's `.pi/extensions/superpowers.ts`) injects the
following mapping into every session:

> "Pi does not ship a standard task-list tool. **If an installed todo/task tool is available, use it.**
> Otherwise track work in plan files or a repo-local `TODO.md` when task tracking is needed.
> Treat older `TodoWrite` references as this task-tracking action."

Same in `skills/using-superpowers/references/pi-tools.md`. Superpowers skills use todos as actions:
"create a todo per item" (using-superpowers), "create todos for the plan items" (executing-plans),
"create a todo per task" / "mark the todo complete and move on" (subagent-driven-development).

**Compliance therefore means:** provide *a* documented todo/task tool (no specific name required)
whose actions cover create / list / mark-complete / track-progress. No adapter or repo changes needed.

## 3. Design decisions (agreed in chat)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Persistence | **Per-project JSON file** (`.pi/todo.json`) — not markdown; the widget is the human surface, file is machine-opaque by choice |
| D2 | Widget anchoring | **Anchored to a fixed layout region** — `aboveEditor`; conversation scrolls independently; standard widget semantics (auto-hide when empty) |
| D3 | Task lifecycle | **3 states:** `pending → in_progress → completed` |
| D4 | Tool surface | **Approach A:** single `todo` tool with `op` discriminator: `add \| start \| done \| list \| clear` |
| D5 | Glyphs | **ASCII only** — no emojis, no box-drawing/Unicode glyphs. Enforced by test |
| D6 | Dev location | `~/pi-todo` (git repo). Deployed via symlink `~/.pi/agent/extensions/pi-todo → ~/pi-todo` (auto-discovery + `/reload`) |
| D7 | Single-active invariant | `start` pauses any other `in_progress` item (exactly one active at a time) |
| D8 | Toggle | `/todos` toggles widget visibility; `/todos clear` clears (with `ui.confirm`) |
| D9 | No extras | No delete/edit ops, dependencies, priorities, reminders, subagents, phases, archive, keybindings, auto-clear |

## 4. Architecture

```
~/pi-todo/
├── index.ts                  # pi entry (auto-discovered via symlink as extensions/pi-todo/index.ts)
├── package.json              # private; "typebox" dep; devDeps: vitest, typescript
├── src/
│   ├── core.ts               # PURE logic — types, reducer, formatting, ASCII glyphs (no pi imports)
│   ├── store.ts              # JSON persistence — load / atomic save / path resolution (no pi imports)
│   └── widget.ts             # widget controller — register-once + requestRender (pi imports only in types)
├── test/
│   ├── core.test.ts
│   ├── store.test.ts
│   └── widget.test.ts
└── docs/superpowers/specs/   # this spec
```

- `core` and `store` are pure and unit-testable with zero pi coupling.
- `index.ts` wires pi (tool registration, commands, events) thinly over `core`/`store`/`widget`.
- Runtime resolution: `@earendil-works/pi-coding-agent`, `typebox`, `@earendil-works/pi-ai`,
  `@earendil-works/pi-tui` are host-provided by pi at runtime (same as existing `color-hints.ts`).
  For vitest, `typebox` is installed as a dependency.

## 5. Data model

File: `<cwd>/.pi/todo.json`

```json
{
  "version": 1,
  "nextId": 3,
  "tasks": [
    { "id": 1, "text": "Refactor auth", "status": "in_progress",
      "createdAt": 1730000000000, "updatedAt": 1730000000000 }
  ]
}
```

- `id`: numeric, monotonic from `nextId`.
- `status`: `"pending" | "in_progress" | "completed"`.
- **Load:** missing file → empty state; unreadable/`JSON.parse` failure → `console.warn` + empty state
  (never crash pi); shape validation (tasks array, numeric ids) with per-record tolerance.
- **Save:** synchronous `writeFileSync` → `fsyncSync` → atomic `renameSync` (temp path `todo.json.tmp-<rand>`);
  never leaves a torn file; clean up temp on failure.
- Store is re-read before each mutation (stays fresh against external/other-session edits; sync I/O is
  negligible at this size).

## 6. Tool specification

`registerTool({ name: "todo", label: "Todo", ... })`

| op | required | behavior |
|----|----------|----------|
| `add` | `text` | create task, status `pending` |
| `start` | `id` | set `in_progress`; other `in_progress` items revert to `pending` (single-active, D7) |
| `done` | `id` | set `completed` |
| `list` | — | ASCII list, all tasks, same `[ ]`/`[>]`/`[x]` markers + `#id` as the widget (§8) |
| `clear` | — | empty the list |

- Non-existent `id` → `"Error: no task with id N"` (isError result).
- Missing required param → error result.
- `description`: concise; mentions the store file, ops, and that the widget reflects state.
- `promptSnippet` / `promptGuidelines`: "use for multi-step work / plan tasks / checklist items;
  `start` before beginning work; `done` immediately when finished; one task in_progress at a time" —
  this is the Superpowers-alignment surface.
- `renderCall` / `renderResult`: compact ASCII, e.g. `todo + Refactor auth` / `[x] #1 Refactor auth`.

## 7. Commands

| command | behavior |
|---------|----------|
| `/todos` | toggle widget visibility; `notify("Todo list visible/hidden")` |
| `/todos clear` | `ui.confirm` first, then clear |

Visibility flag is per-session, defaults ON.

## 8. Widget specification

- `ctx.ui.setWidget("pi-todo", factory, { placement: "aboveEditor" })` — factory form, register-once,
  keep captured `tui` for `requestRender()`; re-register when the UI context identity changes
  (the pattern used by all seven researched implementations).
- **Renders iff:** toggle ON **and** `tasks.length > 0`. (Standard anchored semantics, D2.)
- **Layout (ASCII only, D5):**
  ```
  Todos 2/5  (1 in progress)
  [ ] 1 Refactor auth
  [>] 2 Wire up token refresh
  [x] 3 Port landing.html
  ```
  - markers: `[ ]` pending (default text color) · `[>]` in_progress (`theme.fg("accent")`)
    · `[x]` completed (`theme.fg("dim")`)
  - ordering: pending → in_progress → completed (stable by id within status)
  - header: `Todos <n>/<total>` + `(<k> in progress)` when k > 0; colored via theme
  - cap: max 10 lines (header + 9), overflow → `+N more`
- Unregistered on `session_shutdown`; refreshed on tool mutation and `turn_end`.

## 9. Events

| event | handler |
|-------|---------|
| `session_start` | resolve cwd → load store → register widget → render if visible && non-empty |
| tool `execute` (post-mutation) | persist → refresh widget |
| `turn_end` | refresh widget (cheap consistency) |
| `session_shutdown` | unregister widget |

No reminders, no `context`-hook injection (D9).

## 10. Testing (TDD)

- **core.test.ts:** reducer transitions (all valid/invalid), id sequencing, single-active invariant,
  `clear`, error paths, and a **ASCII-only invariant** — every rendered string must contain only
  printable ASCII (`/^[ -~\\t\\n]*$/`) — mechanically enforcing D5.
- **store.test.ts:** round-trip; missing file → empty; corrupt JSON → empty + warn; atomic save leaves
  no `*.tmp*`; scratch-dir tests (no touching real `.pi/todo.json`).
- **widget.test.ts:** visibility rules (toggle/empty), line cap + overflow, ordering.
- Manual: run pi in a scratch project, `/reload`, toggle `/todos`, drive the tool, verify widget and
  file on disk.

## 11. Deployment

- Dev: `~/pi-todo`.
- Runtime: `ln -s ~/pi-todo ~/.pi/agent/extensions/pi-todo` → auto-discovered
  (`~/.pi/agent/extensions/*/index.ts`), hot-reloadable via `/reload`.
- Fallback (if symlink unreliable): add `"~/pi-todo"` to `~/.pi/agent/settings.json` `extensions` array.

## 12. Non-goals (explicit)

Delete/edit ops · dependency DAG · priorities/assignees · reminders · subagent/sub-task integration ·
phases · archive/migration · i18n · shared multi-session lists · file locking (single user) ·
keybindings · markdown-as-store · auto-clear.

## 13. Success criteria

1. Widget shows per-project tasks anchored above the editor; `/todos` toggles it; ASCII only.
2. Tasks persist across pi restarts in `.pi/todo.json`; corrupt/missing files never crash pi.
3. Model successfully plans/executes a Superpowers plan workflow (executing-plans) using the
   `todo` tool for add/start/done/list.
4. `npm test` green in `~/pi-todo`.