import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { GauntletWorld } from "../support/world.js";

Given("the system has no todos", async function (this: GauntletWorld) {
  const response = await this.api.post("/api/test/reset");
  assert.equal(response.status(), 200);
});

Given("a todo titled {string} exists", async function (this: GauntletWorld, title: string) {
  const response = await this.api.post("/api/todos", {
    data: { title },
  });
  assert.equal(response.status(), 201);
});

When("I open the todo board", async function (this: GauntletWorld) {
  await this.page.goto("/");
  await this.page.getByTestId("todo-form").waitFor();
});

When("I add a todo titled {string}", async function (this: GauntletWorld, title: string) {
  await this.page.getByTestId("todo-title").fill(title);
  await this.page.getByTestId("add-todo").click();
});

When("I complete the todo titled {string}", async function (this: GauntletWorld, title: string) {
  const item = this.page.locator('[data-testid="todo-item"]', {
    has: this.page.getByTestId("todo-title-text").filter({ hasText: title }),
  });
  await item.getByTestId("complete-todo").click();
});

When(
  "I create a todo via the API with title {string}",
  async function (this: GauntletWorld, title: string) {
    const response = await this.api.post("/api/todos", {
      data: { title },
    });
    this.lastApiResponse = {
      status: response.status(),
      body: await response.json(),
    };
  },
);

Then("I should see a todo titled {string}", async function (this: GauntletWorld, title: string) {
  await this.page.getByTestId("todo-title-text").filter({ hasText: title }).waitFor();
});

Then("the todo {string} is not completed", async function (this: GauntletWorld, title: string) {
  const item = this.page.locator('[data-testid="todo-item"]', {
    has: this.page.getByTestId("todo-title-text").filter({ hasText: title }),
  });
  await assert.doesNotReject(async () => {
    const className = (await item.getAttribute("class")) ?? "";
    assert.equal(className.includes("completed"), false);
  });
});

Then("the todo {string} is completed", async function (this: GauntletWorld, title: string) {
  const item = this.page.locator('[data-testid="todo-item"].completed', {
    has: this.page.getByTestId("todo-title-text").filter({ hasText: title }),
  });
  await item.waitFor();
});

Then("the API responds with status {int}", function (this: GauntletWorld, status: number) {
  assert.equal(this.lastApiResponse?.status, status);
});

Then("the API error message is {string}", function (this: GauntletWorld, message: string) {
  const body = this.lastApiResponse?.body as { error?: string };
  assert.equal(body.error, message);
});

Then("the API todo title is {string}", function (this: GauntletWorld, title: string) {
  const body = this.lastApiResponse?.body as { title?: string };
  assert.equal(body.title, title);
});

Then("the API todo is not completed", function (this: GauntletWorld) {
  const body = this.lastApiResponse?.body as { completed?: boolean };
  assert.equal(body.completed, false);
});
