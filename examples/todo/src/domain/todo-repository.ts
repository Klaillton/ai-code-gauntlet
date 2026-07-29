import type { Todo } from "./todo.js";

export interface TodoRepository {
  list(): Todo[];
  getById(id: string): Todo | undefined;
  save(todo: Todo): Todo;
  clear(): void;
}

export class InMemoryTodoRepository implements TodoRepository {
  private readonly todos = new Map<string, Todo>();

  list(): Todo[] {
    return [...this.todos.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getById(id: string): Todo | undefined {
    return this.todos.get(id);
  }

  save(todo: Todo): Todo {
    this.todos.set(todo.id, todo);
    return todo;
  }

  clear(): void {
    this.todos.clear();
  }
}
