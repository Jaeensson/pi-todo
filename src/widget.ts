// src/widget.ts — widget controller: fixed aboveEditor anchor, toggle, bounded ASCII-safe render.
// Depends on pi only through narrow structural interfaces (TodoUI/TodoTheme/WidgetHandle).

import { truncateToWidth } from "@earendil-works/pi-tui";
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

// Index of the window's first line: 0, or — when the list overflows — the index of the
// most recently completed task (max updatedAt, tie-broken by higher id, i.e. the
// later-created task). Returns 0 when nothing is completed or nothing overflows.
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

export function renderWidgetLines(state: TodoState, theme: TodoTheme, width: number, maxLines: number = WIDGET_MAX_LINES): string[] {
  const done = state.tasks.filter((t) => t.status === "completed").length;
  const active = state.tasks.filter((t) => t.status === "in_progress").length;
  const headerText = `Todos ${done}/${state.tasks.length}` + (active > 0 ? `  (${active} in progress)` : "");
  const header = theme.fg(active > 0 ? "accent" : "dim", headerText);

  const lines: string[] = [header];
  // Bounded render: header + up to two overflow indicator lines + tasks. The top
  // indicator ("↑ N more") is shown when the pin hides tasks above the window; the
  // bottom one ("↓ N more") when tasks remain below it. The top line is only
  // reserved when the pin actually engages, so lists that overflow below keep the
  // full task budget of maxLines - 2.
  const ordered = [...state.tasks].sort((a, b) => a.id - b.id);
  const overflow = ordered.length > Math.max(0, maxLines - 2);
  const start = overflow ? startIndex(ordered, Math.max(0, maxLines - 3)) : 0;
  const budget = Math.max(0, maxLines - (start > 0 ? 3 : 2));
  const visible = ordered.slice(start, start + budget);
  const above = ordered.slice(0, start).filter((t) => t.status !== "completed").length; // uncompleted tasks hidden before the window
  const below = ordered.slice(start + visible.length).filter((t) => t.status !== "completed").length; // uncompleted tasks remaining after the window
  if (above > 0 && lines.length < maxLines) lines.push(`↑ ${above} more`);
  for (const t of visible) lines.push(`${colorMarker(t, theme)} #${t.id} ${t.text}`);
  if (below > 0 && lines.length < maxLines) lines.push(`↓ ${below} more`);
  // pi-tui validates that every rendered line fits the viewport and throws otherwise
  // (crashing pi), so clip each line to the terminal width it was rendered for.
  // truncateToWidth is ANSI-aware and appends "..." when it clips.
  return lines.map((line) => truncateToWidth(line, Math.max(1, width)));
}

interface RegisteredComponent {
  render(width: number): string[];
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
            render: (width: number) => renderWidgetLines(this.state, theme, width),
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