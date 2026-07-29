export type Todo = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
};

export type CreateTodoInput = {
  title: string;
};

export class TodoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodoValidationError";
  }
}

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

export function validateCreateTodoInput(input: CreateTodoInput): string {
  const title = normalizeTitle(input.title);
  if (title.length === 0) {
    throw new TodoValidationError("Title is required");
  }
  if (title.length > 120) {
    throw new TodoValidationError("Title must be at most 120 characters");
  }
  return title;
}

export function createTodo(
  input: CreateTodoInput,
  idFactory: () => string = () => crypto.randomUUID(),
): Todo {
  const title = validateCreateTodoInput(input);
  return {
    id: idFactory(),
    title,
    completed: false,
    createdAt: new Date().toISOString(),
  };
}

export function completeTodo(todo: Todo): Todo {
  return { ...todo, completed: true };
}
