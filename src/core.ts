// src/core.ts — pure domain logic: types, reducer. No pi imports.

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface Task {
  id: number;
  text: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
}

export interface TodoState {
  tasks: Task[];
  nextId: number;
}

export const EMPTY_STATE: TodoState = { tasks: [], nextId: 1 };

export type TodoOp = "add" | "start" | "done" | "list" | "clear";

export interface TodoResult {
  state: TodoState;
  content: string;
  error?: string;
}

function ok(state: TodoState, content: string): TodoResult {
  return { state, content };
}

function err(state: TodoState, content: string): TodoResult {
  return { state, content: "", error: content };
}

function now(): number {
  return Date.now();
}

export function applyOp(
  current: TodoState,
  op: TodoOp,
  params: { text?: string; id?: number },
): TodoResult {
  switch (op) {
    case "add": {
      const text = (params.text ?? "").trim();
      if (!text) return err(current, "text is required for add");
      const task: Task = {
        id: current.nextId,
        text,
        status: "pending",
        createdAt: now(),
        updatedAt: now(),
      };
      return ok(
        { tasks: [...current.tasks, task], nextId: current.nextId + 1 },
        `Added #${task.id}: ${text}`,
      );
    }

    case "start": {
      if (params.id === undefined) return err(current, "id is required for start");
      if (!current.tasks.some((t) => t.id === params.id)) {
        return err(current, `no task with id ${params.id}`);
      }
      const ts = now();
      const tasks = current.tasks.map((t) =>
        t.id === params.id
          ? { ...t, status: "in_progress" as TaskStatus, updatedAt: ts }
          : t.status === "in_progress"
            ? { ...t, status: "pending" as TaskStatus }
            : t,
      );
      return ok({ tasks, nextId: current.nextId }, `Started #${params.id}`);
    }

    case "done": {
      if (params.id === undefined) return err(current, "id is required for done");
      if (!current.tasks.some((t) => t.id === params.id)) {
        return err(current, `no task with id ${params.id}`);
      }
      const ts = now();
      const tasks = current.tasks.map((t) =>
        t.id === params.id
          ? { ...t, status: "completed" as TaskStatus, updatedAt: ts }
          : t,
      );
      return ok({ tasks, nextId: current.nextId }, `Completed #${params.id}`);
    }

    case "list":
      return ok(current, formatList(current.tasks));

    case "clear":
      return ok(
        { tasks: [], nextId: 1 },
        `Cleared ${current.tasks.length} task${current.tasks.length === 1 ? "" : "s"}`,
      );

    default:
      return err(current, `unknown op: ${op}`);
  }
}

export const MARKER_PENDING = "\u25CB"; // ○
export const MARKER_ACTIVE = "\u25B8";  // ▸
export const MARKER_DONE = "\u2713";    // ✓

export function markerFor(status: TaskStatus): string {
  if (status === "completed") return MARKER_DONE;
  if (status === "in_progress") return MARKER_ACTIVE;
  return MARKER_PENDING;
}

export function formatTaskLine(t: Task): string {
  return `${markerFor(t.status)} #${t.id} ${t.text}`;
}

export function formatList(tasks: Task[]): string {
  if (tasks.length === 0) return "No todos.";
  return tasks.map(formatTaskLine).join("\n");
}
