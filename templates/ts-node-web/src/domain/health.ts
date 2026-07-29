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
