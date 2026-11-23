# Changelog

All notable changes to `com.acme.obs:obs-instrumentation-spring-boot-starter`
are documented here, in the format of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), generated from
[Conventional Commits](https://www.conventionalcommits.org/) (see
[../../README.md](../../README.md#changelog-konvansiyonu)).

## [Unreleased]

## [1.0.0] - 2026-09-17

### Added

- `[contract v1.0.0]` `ObsHttpMetricsFilter` (auto-registered):
  `http_server_requests_total`, `http_server_request_errors_total`,
  `http_server_request_duration_seconds`, `http_server_active_requests`.
- `[contract v1.0.0]` `ObsWorkerMetrics` bean: `worker_jobs_processed_total`,
  `worker_job_duration_seconds`, `worker_queue_depth`.
- `obs.instrumentation.error-threshold` and `obs.instrumentation.buckets`
  configuration properties.
- Meters register into whatever `MeterRegistry` Spring Boot Actuator
  already configured, so Prometheus scraping, OTLP push and trace
  exemplars all come from Actuator's own auto-configuration with zero
  extra code in this starter.
