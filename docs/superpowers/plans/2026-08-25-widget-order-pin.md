# Widget Ordering & Overflow Pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render widget tasks in insertion order (no movement on `start`/`done`) and pin the most recently completed task to the top line when the list overflows.

**Architecture:** Pure render change in `src/widget.ts` — replace the status sort with an id sort, and compute the visible window start from the most recently completed task when `tasks.length > budget`. No changes to `core.ts`, `store.ts`, `index.ts`, or the tool schema.

**Tech Stack:** TypeScript, vitest. Test runner: `npm test` (vitest run) / `npx vitest run test/widget.test.ts`. Typecheck: `npm run typecheck`. Repo: `~/pi-todo` (branch: current).

**Spec:** `docs/superpowers/specs/2026-08-25-widget-order-pin-design.md`

---

### Task 1: Insertion-order rendering

**Files:**
- Modify: `test/widget.test.ts:25-53` (the `colorizes markers and header per spec` test)
- Modify: `src/widget.ts:28-50` (`renderWidgetLines`, `STATUS_ORDER`, `byStatusThenId`)

- [ ] **Step 1: Update the render-order assertion to insertion order**

In `test/widget.test.ts`, replace the `colorizes markers and header per spec` test body so the expected lines follow insertion order (`#1`, `#2`, `#3`) instead of status order:

```ts
  it("colorizes markers and header per spec", () => {
    const state: TodoState = {
      tasks: [task(1, "A", "in_progress"), task(2, "B", "completed"), task(3, "C", "pending")],
      nextId: 4,
    };
    const lines = renderWidgetLines(state, fakeTheme);
    expect(lines).toEqual([
      "<accent>Todos 1/3  (1 in progress)</accent>",
      "<accent>▸</accent> #1 A",
      "<dim>✓</dim> #2 B",
      "○ #3 C",
    ]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/widget.test.ts`
Expected: FAIL — the `colorizes markers...` case produces status-sorted lines (`○ #3 C` first), not insertion order.

- [ ] **Step 3: Replace the status sort with an id sort**

In `src/widget.ts`, edit `renderWidgetLines` to sort by id only, and delete the status-ordering helpers:

```ts
  // replace the two lines:
  //   const sorted = [...state.tasks].sort(byStatusThenId);
  //   const visible = sorted.slice(0, budget);
  // with:
  const ordered = [...state.tasks].sort((a, b) => a.id - b.id);
  const visible = ordered.slice(0, budget);
```

Then delete `STATUS_ORDER` and `byStatusThenId` (the block at the bottom of the file):

```ts
const STATUS_ORDER: Record<Task["status"], number> = { pending: 0, in_progress: 1, completed: 2 };

function byStatusThenId(a: Task, b: Task): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.id - b.id;
}
```

Note: `Task` is still imported and used elsewhere in the file (markers/types), keep the import.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/widget.test.ts`
Expected: PASS (all existing cases still green — the overflow and `maxLines=1` cases use all-pending tasks, so id order changes nothing for them).

- [ ] **Step 5: Commit**

```bash
cd ~/pi-todo
git add src/widget.ts test/widget.test.ts
git commit -m "feat: render widget tasks in insertion order"
```

---

### Task 2: Overflow pin to most recently completed task

**Files:**
- Modify: `test/widget.test.ts:25-62` (add pin tests under the `renderWidgetLines` describe block)
- Modify: `src/widget.ts:28-50` (`renderWidgetLines` + new `startIndex` helper)

- [ ] **Step 1: Write the failing overflow-pin tests**

Append these tests inside the `describe("renderWidgetLines", ...)` block in `test/widget.test.ts` (after the existing `stays within one line when maxLines=1` test):

```ts
  it("pins the most recently completed task to the top on overflow", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[3] = { ...tasks[3]!, status: "completed", updatedAt: 100 }; // #4 completed
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, WIDGET_MAX_LINES);
    expect(lines.length).toBe(10);
    expect(lines[1]).toBe("✓ #4 t4");
    expect(lines[2]).toBe("○ #5 t5");
    expect(lines[9]).toBe("+4 more"); // #1-#3 hidden above pin, #12 hidden below
  });

  it("pins the latest of several completions by updatedAt", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[2] = { ...tasks[2]!, status: "completed", updatedAt: 100 };  // #3
    tasks[7] = { ...tasks[7]!, status: "completed", updatedAt: 200 };  // #8 — more recent
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, WIDGET_MAX_LINES);
    expect(lines[1]).toBe("✓ #8 t8");
  });

  it("breaks updatedAt ties by higher id", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[2] = { ...tasks[2]!, status: "completed" }; // #3, updatedAt 0
    tasks[7] = { ...tasks[7]!, status: "completed" }; // #8, updatedAt 0
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, WIDGET_MAX_LINES);
    expect(lines[1]).toBe("✓ #8 t8");
  });

  it("counts hidden-above-pin tasks in +N more when the pin sits near the end", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[10] = { ...tasks[10]!, status: "completed", updatedAt: 100 }; // #11
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, WIDGET_MAX_LINES);
    expect(lines).toEqual([
      "Todos 1/12",
      "✓ #11 t11",
      "○ #12 t12",
      "+10 more",
    ]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/widget.test.ts`
Expected: FAIL — the four new cases: with no pin logic, `lines[1]` is `○ #1 t1` (top-of-list window) and the `near the end` case shows `○ #1..#8` lines instead of the expected 4-line output.

- [ ] **Step 3: Implement the pin via a `startIndex` helper**

In `src/widget.ts`, replace the window computation in `renderWidgetLines`:

```ts
  // replace the two lines:
  //   const ordered = [...state.tasks].sort((a, b) => a.id - b.id);
  //   const visible = ordered.slice(0, budget);
  // with:
  const ordered = [...state.tasks].sort((a, b) => a.id - b.id);
  const start = startIndex(ordered, budget);
  const visible = ordered.slice(start, start + budget);
```

And add this helper above `renderWidgetLines` (or below it, after the marker helpers):

```ts
// Index of the window's first line: 0, or — when the list overflows — the index of the
// most recently completed task (max updatedAt, tie-broken by higher id, since ids are
// assigned in completion order). Returns 0 when nothing is completed or nothing overflows.
function startIndex(ordered: Task[], budget: number): number {
  if (ordered.length <= budget) return 0;
  let pin = -1;
  for (let i = 0; i < ordered.length; i++) {
    const t = ordered[i]!;
    if (t.status !== "completed") continue;
    const p = pin === -1 ? undefined : ordered[pin];
    if (p === undefined || t.updatedAt > p.updatedAt || (t.updatedAt === p.updatedAt && t.id > p.id)) {
      pin = i;
    }
  }
  return pin === -1 ? 0 : pin;
}
```

- [ ] **Step 4: Run the full suite to verify everything passes**

Run: `npx vitest run` then `npm run typecheck`
Expected: ALL PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd ~/pi-todo
git add src/widget.ts test/widget.test.ts
git commit -m "feat: pin most recently completed task to widget top on overflow"
```

---

### Task 3: Verify against spec (final check)

**Files:** none (verification only)

- [ ] **Step 1: Re-read the spec and confirm coverage**

Read `docs/superpowers/specs/2026-08-25-widget-order-pin-design.md` and confirm:

- §3.1 insertion-order rendering → Task 1
- §3.3 overflow pin (max `updatedAt`, tie-break higher id; no-completed → top) → Task 2
- §3.5 `+N more` counts hidden above + below → Task 2 (`pins the most recently...` and `near the end` cases)
- §5 updated insertion-order assertion + new overflow cases → Tasks 1–2
- No changes to `core.ts`/`store.ts`/`index.ts` → confirmed via grep in Task 1/2 diff (`git diff --stat` shows only `src/widget.ts` and `test/widget.test.ts`)

- [ ] **Step 2: Final full run**

Run: `npm test` and `npm run typecheck`
Expected: ALL PASS, typecheck clean. Working tree clean after the Task 2 commit (`git status --short` empty).