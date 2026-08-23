import { describe, expect, it } from "vitest";
import { applyOp, EMPTY_STATE } from "../src/core.js";

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