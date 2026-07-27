export function renderHomePage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Todo Gauntlet</title>
    <style>
      :root { font-family: system-ui, sans-serif; color: #0f172a; background: #f8fafc; }
      body { max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
      h1 { font-size: 1.5rem; }
      form { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
      input, button { font: inherit; padding: 0.5rem 0.75rem; }
      input { flex: 1; }
      ul { list-style: none; padding: 0; }
      li { display: flex; justify-content: space-between; gap: 1rem; padding: 0.5rem 0; border-bottom: 1px solid #e2e8f0; }
      li.completed span { text-decoration: line-through; color: #64748b; }
      .error { color: #b91c1c; min-height: 1.25rem; }
      .status { color: #475569; font-size: 0.875rem; }
    </style>
  </head>
  <body>
    <h1>Todo Gauntlet</h1>
    <p class="status" data-testid="health-status">Loading…</p>
    <form id="todo-form" data-testid="todo-form">
      <input id="todo-title" data-testid="todo-title" name="title" placeholder="What needs doing?" autocomplete="off" />
      <button type="submit" data-testid="add-todo">Add</button>
    </form>
    <p id="error" class="error" data-testid="error" role="alert"></p>
    <ul id="todo-list" data-testid="todo-list"></ul>
    <script>
      const list = document.getElementById("todo-list");
      const form = document.getElementById("todo-form");
      const titleInput = document.getElementById("todo-title");
      const errorEl = document.getElementById("error");
      const healthEl = document.querySelector('[data-testid="health-status"]');

      async function refreshHealth() {
        const res = await fetch("/health");
        const data = await res.json();
        healthEl.textContent = "Service: " + data.status;
      }

      function renderTodos(items) {
        list.innerHTML = "";
        for (const todo of items) {
          const li = document.createElement("li");
          li.dataset.testid = "todo-item";
          li.dataset.id = todo.id;
          if (todo.completed) li.classList.add("completed");
          const span = document.createElement("span");
          span.textContent = todo.title;
          span.dataset.testid = "todo-title-text";
          li.appendChild(span);
          if (!todo.completed) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = "Complete";
            btn.dataset.testid = "complete-todo";
            btn.addEventListener("click", async () => {
              await fetch("/api/todos/" + todo.id + "/complete", { method: "POST" });
              await loadTodos();
            });
            li.appendChild(btn);
          }
          list.appendChild(li);
        }
      }

      async function loadTodos() {
        const res = await fetch("/api/todos");
        const data = await res.json();
        renderTodos(data.items || []);
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorEl.textContent = "";
        const title = titleInput.value;
        const res = await fetch("/api/todos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          errorEl.textContent = data.error || "Could not create todo";
          return;
        }
        titleInput.value = "";
        await loadTodos();
      });

      refreshHealth();
      loadTodos();
    </script>
  </body>
</html>`;
}
