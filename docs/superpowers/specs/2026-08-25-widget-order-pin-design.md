# pi-todo — Widget Ordering & Overflow Pin

**Date:** 2026-08-25
**Status:** Approved design (chat, 2026-08-25); pending implementation plan
**Scope:** Change to `src/widget.ts` rendering only (`renderWidgetLines`); tests in `test/widget.test.ts`.

## 1. Goal

Two rendering rule changes for the widget:

1. **Tasks never move.** Marking a task `in_progress` (or `completed`) must not change
   its position in the widget. Today the widget sorts by status
   (`pending → in_progress → completed`), so `start` demotes a task below all remaining
   pending tasks. The widget must render in insertion order instead.
2. **Overflow pin.** When the list has more tasks than the widget can render (the
   `+N more` case), the top rendered line must be the **most recently completed** task
   — the completion feedback must stay visible even in a long list. If no task has been
   completed, the window shows the top of the list as today.

## 2. Data model

No changes to `core.ts` / `store.ts` / `index.ts` / tool schema.

- Tasks are already stored in insertion order; `id` is monotonically increasing.
- `done` sets `updatedAt` at completion time, so the most recently completed task is the
  completed task with the **max `updatedAt`**; ties (same millisecond, or tests with
  `updatedAt: 0`) are broken by **higher `id`** (ids are assigned in completion order).

## 3. Rendering rules (`renderWidgetLines`)

1. **Order:** render tasks in `id` ascending order (the array order, on a defensive
   copy). Remove the `STATUS_ORDER`/`byStatusThenId` sort.
2. **Budget:** unchanged — `budget = max(0, maxLines - 2)` (header + `+N more` line).
3. **Start index:**
   - If `tasks.length <= budget`: all tasks visible, `start = 0`.
   - Else if ≥ 1 task is `completed`: `start = index of most recently completed task`
     (max `updatedAt`, tie-break higher `id`).
   - Else: `start = 0`.
4. **Window:** `visible = tasks.slice(start, start + budget)`.
5. **Overflow indicator:** `+N more` where `N = tasks.length - visible.length`
   (counts tasks hidden *above* and *below* the window alike). Unchanged marker/header
   rendering.

## 4. Edge cases

- `budget = 0` (`maxLines = 1`): header only, `+N more` dropped — unchanged.
- Pin task near the end of the list: few or no tasks below it; `+N more` counts the rest.
- Multiple completed tasks: the latest completion wins the pin.
- Only completed task already within the natural top window: it still becomes line 1 of
  the widget (per the approved rule); tasks after it follow.

## 5. Testing (`test/widget.test.ts`)

- Replace the status-sorted assertion (currently `○ #3 C`, `▸ #1 A`, `✓ #2 B`) with an
  insertion-order assertion: `▸ #1 A`, `✓ #2 B`, `○ #3 C`.
- New overflow cases:
  - Overflow with no completed tasks → window starts at the top (`#1 …`).
  - Overflow with one completed task → pin at top, successors follow, `+N more` counts
    hidden-above + hidden-below.
  - Overflow with two completed tasks of different `updatedAt` → the later one is pinned.
  - Overflow with completed tasks sharing `updatedAt: 0` → higher `id` wins (deterministic).
- Existing header, `+N more`, `maxLines=1`, and `TodoWidget` lifecycle tests stay green.