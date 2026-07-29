import { describe, expect, it } from "vitest";
import { createHealthStatus } from "../../src/domain/health.js";

describe("createHealthStatus", () => {
  it("shouldReturnOkWhenCalled", () => {
    const health = createHealthStatus("demo");
    expect(health.status).toBe("ok");
    expect(health.service).toBe("demo");
    expect(health.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
