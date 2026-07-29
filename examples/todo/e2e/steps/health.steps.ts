import { Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { GauntletWorld } from "../support/world.js";

When("I request the service health", async function (this: GauntletWorld) {
  const response = await this.api.get("/health");
  this.lastApiResponse = {
    status: response.status(),
    body: await response.json(),
  };
});

Then("the health status is {string}", function (this: GauntletWorld, expected: string) {
  assert.equal(this.lastApiResponse?.status, 200);
  const body = this.lastApiResponse?.body as { status?: string };
  assert.equal(body.status, expected);
});
