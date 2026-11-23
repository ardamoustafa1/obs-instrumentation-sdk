import type { RequestHandler } from 'express';
import type { FastifyPluginAsync } from 'fastify';
import type { ViewOptions } from '@opentelemetry/sdk-metrics';
import type { Meter } from '@opentelemetry/api';

export interface RegistryConfig {
  /** OTLP/gRPC endpoint to additionally push metrics to, e.g. "otel-collector:4317". */
  otlpEndpoint?: string;
  /** Push interval in milliseconds. Default 15000. */
  otlpIntervalMillis?: number;
  /** Extra Views beyond this package's built-in histogram bucket views. */
  views?: ViewOptions[];
}

export declare class Registry {
  meter(instrumentationName: string): Meter;
  readonly metricsHandler: (req: import('http').IncomingMessage, res: import('http').ServerResponse) => void;
  shutdown(): Promise<void>;
}

export declare function createRegistry(config?: RegistryConfig): Registry;

/** Standard 5ms-10s histogram buckets. See CONTRACT.md. */
export declare const DEFAULT_BUCKETS: number[];

export interface HttpMetricsOptions {
  /** Minimum status code counted into http_server_request_errors_total. Default 500. */
  errorThreshold?: number;
}

export declare class HttpMetrics {
  constructor(registry: Registry, options?: HttpMetricsOptions);
  recordRequest(sample: { method: string; route: string; statusCode: number; durationSeconds: number }): void;
  express(): RequestHandler;
  fastify(): FastifyPluginAsync;
}

export declare class Job {
  finish(success: boolean): void;
}

export declare class WorkerMetrics {
  constructor(registry: Registry);
  startJob(queue: string): Job;
  setQueueDepth(queue: string, depth: number): void;
}
