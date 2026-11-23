# Changelog

All notable changes to `@acme/obs-instrumentation` are documented here, in
the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
generated from [Conventional Commits](https://www.conventionalcommits.org/)
(see [../README.md](../README.md#changelog-konvansiyonu)).

## [Unreleased]

### Known limitations

- Exemplars are not yet serialized by `@opentelemetry/exporter-prometheus`
  (upstream gap) -- see [README.md#exemplars](README.md#exemplars).

## [1.0.0] - 2026-09-17

### Added

- `[contract v1.0.0]` `HttpMetrics`: `http_server_requests_total`,
  `http_server_request_errors_total`, `http_server_request_duration_seconds`,
  `http_server_active_requests`. Express and Fastify adapters.
- `[contract v1.0.0]` `WorkerMetrics`: `worker_jobs_processed_total`,
  `worker_job_duration_seconds`, `worker_queue_depth`.
- `createRegistry()`: shared OpenTelemetry MeterProvider, same-port
  `/metrics` handler, optional OTLP push.
