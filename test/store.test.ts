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

  it("sessionTodoPath never returns its input (defensive .jsonl fallback)", () => {
    expect(sessionTodoPath(join(dir, "weird.JSONL"))).toBe(join(dir, "weird.JSONL.todo.json"));
    expect(sessionTodoPath(join(dir, "noext"))).toBe(join(dir, "noext.todo.json"));
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