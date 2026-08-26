// src/store.ts — pure persistence: load, atomic save, apply+save. No pi imports.

import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { applyOp, type Task, type TodoOp, type TodoResult, type TodoState } from "./core.js";

interface TodoFile {
  version: number;
  nextId: number;
  tasks: Task[];
}

/** Session-bounded storage: the todo file lives beside the session file. */
export function sessionTodoPath(sessionFile: string): string {
  if (sessionFile.endsWith(".jsonl")) return sessionFile.replace(/\.jsonl$/, ".todo.json");
  return `${sessionFile}.todo.json`; // defensive: never write over a non-session file
}

function empty(): TodoState {
  return { tasks: [], nextId: 1 };
}

/** Load a session's todos: undefined file (ephemeral session) → empty, in-memory. */
export function loadSessionState(file: string | undefined): TodoState {
  return file === undefined ? empty() : loadState(file);
}

function normalizeStatus(s: unknown): Task["status"] {
  if (s === "pending" || s === "in_progress" || s === "completed") return s;
  return "pending";
}

export function loadState(path: string): TodoState {
  if (!existsSync(path)) return empty();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<TodoFile>;
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.tasks)) return empty();
    const tasks: Task[] = [];
    let maxId = 0;
    for (const t of raw.tasks) {
      if (!t || typeof t !== "object" || typeof t.id !== "number" || typeof t.text !== "string") continue;
      tasks.push({
        id: t.id,
        text: t.text,
        status: normalizeStatus(t.status),
        createdAt: typeof t.createdAt === "number" ? t.createdAt : 0,
        updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : 0,
      });
      if (t.id > maxId) maxId = t.id;
    }
    const nextId = typeof raw.nextId === "number" && raw.nextId > maxId ? raw.nextId : maxId + 1;
    return { tasks, nextId };
  } catch (e) {
    console.warn(`pi-todo: could not read ${path}, starting empty (${(e as Error).message})`);
    return empty();
  }
}

function saveState(path: string, state: TodoState): void {
  mkdirSync(dirname(path), { recursive: true });
  const data: TodoFile = { version: 1, nextId: state.nextId, tasks: state.tasks };
  const tmp = `${path}.tmp-${randomUUID()}`;
  const fd = openSync(tmp, "wx", 0o666);
  try {
    writeFileSync(fd, JSON.stringify(data, null, 2), "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore cleanup failure */
    }
    throw e;
  }
}

export function applyAndSave(
  path: string | undefined,
  current: TodoState,
  op: TodoOp,
  params: { text?: string; id?: number },
): TodoResult {
  const result = applyOp(current, op, params);
  // "list" is read-only — skip rewriting identical bytes (tmp+fsync+rename).
  // An undefined path means an ephemeral session — apply in memory, never write.
  if (!result.error && op !== "list" && path !== undefined) saveState(path, result.state);
  return result;
}

/** Copy one session's todo file to another (fork inheritance). No-op when the
 *  source is missing or has no tasks (nothing worth inheriting). */
export function copyState(from: string, to: string): void {
  const state = loadState(from);
  if (state.tasks.length === 0) return;
  saveState(to, state);
}

/** Fork inheritance: copy the previous session's todos to the new session's
 *  file unless the destination already has one (never overwrite). */
export function inheritOnFork(previousSessionFile: string | undefined, destSessionFile: string): void {
  if (previousSessionFile === undefined) return;
  const dest = sessionTodoPath(destSessionFile);
  if (existsSync(dest)) return;
  copyState(sessionTodoPath(previousSessionFile), dest);
}