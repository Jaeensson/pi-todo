/**
 * pi-todo — a human-facing, per-session todo tracker for the pi coding agent.
 *
 * - `todo` tool: add | start | done | list | clear (persists per session, beside
 *   the session file under ~/.pi/agent/sessions; ephemeral sessions stay in memory)
 * - `/todos`: toggle the widget · `/todos clear`: clear with confirmation
 * - Anchored aboveEditor widget (ASCII-safe markers: ○ ▸ ✓)
 *
 * Superpowers compliance: the Superpowers pi extension maps "create a todo /
 * mark complete" to "an installed todo/task tool if available" — this tool is
 * that hook; Superpowers plan/checklist workflows drive it via add/start/done.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { markerFor, type TodoOp, type TodoResult, type TodoState } from "./src/core.js";
import { applyAndSave, inheritOnFork, loadSessionState, sessionTodoPath } from "./src/store.js";
import { TodoWidget, type TodoTheme, type TodoUI } from "./src/widget.js";

/** Extract the plain text of a result's first content part (text-part array or bare string). */
function firstResultText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as Record<string, unknown>;
      if (p.type === "text" && typeof p.text === "string") return p.text;
    }
  }
  return undefined;
}

/** Storage path for the current session, or undefined when the session is
 *  ephemeral (no session file) — todos then stay in memory. */
function sessionStorePath(ctx: ExtensionContext): string | undefined {
  const file = ctx.sessionManager.getSessionFile();
  return file === undefined ? undefined : sessionTodoPath(file);
}

let widget: TodoWidget | undefined;

export default function (pi: ExtensionAPI): void {
  // ---- tool ---------------------------------------------------------------

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description:
      "Manage the persistent per-session todo list. Each pi session has its own " +
      "list, stored beside the session file; resuming a session restores its todos " +
      "and other sessions are unaffected. Ops: add (new task, requires text), start " +
      "(mark in_progress — only one task is in_progress at a time), done (mark " +
      "completed), list (show all), clear (delete all). " +
      "Use for multi-step work: create one todo per step or plan task, start before " +
      "beginning work, done immediately when finished.",
    promptSnippet: "Track multi-step work in a todo list",
    promptGuidelines: [
      "Create one todo per item when the user or a plan lists tasks, checklists, or multi-step work.",
      "Call start on a task before beginning it and done immediately when it is finished — never batch completions.",
      "Use list to review what remains on long-running work.",
    ],
    parameters: Type.Object({
      op: StringEnum(["add", "start", "done", "list", "clear"] as const, {
        description: "Operation to perform",
      }),
      text: Type.Optional(Type.String({ description: "Task text (required for add)" })),
      id: Type.Optional(Type.Number({ description: "Task id (required for start and done)" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = params as { op: TodoOp; text?: string; id?: number };
      const path = sessionStorePath(ctx);
      const r: TodoResult = applyAndSave(path, loadSessionState(path), p.op, { text: p.text, id: p.id });
      widget?.setState(r.state);
      // pi derives isError only from thrown exceptions — validation failures throw.
      if (r.error) throw new Error(r.error);
      return {
        content: [{ type: "text", text: r.content }],
        details: { op: p.op, params: { text: p.text, id: p.id }, state: r.state },
      };
    },

    renderCall(args: { op?: string; text?: string; id?: number }, theme: TodoTheme) {
      if ((args as { op?: string }).op === "add") {
        return new Text(`${theme.fg("toolTitle", "todo")} + ${args.text ?? ""}`, 0, 0);
      }
      const target = args.id !== undefined ? ` #${args.id}` : "";
      return new Text(`${theme.fg("toolTitle", "todo")} ${(args as { op?: string }).op ?? "?"}${target}`, 0, 0);
    },

    renderResult(result: { details?: unknown; content?: unknown }, _opts: unknown, theme: TodoTheme) {
      // When the todo tool throws (validation failure), pi synthesizes the result with
      // details:{} and no state — fall back to the result text so the error stays visible.
      const details = result.details as { op?: TodoOp; state?: TodoState; params?: { id?: number } } | undefined;
      const state = details?.state;
      if (!state) {
        const firstText = firstResultText(result.content);
        if (firstText) return new Text(theme.fg("error", firstText), 0, 0);
        return new Text(theme.fg("muted", "todo"), 0, 0);
      }
      const tasks = state.tasks;
      let line: string | undefined;
      if (details?.op === "add" && tasks.length > 0) {
        line = `${markerFor(tasks[tasks.length - 1]!.status)} #${tasks[tasks.length - 1]!.id} ${tasks[tasks.length - 1]!.text}`;
      } else if (details?.op === "start" || details?.op === "done") {
        const t = tasks.find((x) => x.id === details?.params?.id);
        if (t) line = `${markerFor(t.status)} #${t.id} ${t.text}`;
      }
      if (!line) return new Text(theme.fg("muted", "ok"), 0, 0);
      return new Text(line, 0, 0);
    },
  });

  // ---- commands -----------------------------------------------------------

  pi.registerCommand("todos", {
    description: "Toggle todo widget visibility (or: /todos clear)",
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (arg === "clear") {
        const ok = await ctx.ui.confirm("Clear all todos?", "Removes every task from this session");
        if (!ok) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }
        const path = sessionStorePath(ctx);
        const r = applyAndSave(path, loadSessionState(path), "clear", {});
        widget?.setState(r.state);
        ctx.ui.notify(r.content, "info");
        return;
      }
      if (!widget) return;
      const next = !widget.isVisible();
      widget.setVisible(next);
      ctx.ui.notify(next ? "Todo list visible" : "Todo list hidden", "info");
    },
  });

  // ---- events -------------------------------------------------------------

  pi.on("session_start", async (event, ctx: ExtensionContext) => {
    const file = ctx.sessionManager.getSessionFile();
    // Fork/clone mint a new session id — inherit the source session's todos
    // (only when the destination has none yet; never overwrite).
    if (event.reason === "fork" && file !== undefined) {
      inheritOnFork(event.previousSessionFile, file);
    }
    const path = file === undefined ? undefined : sessionTodoPath(file);
    const state = loadSessionState(path);
    if (ctx.hasUI) {
      widget ??= new TodoWidget();
      widget.attach(ctx.ui as unknown as TodoUI);
      widget.setState(state);
    }
  });

  pi.on("turn_end", async () => {
    widget?.refresh();
  });

  pi.on("session_shutdown", async () => {
    widget?.dispose();
    widget = undefined;
  });
}
