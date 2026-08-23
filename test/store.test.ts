import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_STATE } from "../src/core.js";
import { applyAndSave, loadState, storePathFor } from "../src/store.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-todo-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("store", () => {
  it("storePathFor is <cwd>/.pi/todo.json", () => {
    expect(storePathFor("/proj")).toBe(join("/proj", ".pi", "todo.json"));
  });

  it("loadState on missing file returns empty state", () => {
    expect(loadState(join(dir, "nope.json"))).toEqual(EMPTY_STATE);
  });

  it("applyAndSave persists and loadState round-trips", () => {
    const path = storePathFor(dir);
    const r = applyAndSave(path, EMPTY_STATE, "add", { text: "A" });
    expect(r.error).toBeUndefined();
    const loaded = loadState(path);
    expect(loaded.tasks).toEqual(r.state.tasks);
    expect(loaded.nextId).toBe(r.state.nextId);
  });

  it("applyAndSave does not write on error", () => {
    const path = storePathFor(dir);
    const r = applyAndSave(path, EMPTY_STATE, "done", { id: 42 });
    expect(r.error).toBe("no task with id 42");
    // No file should exist because nothing valid was written.
    expect(() => readFileSync(path, "utf8")).toThrow();
  });

  it("loadState tolerates corrupt JSON with a warning, not a throw", () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, "{ not json !!!", "utf8");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(loadState(path)).toEqual(EMPTY_STATE);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("loadState tolerates invalid shapes (tasks not an array)", () => {
    const path = join(dir, "shape.json");
    writeFileSync(path, JSON.stringify({ version: 1, tasks: "nope" }), "utf8");
    expect(loadState(path)).toEqual(EMPTY_STATE);
  });

  it("loadState skips malformed records but keeps valid ones", () => {
    const path = join(dir, "mixed.json");
    writeFileSync(
      path,
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
    const loaded = loadState(path);
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]?.text).toBe("good");
  });

  it("every save is atomic — no temp files remain", () => {
    const path = storePathFor(dir);
    for (let i = 0; i < 5; i++) applyAndSave(path, EMPTY_STATE, "add", { text: `t${i}` });
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });
});