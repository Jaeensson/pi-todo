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
    const lines = renderWidgetLines(state, fakeTheme);
    expect(lines).toEqual([
      "<accent>Todos 1/3  (1 in progress)</accent>",
      "<accent>▸</accent> #1 A",
      "<dim>✓</dim> #2 B",
      "○ #3 C",
    ]);
  });

  it("honors maxLines and reports overflow with +N more", () => {
    const state: TodoState = {
      tasks: Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending")),
      nextId: 13,
    };
    const lines = renderWidgetLines(state, EMPTY_THEME, WIDGET_MAX_LINES);
    expect(lines.length).toBe(10);
    expect(lines[1]).toBe("○ #1 t1");
    expect(lines[9]).toBe("+4 more");
  });

  it("stays within one line when maxLines=1 (drops +N more)", () => {
    const state: TodoState = {
      tasks: [task(1, "A", "pending")],
      nextId: 2,
    };
    const lines = renderWidgetLines(state, EMPTY_THEME, 1);
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe("Todos 0/1");
  });

  it("pins the most recently completed task even when it falls inside the natural window", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[3] = { ...tasks[3]!, status: "completed", updatedAt: 100 }; // #4 completed
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, WIDGET_MAX_LINES);
    expect(lines.length).toBe(10);
    expect(lines[1]).toBe("✓ #4 t4");
    expect(lines[2]).toBe("○ #5 t5");
    expect(lines[9]).toBe("+4 more"); // #1-#3 hidden above pin, #12 hidden below
  });

  it("pins the latest of several completions by updatedAt", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[2] = { ...tasks[2]!, status: "completed", updatedAt: 100 };  // #3
    tasks[7] = { ...tasks[7]!, status: "completed", updatedAt: 200 };  // #8 — more recent
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, WIDGET_MAX_LINES);
    expect(lines[1]).toBe("✓ #8 t8");
  });

  it("breaks updatedAt ties by higher id", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[2] = { ...tasks[2]!, status: "completed" }; // #3, updatedAt 0
    tasks[7] = { ...tasks[7]!, status: "completed" }; // #8, updatedAt 0
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, WIDGET_MAX_LINES);
    expect(lines[1]).toBe("✓ #8 t8");
  });

  it("counts hidden-above-pin tasks in +N more when the pin sits near the end", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(i + 1, `t${i + 1}`, "pending"));
    tasks[10] = { ...tasks[10]!, status: "completed", updatedAt: 100 }; // #11
    const state: TodoState = { tasks, nextId: 13 };
    const lines = renderWidgetLines(state, EMPTY_THEME, WIDGET_MAX_LINES);
    expect(lines).toEqual([
      "Todos 1/12",
      "✓ #11 t11",
      "○ #12 t12",
      "+10 more",
    ]);
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
    const factory = ui.calls[0]?.[1] as (handle: WidgetHandle, theme: TodoTheme) => { render(): string[] };
    const component = factory(handle, EMPTY_THEME);
    expect(component.render()[0]).toBe("Todos 0/1");

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