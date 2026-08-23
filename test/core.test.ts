import { describe, expect, it } from "vitest";
import { applyOp, EMPTY_STATE } from "../src/core.js";
import { formatList, formatTaskLine, MARKER_PENDING, MARKER_ACTIVE, MARKER_DONE, markerFor, type Task } from "../src/core.js";
import { visibleWidth } from "@earendil-works/pi-tui";

describe("applyOp", () => {
  it("add creates a pending task and increments nextId", () => {
    const r = applyOp(EMPTY_STATE, "add", { text: "Refactor auth" });
    expect(r.error).toBeUndefined();
    expect(r.state.tasks).toEqual([
      { id: 1, text: "Refactor auth", status: "pending", createdAt: expect.any(Number), updatedAt: expect.any(Number) },
    ]);
    expect(r.state.nextId).toBe(2);
    expect(r.content).toBe("Added #1: Refactor auth");
  });

  it("add rejects blank text and leaves state unchanged", () => {
    const r = applyOp(EMPTY_STATE, "add", { text: "   " });
    expect(r.error).toBe("text is required for add");
    expect(r.state).toEqual(EMPTY_STATE);
  });

  it("start sets in_progress and pauses any other in_progress task", () => {
    const added = applyOp(EMPTY_STATE, "add", { text: "A" });
    const added2 = applyOp(added.state, "add", { text: "B" });
    const started = applyOp(added2.state, "start", { id: 1 });
    expect(started.state.tasks.find((t) => t.id === 1)?.status).toBe("in_progress");
    const started2 = applyOp(started.state, "start", { id: 2 });
    expect(started2.state.tasks.find((t) => t.id === 2)?.status).toBe("in_progress");
    expect(started2.state.tasks.find((t) => t.id === 1)?.status).toBe("pending");
  });

  it("start on unknown id errors", () => {
    const r = applyOp(EMPTY_STATE, "start", { id: 42 });
    expect(r.error).toBe("no task with id 42");
    expect(r.state).toEqual(EMPTY_STATE);
  });

  it("done sets completed", () => {
    const added = applyOp(EMPTY_STATE, "add", { text: "A" });
    const r = applyOp(added.state, "done", { id: 1 });
    expect(r.state.tasks[0]?.status).toBe("completed");
    expect(r.content).toBe("Completed #1");
  });

  it("done on unknown id errors", () => {
    const r = applyOp(EMPTY_STATE, "done", { id: 42 });
    expect(r.error).toBe("no task with id 42");
  });

  it("missing id for start/done errors", () => {
    expect(applyOp(EMPTY_STATE, "start", {}).error).toBe("id is required for start");
    expect(applyOp(EMPTY_STATE, "done", {}).error).toBe("id is required for done");
  });

  it("clear empties the list and resets nextId", () => {
    const added = applyOp(EMPTY_STATE, "add", { text: "A" });
    const r = applyOp(added.state, "clear", {});
    expect(r.state).toEqual(EMPTY_STATE);
    expect(r.content).toBe("Cleared 1 task");
  });
});

function task(id: number, text: string, status: Task["status"]): Task {
  return { id, text, status, createdAt: 0, updatedAt: 0 };
}

describe("markers and formatting", () => {
  it("markerFor maps each status", () => {
    expect(markerFor("pending")).toBe(MARKER_PENDING);
    expect(markerFor("in_progress")).toBe(MARKER_ACTIVE);
    expect(markerFor("completed")).toBe(MARKER_DONE);
  });

  it("markers are exactly the three spec'd code points", () => {
    expect(MARKER_PENDING).toBe("\u25CB");
    expect(MARKER_ACTIVE).toBe("\u25B8");
    expect(MARKER_DONE).toBe("\u2713");
  });

  it("each marker occupies exactly one terminal column", () => {
    expect(visibleWidth(MARKER_PENDING)).toBe(1);
    expect(visibleWidth(MARKER_ACTIVE)).toBe(1);
    expect(visibleWidth(MARKER_DONE)).toBe(1);
  });

  it("formatTaskLine renders marker + id + text", () => {
    expect(formatTaskLine(task(2, "Wire up token refresh", "in_progress"))).toBe("▸ #2 Wire up token refresh");
  });

  it("formatList joins lines and handles empty", () => {
    expect(formatList([])).toBe("No todos.");
    const tasks = [task(1, "A", "pending"), task(2, "B", "completed")];
    expect(formatList(tasks)).toBe("○ #1 A\n✓ #2 B");
  });

  it("all rendered strings are printable ASCII plus the marker set", () => {
    const ALLOWED = new Set([MARKER_PENDING, MARKER_ACTIVE, MARKER_DONE]);
    const tasks = [
      task(1, "A", "pending"),
      task(2, "B", "in_progress"),
      task(3, "C", "completed"),
    ];
    const outputs = [formatList(tasks), formatTaskLine(task(1, "A", "pending"))].join("\n");
    for (const ch of outputs) {
      if (ALLOWED.has(ch)) continue;
      if (ch === "\n") continue;
      expect(ch.charCodeAt(0)).toBeGreaterThanOrEqual(0x20);
      expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0x7e);
    }
  });
});
