export type ComponentId = "web" | "api";

export type SampleResult = "up" | "down";
export type PublicComponentStatus = "operational" | "outage" | "unknown";
export type FailureCode =
  | "timeout"
  | "dns"
  | "tls"
  | "network"
  | "http_status"
  | "body_mismatch";

export type CheckSample = {
  component: ComponentId;
  scheduledAt: string;
  checkedAt: string;
  result: SampleResult;
  latencyMs: number;
  httpStatus: number | null;
  failureCode: FailureCode | null;
};

export type ComponentState = {
  component: ComponentId;
  status: PublicComponentStatus;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
};

export type AggregateInput = {
  upSamples: number;
  downSamples: number;
  expectedSamples: number;
};

export type UptimeResult = {
  observedSamples: number;
  uptimePercent: number | null;
  coveragePercent: number;
};

export type ExpectedSlotInput = {
  day: string;
  monitoringStartedAt: string;
  now: Date;
};
