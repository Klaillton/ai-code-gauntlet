export function renderHomePage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Gauntlet App</title>
    <style>
      :root { font-family: system-ui, sans-serif; color: #0f172a; background: #f8fafc; }
      body { max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
      h1 { font-size: 1.5rem; }
      .status { color: #475569; font-size: 0.875rem; }
    </style>
  </head>
  <body>
    <h1>Gauntlet App</h1>
    <p class="status" data-testid="health-status">Loading…</p>
    <p>Replace this skeleton with your domain. Specs live in <code>features/</code>.</p>
    <script>
      const healthEl = document.querySelector('[data-testid="health-status"]');
      fetch("/health")
        .then((res) => res.json())
        .then((data) => {
          healthEl.textContent = "Service: " + data.status;
        })
        .catch(() => {
          healthEl.textContent = "Service: error";
        });
    </script>
  </body>
</html>`;
}
