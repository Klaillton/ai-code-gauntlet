import { Hono } from "hono";
import { TodoValidationError } from "../domain/todo.js";
import { InMemoryTodoRepository } from "../domain/todo-repository.js";
import { TodoNotFoundError, TodoService } from "../domain/todo-service.js";
import { renderHomePage } from "../web/home-page.js";

export type AppEnv = {
  Variables: {
    todoService: TodoService;
  };
};

export function createApp(service = new TodoService(new InMemoryTodoRepository())): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("todoService", service);
    await next();
  });

  app.get("/", (c) => c.html(renderHomePage()));

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "ai-code-gauntlet",
      timestamp: new Date().toISOString(),
    }),
  );

  app.get("/api/todos", (c) => {
    const todos = c.get("todoService").listTodos();
    return c.json({ items: todos });
  });

  app.post("/api/todos", async (c) => {
    try {
      const body = (await c.req.json()) as { title?: unknown };
      if (typeof body.title !== "string") {
        return c.json({ error: "Title is required" }, 400);
      }
      const todo = c.get("todoService").createTodo({ title: body.title });
      return c.json(todo, 201);
    } catch (error) {
      if (error instanceof TodoValidationError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  app.post("/api/todos/:id/complete", (c) => {
    try {
      const todo = c.get("todoService").completeTodo(c.req.param("id"));
      return c.json(todo);
    } catch (error) {
      if (error instanceof TodoNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  /** Test-only reset endpoint used by E2E setup. Disabled unless GAUNTLET_E2E=1. */
  app.post("/api/test/reset", (c) => {
    if (process.env.GAUNTLET_E2E !== "1") {
      return c.json({ error: "Not available" }, 404);
    }
    c.get("todoService").reset();
    return c.json({ reset: true });
  });

  return app;
}
