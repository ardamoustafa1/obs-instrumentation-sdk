# Metric naming contract v1.0.0

This is the versioned source of truth README.md's "Metric naming contract"
table summarizes in prose. Every language's test suite asserts against
these exact strings (see each package's `naming_test.*`).

```yaml
contract: 1.0.0
metrics:
  http_server_requests_total:
    type: counter
    unit: "1"
    labels: [method, route, code]
  http_server_request_errors_total:
    type: counter
    unit: "1"
    labels: [method, route, code]
    note: "subset predicate configurable; default code >= 500"
  http_server_request_duration_seconds:
    type: histogram
    unit: s
    labels: [method, route]
    default_buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  http_server_active_requests:
    type: gauge
    unit: "1"
    labels: [method]
  worker_jobs_processed_total:
    type: counter
    unit: "1"
    labels: [queue, status]
    status_values: [success, failure]
  worker_job_duration_seconds:
    type: histogram
    unit: s
    labels: [queue]
    default_buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  worker_queue_depth:
    type: gauge
    unit: "1"
    labels: [queue]
```

Bump rules: adding an optional label or a new metric family is MINOR;
renaming/removing a metric or a label, or changing a unit, is MAJOR and
requires all three language packages to release a matching MAJOR within one
minor-release window (see root README's versioning policy).
