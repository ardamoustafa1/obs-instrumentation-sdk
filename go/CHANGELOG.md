# Changelog

All notable changes to `github.com/acme/obs-instrumentation-sdk/go` are
documented here, in the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
generated from [Conventional Commits](https://www.conventionalcommits.org/)
(see [../README.md](../README.md#changelog-konvansiyonu)).

## [Unreleased]

## [1.0.0] - 2026-09-17

### Added

- `[contract v1.0.0]` `httpmetrics.Middleware`: `http_server_requests_total`,
  `http_server_request_errors_total`, `http_server_request_duration_seconds`,
  `http_server_active_requests`.
- `[contract v1.0.0]` `worker.Metrics`: `worker_jobs_processed_total`,
  `worker_job_duration_seconds`, `worker_queue_depth`.
- `metrics.Registry`: shared OpenTelemetry MeterProvider, Prometheus
  `/metrics` handler, optional OTLP push, automatic trace exemplars.
