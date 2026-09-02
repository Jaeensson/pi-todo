import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { EMPTY_STATE, type Task, type TodoState } from "../src/core.js";
import { TodoWidget, renderWidgetLines, WIDGET_KEY, WIDGET_MAX_LINES, type TodoTheme, type TodoUI, type WidgetHandle } from "../src/widget.js";

function task(id: number, text: string, status: Task["status"]): Task {
  return { id, text, status, createdAt: 0, updatedAt: 0 };
}

const fakeTheme: TodoTheme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
};

const EMPTY_THEME = { fg: (c: string, s: string) => s };

function recordingUI(): TodoUI & { calls: Array<[string, unknown, unknown?]> } {
  const calls: Array<[string, unknown, unknown?]> = [];
  return {
    calls,
    setWidget(key, content, options) {
      calls.push(options === undefined ? [key, content] : [key, content, options]);
    },
  };
}

describe("renderWidgetLines", () => {
  it("colorizes markers and header per spec", () => {
    const state: TodoState = {
      tasks: [task(1, "A", "in_progress"), task(2, "B", "completed"), task(3, "C", "pending")],
      nextId: 4,
    };
    const lines = renderWidgetLines(state, fakeTheme, 100);
    expect(lines).toEqual([
      "<accent>Todos 1/3  (1 in progress)</accent>",
      "<accent>▸</accent> #1 A",
      "<dim>✓</dim> #2 B",
      "○ #3 C",
    ]);
  });

  it("honors maxLines and reports below-overflow with ↓ N more", () => {
    const state: TodoState = {
      tasks: Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending")),
      nextId: 13,
    };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, WIDGET_MAX_LINES);
    expect(lines.length).toBe(10);
    expect(lines[1]).toBe("○ #1 t1");
    expect(lines[8]).toBe("○ #8 t8");
    expect(lines[9]).toBe("↓ 4 more");
  });

  it("stays within one line when maxLines=1 (drops +N more)", () => {
    const state: TodoState = {
      tasks: [task(1, "A", "pending")],
      nextId: 2,
    };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, 1);
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe("Todos 0/1");
  });

  it("pins the most recently completed task even when it falls inside the natural window", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[3] = { ...tasks[3]!, status: "completed", updatedAt: 100 }; // #4 completed
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, WIDGET_MAX_LINES);
    expect(lines.length).toBe(10);
    expect(lines[1]).toBe("↑ 3 more"); // #1-#3 hidden above the window
    expect(lines[2]).toBe("✓ #4 t4");
    expect(lines[3]).toBe("○ #5 t5");
    expect(lines[9]).toBe("↓ 2 more"); // #11-#12 remain below the window
  });

  it("pins the latest of several completions by updatedAt", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[2] = { ...tasks[2]!, status: "completed", updatedAt: 100 };  // #3
    tasks[7] = { ...tasks[7]!, status: "completed", updatedAt: 200 };  // #8 — more recent
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, WIDGET_MAX_LINES);
    expect(lines[1]).toBe("↑ 6 more"); // #1-#7 hidden above the window; #3 is completed and excluded
    expect(lines[2]).toBe("✓ #8 t8");
  });

  it("breaks updatedAt ties by higher id", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[2] = { ...tasks[2]!, status: "completed" }; // #3, updatedAt 0
    tasks[7] = { ...tasks[7]!, status: "completed" }; // #8, updatedAt 0
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, WIDGET_MAX_LINES);
    expect(lines[1]).toBe("↑ 6 more"); // #1-#7 hidden above the window; #3 is completed and excluded
    expect(lines[2]).toBe("✓ #8 t8");
  });

  it("excludes completed tasks hidden above the pin from ↑ N more", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[2] = { ...tasks[2]!, status: "completed", updatedAt: 100 };  // #3 — completed, hidden above the pin
    tasks[7] = { ...tasks[7]!, status: "completed", updatedAt: 200 };  // #8 — more recent, pins the window
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, WIDGET_MAX_LINES);
    expect(lines[1]).toBe("↑ 6 more"); // #1-#7 hidden above the window; #3 is completed and excluded
    expect(lines[2]).toBe("✓ #8 t8");
  });

  it("excludes completed tasks hidden below the window from ↓ N more", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[2] = { ...tasks[2]!, status: "completed", updatedAt: 200 };  // #3 — more recent, pins the window
    tasks[10] = { ...tasks[10]!, status: "completed", updatedAt: 100 }; // #11 — hidden below the window
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, WIDGET_MAX_LINES);
    expect(lines[1]).toBe("↑ 2 more"); // #1-#2 hidden above the window, both pending
    expect(lines[2]).toBe("✓ #3 t3");
    expect(lines[9]).toBe("↓ 2 more"); // #10 and #12 remain below; #11 is completed and excluded
  });

  it("omits the top label when every hidden-above task is completed", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[0] = { ...tasks[0]!, status: "completed", updatedAt: 100 }; // #1 — the only task hidden above
    tasks[1] = { ...tasks[1]!, status: "completed", updatedAt: 200 }; // #2 — more recent, pins the window
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, WIDGET_MAX_LINES);
    expect(lines[1]).toBe("✓ #2 t2"); // no "↑ 0 more" label above it
    expect(lines.some((l) => l.startsWith("↑ "))).toBe(false);
    expect(lines[lines.length - 1]).toBe("↓ 4 more"); // #9-#12 remain below, all pending
  });

  it("omits the bottom label when every remaining-below task is completed", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[2] = { ...tasks[2]!, status: "completed", updatedAt: 200 }; // #3 — more recent, pins the window
    tasks[9] = { ...tasks[9]!, status: "completed", updatedAt: 100 }; // #10 — the only task hidden below
    const state: TodoState = { tasks, nextId: 11 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, WIDGET_MAX_LINES);
    expect(lines[1]).toBe("↑ 2 more"); // #1-#2 hidden above the window, both pending
    expect(lines[lines.length - 1]).toBe("○ #9 t9"); // no "↓ 0 more" label below it
    expect(lines.some((l) => l.startsWith("↓ "))).toBe(false);
  });

  it("labels hidden-above and remaining-below counts when the pin sits mid-list", () => {
    const tasks = Array.from({ length: 15 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[2] = { ...tasks[2]!, status: "completed", updatedAt: 100 }; // #3 — window pins here
    const state: TodoState = { tasks, nextId: 16 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, WIDGET_MAX_LINES);
    expect(lines[1]).toBe("↑ 2 more"); // #1-#2 hidden above the window
    expect(lines[2]).toBe("✓ #3 t3");
    expect(lines[9]).toBe("↓ 6 more"); // #10-#15 remain below the window
  });

  it("shows only the top label when nothing remains below the window", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[10] = { ...tasks[10]!, status: "completed", updatedAt: 100 }; // #11
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, WIDGET_MAX_LINES);
    expect(lines).toEqual([
      "Todos 1/12",
      "↑ 10 more",
      "✓ #11 t11",
      "○ #12 t12",
    ]);
  });

  it("stays bounded at maxLines=2 when pinned (top label only, no task rows)", () => {
    const tasks = Array.from({ length: 5 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[2] = { ...tasks[2]!, status: "completed", updatedAt: 100 }; // #3
    const state: TodoState = { tasks, nextId: 6 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, 2);
    expect(lines).toEqual([
      "Todos 1/5",
      "↑ 2 more",
    ]);
  });

  it("shows only the bottom label at maxLines=2 when unpinned (no task rows)", () => {
    const state: TodoState = {
      tasks: Array.from({ length: 5 }, (_, i) => task(i + 1, `t${i + 1}`, "pending")),
      nextId: 6,
    };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, 2);
    expect(lines).toEqual([
      "Todos 0/5",
      "↓ 5 more",
    ]);
  });

  it("shows both labels with no task rows at maxLines=3 when pinned", () => {
    const tasks = Array.from({ length: 5 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[3] = { ...tasks[3]!, status: "completed", updatedAt: 100 }; // #4
    const state: TodoState = { tasks, nextId: 6 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100, 3);
    expect(lines).toEqual([
      "Todos 1/5",
      "↑ 3 more",
      "↓ 1 more", // #4 is completed and excluded from the below count
    ]);
  });
});

describe("renderWidgetLines width truncation", () => {
  const longText =
    "Research Swedish seed retailers (discovery + automation surfaces: platform, sitemaps, JSON feeds, EAN availability)";

  it("truncates task lines exceeding the terminal width (regression: pi crash at narrow terminals)", () => {
    const state: TodoState = { tasks: [task(1, longText, "pending")], nextId: 2 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 60);
    expect(lines.length).toBe(2);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(60);
    expect(lines[1]!.startsWith("○ #1 ")).toBe(true);
    expect(stripTerminalSequences(lines[1]!).endsWith("...")).toBe(true);
  });

  it("truncates ANSI-styled lines by visible width, not byte length", () => {
    const ansiTheme: TodoTheme = { fg: (_color, s) => `\x1B[32m${s}\x1B[39m` };
    const state: TodoState = { tasks: [task(1, longText, "in_progress")], nextId: 2 };
    const lines = renderWidgetLines(state, ansiTheme, 50);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(50);
    expect(lines[1]).toContain("#1");
  });

  it("truncates the header when the width is tiny", () => {
    const state: TodoState = {
      tasks: [task(1, "A", "in_progress"), task(2, "B", "pending")],
      nextId: 3,
    };
    const lines = renderWidgetLines(state, EMPTY_THEME, 5);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(5);
    expect(stripTerminalSequences(lines[0]!)).toBe("To...");
  });

  it("leaves lines that fit untouched", () => {
    const state: TodoState = { tasks: [task(1, "A", "pending")], nextId: 2 };
    const lines = renderWidgetLines(state, EMPTY_THEME, 100);
    expect(lines[1]).toBe("○ #1 A");
  });

  it("forwards the terminal width from the registered component's render", () => {
    const ui = recordingUI();
    const w = new TodoWidget();
    w.attach(ui);
    w.setState({ tasks: [task(1, longText, "pending")], nextId: 2 });
    const factory = ui.calls[0]?.[1] as (handle: WidgetHandle, theme: TodoTheme) => {
      render(width: number): string[];
    };
    const component = factory({ requestRender: () => {} }, EMPTY_THEME);
    for (const line of component.render(30)) expect(visibleWidth(line)).toBeLessThanOrEqual(30);
    for (const line of component.render(200)) expect(visibleWidth(line)).toBeLessThanOrEqual(200);
  });
});

describe("TodoWidget", () => {
  it("registers once and re-renders via requestRender", () => {
    const ui = recordingUI();
    const w = new TodoWidget();
    w.attach(ui);
    w.setState({ tasks: [task(1, "A", "pending")], nextId: 2 });

    expect(ui.calls).toHaveLength(1);
    expect(ui.calls[0]?.[0]).toBe(WIDGET_KEY);
    let renderedCount = 0;
    const handle: WidgetHandle = { requestRender: () => { renderedCount++; } };
    const factory = ui.calls[0]?.[1] as (handle: WidgetHandle, theme: TodoTheme) => { render(width: number): string[] };
    const component = factory(handle, EMPTY_THEME);
    expect(component.render(100)[0]).toBe("Todos 0/1");

    w.setState({ tasks: [task(1, "A", "completed")], nextId: 2 });
    expect(renderedCount).toBe(1);
  });

  it("hides when empty", () => {
    const ui = recordingUI();
    const w = new TodoWidget();
    w.attach(ui);
    w.setState({ tasks: [task(1, "A", "pending")], nextId: 2 });
    w.setState(EMPTY_STATE);
    expect(ui.calls[ui.calls.length - 1]).toEqual([WIDGET_KEY, undefined]);
  });

  it("hides when toggled off, shows again when toggled on", () => {
    const ui = recordingUI();
    const w = new TodoWidget();
    w.attach(ui);
    w.setState({ tasks: [task(1, "A", "pending")], nextId: 2 });
    expect(w.isVisible()).toBe(true);

    w.setVisible(false);
    expect(w.isVisible()).toBe(false);
    expect(ui.calls[ui.calls.length - 1]).toEqual([WIDGET_KEY, undefined]);

    w.setVisible(true);
    expect(w.isVisible()).toBe(true);
    expect(ui.calls[ui.calls.length - 1]?.[0]).toBe(WIDGET_KEY);
    expect(ui.calls[ui.calls.length - 1]?.[1]).not.toBeUndefined();
  });

  it("re-registers when a new UI context is attached", () => {
    const ui1 = recordingUI();
    const ui2 = recordingUI();
    const w = new TodoWidget();
    w.attach(ui1);
    w.setState({ tasks: [task(1, "A", "pending")], nextId: 2 });
    expect(ui1.calls).toHaveLength(1);

    w.attach(ui2);
    w.refresh();
    expect(ui2.calls).toHaveLength(1); // re-registered under the fresh context
  });

  it("dispose unregisters the widget", () => {
    const ui = recordingUI();
    const w = new TodoWidget();
    w.attach(ui);
    w.setState({ tasks: [task(1, "A", "pending")], nextId: 2 });
    w.dispose();
    expect(ui.calls[ui.calls.length - 1]).toEqual([WIDGET_KEY, undefined]);
  });
});