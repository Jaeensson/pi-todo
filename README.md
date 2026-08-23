# pi-todo

A human-facing, per-project todo tracker for the pi coding agent.

- **Tool:** `todo` — `add | start | done | list | clear`. The model creates one todo per
  step or plan task, marks `in_progress` before starting, and `done` when finished.
- **Widget:** anchored above the editor, toggled with `/todos`; renders only when the
  list is non-empty. Markers: `○` pending · `▸` in_progress · `✓` completed (no emojis).
- **Storage:** `<project>/.pi/todo.json` (atomic writes; survives restarts; tolerant of
  missing/corrupt files).
- **Commands:** `/todos` (toggle widget) · `/todos clear` (clear with confirmation).

## Install

```bash
pi install git:git@github.com:Jaeensson/pi-todo
```

Then restart pi or run `/reload`. (HTTPS alternative: `git:github.com/Jaeensson/pi-todo`)

The `todo` tool is auto-discovered by the Superpowers pi mapping, so plan/checklist
skills drive it with `add` / `start` / `done` / `list`.

## Develop

```bash
cd ~/pi-todo
npm install
npm test         # vitest
npm run typecheck
```