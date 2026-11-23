# obs-instrumentation-sdk (Go)

```bash
go get github.com/acme/obs-instrumentation-sdk/go
```

Golden-signal HTTP middleware + worker instrumentation for Go services,
exporting the exact metric families in [../CONTRACT.md](../CONTRACT.md).
Built on the OpenTelemetry Go metrics API; `/metrics` is served through the
official `go.opentelemetry.io/otel/exporters/prometheus` bridge so the same
instruments can also push over OTLP and automatically carry trace exemplars
-- see "Exemplars" and "OTLP push" below.

## Quickstart (10 minutes)

```go
reg, err := metrics.New(metrics.Config{})
if err != nil {
    log.Fatal(err)
}
mw := httpmetrics.New(reg, httpmetrics.Config{})

mux := http.NewServeMux()
mux.HandleFunc("GET /hello/{name}", helloHandler)
mux.Handle("GET /metrics", reg.Handler())

http.ListenAndServe(":8080", mw.Handler(mux))
```

Full runnable version: [quickstart/main.go](quickstart/main.go).

```bash
go run ./quickstart
curl localhost:8080/hello/arda
curl localhost:8080/metrics
```

Docker (build context is this directory, not `quickstart/`, since the image
needs the sibling `metrics`/`httpmetrics`/`worker` packages too):

```bash
docker build -f quickstart/Dockerfile -t obs-instrumentation-go-quickstart .
docker run -p 8080:8080 obs-instrumentation-go-quickstart
```

## Route labels and cardinality

`httpmetrics.Config.RouteExtractor` defaults to reading Go 1.22+
`http.ServeMux`'s `r.Pattern` (populated when you register routes as
`mux.HandleFunc("GET /users/{id}", ...)`). Using any other router, plug its
route-template accessor in:

```go
// chi
httpmetrics.Config{RouteExtractor: func(r *http.Request) string {
    return chi.RouteContext(r.Context()).RoutePattern()
}}

// gin (call from inside a gin.HandlerFunc wrapping this middleware, since
// gin doesn't populate its route until routing has run)
```

Never label with the raw request path -- see [../README.md](../README.md#metric-naming-contract)'s
cardinality rule.

## Worker/queue metrics

```go
workerMetrics := worker.New(reg)

job := workerMetrics.StartJob(ctx, "invoices")
err := process(ctx, msg)
job.Finish(err == nil)

// wherever you already poll queue depth:
workerMetrics.SetQueueDepth(ctx, "invoices", float64(depth))
```

## Exemplars

Nothing to configure. Any `context.Context` carrying a sampled
OpenTelemetry span when you call `mw.Handler`'s wrapped handler, or
`job.Finish`, gets that span's trace ID attached as a Prometheus exemplar on
the corresponding histogram bucket -- automatically, via the OpenTelemetry
SDK's default exemplar reservoir. Wire up tracing however you already do
(e.g. `go.opentelemetry.io/otel/sdk/trace` + an OTLP trace exporter) and
exemplars start appearing with zero changes to this SDK's call sites.
Exemplars only appear when the scraper requests OpenMetrics format
(`Accept: application/openmetrics-text`); classic Prometheus text format
never carries them, by protocol design.

## OTLP push

```go
reg, err := metrics.New(metrics.Config{
    OTLPEndpoint: "otel-collector.obs-system.svc:4317",
    OTLPInsecure: true, // in-cluster collector, no TLS
})
```

The exact same instruments now also push to the collector every 15s
(`metrics.Config.OTLPInterval` to change that), in addition to being
scrapeable at `/metrics`. This is dormant infrastructure for a future
Tempo/trace pipeline correlating metrics and traces through the same OTLP
collector -- no code changes needed when that lands, just set
`OTLPEndpoint`.

## Testing your own naming

If your service adds custom metrics alongside this SDK's, borrow
[../go/conformance/naming_test.go](conformance/naming_test.go)'s pattern:
scrape `reg.Handler()` with `httptest`, assert on `# TYPE <name> <type>`
lines. It is exactly what obs-manifest-schema's CI checks for the metric
names you'll later put in your `observability.yaml`.
