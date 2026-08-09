import type {
  ComponentId,
  FailureCode,
  SampleResult,
} from "../src/status/types";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  STATUS_INGEST_SECRET: string;
};

export type IngestPayload = {
  version: 1;
  scheduledAt: string;
  sentAt: string;
  checks: Array<{
    component: ComponentId;
    checkedAt: string;
    result: SampleResult;
    latencyMs: number;
    httpStatus: number | null;
    failureCode: FailureCode | null;
  }>;
};
