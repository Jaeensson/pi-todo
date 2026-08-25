// src/widget.ts — widget controller: fixed aboveEditor anchor, toggle, bounded ASCII-safe render.
// Depends on pi only through narrow structural interfaces (TodoUI/TodoTheme/WidgetHandle).

import { markerFor, type Task, type TodoState } from "./core.js";

export interface TodoUI {
  setWidget(key: string, content: unknown, options?: { placement: "aboveEditor" | "belowEditor" }): void;
}

export interface TodoTheme {
  fg(color: string, text: string): string;
}

export interface WidgetHandle {
  requestRender?(): void;
}

export const WIDGET_KEY = "pi-todo";
export const WIDGET_MAX_LINES = 10;

function colorMarker(t: Task, theme: TodoTheme): string {
  const marker = markerFor(t.status);
  if (t.status === "in_progress") return theme.fg("accent", marker);
  if (t.status === "completed") return theme.fg("dim", marker);
  return marker;
}

export function renderWidgetLines(state: TodoState, theme: TodoTheme, maxLines: number = WIDGET_MAX_LINES): string[] {
  const done = state.tasks.filter((t) => t.status === "completed").length;
  const active = state.tasks.filter((t) => t.status === "in_progress").length;
  const headerText = `Todos ${done}/${state.tasks.length}` + (active > 0 ? `  (${active} in progress)` : "");
  const header = theme.fg(active > 0 ? "accent" : "dim", headerText);

  const lines: string[] = [header];
  // Reserve one line for the header and one for the "+N more" overflow indicator so the
  // whole widget stays within maxLines (bounded render); N counts tasks not shown.
  const budget = Math.max(0, maxLines - 2);
  const ordered = [...state.tasks].sort((a, b) => a.id - b.id);
  const visible = ordered.slice(0, budget);
  const hidden = ordered.length - visible.length;
  for (const t of visible) lines.push(`${colorMarker(t, theme)} #${t.id} ${t.text}`);
  if (hidden > 0 && lines.length < maxLines) lines.push(`+${hidden} more`);
  return lines;
}

interface RegisteredComponent {
  render(): string[];
  invalidate(): void;
}

export class TodoWidget {
  private visible = true;
  private ui: TodoUI | undefined;
  private registered = false;
  private tui: WidgetHandle | undefined;
  private state: TodoState = { tasks: [], nextId: 1 };

  attach(ui: TodoUI): void {
    if (ui !== this.ui) {
      this.ui = ui;
      this.registered = false;
      this.tui = undefined;
    }
  }

  setState(state: TodoState): void {
    this.state = state;
    this.refresh();
  }

  setVisible(visible: boolean): void {
    if (visible !== this.visible) {
      this.visible = visible;
      this.refresh();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  refresh(): void {
    if (!this.ui) return;
    if (!this.visible || this.state.tasks.length === 0) {
      if (this.registered) {
        this.ui.setWidget(WIDGET_KEY, undefined);
        this.registered = false;
        this.tui = undefined;
      }
      return;
    }
    if (!this.registered) {
      this.ui.setWidget(
        WIDGET_KEY,
        (handle: WidgetHandle, theme: TodoTheme): RegisteredComponent => {
          this.tui = handle;
          return {
            render: () => renderWidgetLines(this.state, theme),
            invalidate: () => {
              this.registered = false;
              this.tui = undefined;
            },
          };
        },
        { placement: "aboveEditor" },
      );
      this.registered = true;
    } else {
      this.tui?.requestRender?.();
    }
  }

  dispose(): void {
    if (this.ui) this.ui.setWidget(WIDGET_KEY, undefined);
    this.registered = false;
    this.tui = undefined;
  }
}