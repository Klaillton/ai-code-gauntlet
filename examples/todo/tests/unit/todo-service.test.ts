import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTodoRepository } from "../../src/domain/todo-repository.js";
import { TodoNotFoundError, TodoService } from "../../src/domain/todo-service.js";

describe("TodoService", () => {
  let service: TodoService;

  beforeEach(() => {
    service = new TodoService(new InMemoryTodoRepository());
  });

  it("shouldListTodosInCreationOrder", () => {
    service.createTodo({ title: "A" });
    service.createTodo({ title: "B" });
    expect(service.listTodos().map((t) => t.title)).toEqual(["A", "B"]);
  });

  it("shouldCompleteExistingTodo", () => {
    const created = service.createTodo({ title: "Done soon" });
    const completed = service.completeTodo(created.id);
    expect(completed.completed).toBe(true);
    expect(service.listTodos()[0]?.completed).toBe(true);
  });

  it("shouldThrowWhenCompletingUnknownTodo", () => {
    expect(() => service.completeTodo("missing")).toThrow(TodoNotFoundError);
  });

  it("shouldClearAllTodosWhenReset", () => {
    service.createTodo({ title: "temp" });
    service.reset();
    expect(service.listTodos()).toEqual([]);
  });
});
