import { describe, expect, it } from "vitest";
import {
  TodoValidationError,
  completeTodo,
  createTodo,
  normalizeTitle,
  validateCreateTodoInput,
} from "../../src/domain/todo.js";

describe("normalizeTitle", () => {
  it("shouldTrimAndCollapseWhitespaceWhenTitleHasNoise", () => {
    expect(normalizeTitle("  buy   milk  ")).toBe("buy milk");
  });
});

describe("validateCreateTodoInput", () => {
  it("shouldReturnNormalizedTitleWhenValid", () => {
    expect(validateCreateTodoInput({ title: "  Ship it " })).toBe("Ship it");
  });

  it("shouldThrowWhenTitleIsEmpty", () => {
    expect(() => validateCreateTodoInput({ title: "   " })).toThrow(TodoValidationError);
  });

  it("shouldThrowWhenTitleIsTooLong", () => {
    expect(() => validateCreateTodoInput({ title: "x".repeat(121) })).toThrow(TodoValidationError);
  });
});

describe("createTodo", () => {
  it("shouldCreateIncompleteTodoWithStableId", () => {
    const todo = createTodo({ title: "Write specs" }, () => "fixed-id");
    expect(todo).toMatchObject({
      id: "fixed-id",
      title: "Write specs",
      completed: false,
    });
    expect(todo.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("completeTodo", () => {
  it("shouldMarkTodoAsCompleted", () => {
    const todo = createTodo({ title: "Review Gherkin" }, () => "t1");
    expect(completeTodo(todo).completed).toBe(true);
  });
});
