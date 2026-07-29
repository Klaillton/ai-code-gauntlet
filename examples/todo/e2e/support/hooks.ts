import { After, Before, setDefaultTimeout } from "@cucumber/cucumber";
import type { GauntletWorld } from "./world.js";

setDefaultTimeout(30_000);

Before(async function (this: GauntletWorld) {
  await this.init();
});

After(async function (this: GauntletWorld) {
  await this.dispose();
});
