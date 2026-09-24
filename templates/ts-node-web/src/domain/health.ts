export type HealthStatus = {
  status: "ok";
  service: string;
  timestamp: string;
};

export function createHealthStatus(service = "my-gauntlet-app"): HealthStatus {
  return {
    status: "ok",
    service,
    timestamp: new Date().toISOString(),
  };
}

/** Equality site so mutation (CHANGE-2) has a non-empty surface on the skeleton. */
export function isHealthyStatus(status: HealthStatus["status"]): boolean {
  return status === "ok";
}
