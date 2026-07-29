import { setWorldConstructor, World, type IWorldOptions } from "@cucumber/cucumber";
import {
  chromium,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

export type ApiResponseSnapshot = {
  status: number;
  body: unknown;
};

export class GauntletWorld extends World {
  baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  api!: APIRequestContext;
  lastApiResponse?: ApiResponseSnapshot;

  constructor(options: IWorldOptions) {
    super(options);
  }

  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: process.env.HEADED !== "1",
    });
    this.context = await this.browser.newContext({
      baseURL: this.baseUrl,
    });
    this.page = await this.context.newPage();
    this.api = this.context.request;
  }

  async dispose(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }
}

setWorldConstructor(GauntletWorld);
