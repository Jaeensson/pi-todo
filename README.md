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
ln -sfn ~/pi-todo ~/.pi/agent/extensions/pi-todo
```

Then restart pi or run `/reload`.

## Develop

```bash
cd ~/pi-todo
npm install
npm test         # vitest
npm run typecheck
```

Superpowers note: the Superpowers pi extension maps "create a todo / mark complete"
to any installed todo tool — this extension is that tool, so plan/checklist skills
drive it with `add` / `start` / `done` / `list`.