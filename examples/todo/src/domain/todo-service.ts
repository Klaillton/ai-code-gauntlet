import { completeTodo, createTodo, type CreateTodoInput, type Todo } from "./todo.js";
import type { TodoRepository } from "./todo-repository.js";

export class TodoNotFoundError extends Error {
  constructor(id: string) {
    super(`Todo not found: ${id}`);
    this.name = "TodoNotFoundError";
  }
}

export class TodoService {
  constructor(private readonly repository: TodoRepository) {}

  listTodos(): Todo[] {
    return this.repository.list();
  }

  createTodo(input: CreateTodoInput): Todo {
    const todo = createTodo(input);
    return this.repository.save(todo);
  }

  completeTodo(id: string): Todo {
    const existing = this.repository.getById(id);
    if (!existing) {
      throw new TodoNotFoundError(id);
    }
    const completed = completeTodo(existing);
    return this.repository.save(completed);
  }

  reset(): void {
    this.repository.clear();
  }
}
