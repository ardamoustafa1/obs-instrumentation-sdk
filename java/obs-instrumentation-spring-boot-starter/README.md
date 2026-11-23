# obs-instrumentation-spring-boot-starter

```xml
<dependency>
  <groupId>com.acme.obs</groupId>
  <artifactId>obs-instrumentation-spring-boot-starter</artifactId>
  <version>1.0.0</version>
</dependency>
```

Golden-signal HTTP/worker instrumentation for Spring Boot, exporting
exactly the metric families in [../../CONTRACT.md](../../CONTRACT.md).

> **Verification status**: this module was written without a local
> JDK/Maven, then actually compiled and test-run in a `maven:3.9-eclipse-temurin-17`
> container (`mvn -pl obs-instrumentation-spring-boot-starter -am test`) --
> `ContractNamingTest` passes, and the [quickstart](../quickstart) was
> built and run end to end in Docker, with `curl /actuator/prometheus`
> showing exactly the expected `http_server_requests_total`,
> `http_server_request_errors_total`, `http_server_request_duration_seconds`
> and `http_server_active_requests` series. CI should still run this on
> every change (see [pom.xml](pom.xml)'s comment on the pinned Spring
> Boot/Micrometer version for the one detail to watch before bumping past
> the 3.2.x line: the `PrometheusMeterRegistry` package moved in
> Micrometer 1.13+).

## Integration: zero lines of code

Add the dependency. That's it -- Spring Boot's auto-configuration
discovers `ObsInstrumentationAutoConfiguration` via
`META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`
and registers an `ObsHttpMetricsFilter` covering every request
automatically, plus an `ObsWorkerMetrics` bean for manual use.

```bash
curl localhost:8080/actuator/prometheus | grep http_server
```

(Requires `micrometer-registry-prometheus` and
`management.endpoints.web.exposure.include=prometheus` -- standard Spring
Boot Actuator setup, not something this starter configures for you; see
the quickstart.)

## Neden kendi `PrometheusMeterRegistry`'mizi kurmuyoruz?

This starter never constructs its own `MeterRegistry`. It `@Autowired`s
whatever Spring Boot Actuator has already configured and registers its
meters into that. This is a deliberate, load-bearing design choice:

- If the app has `micrometer-registry-prometheus` on the classpath,
  Actuator exposes `/actuator/prometheus` automatically -- this starter's
  metrics just show up there.
- If the app **also** has `micrometer-registry-otlp` and sets
  `management.otlp.metrics.export.url`, Actuator pushes the exact same
  meters over OTLP too -- via Micrometer's composite registry, with zero
  OTLP-specific code in this starter (contrast with the Go and Node SDKs
  in this repo, which each hand-roll their own OTLP push path because
  Go/Node do not have an equivalent "just add a dependency" registry
  auto-configuration layer).
- If the app has `micrometer-tracing-bridge-otel` (or `-brave`) on the
  classpath, Actuator wires a `SpanContextSupplier` into the
  `PrometheusMeterRegistry` automatically, so histogram exemplars appear
  with **zero code changes here** -- the same "wire tracing, get
  exemplars for free" property the Go SDK has, just delivered by Spring
  Boot's own auto-configuration instead of by this starter's code.

## Worker/queue metrics

```java
@Service
class InvoiceWorker {
    private final ObsWorkerMetrics metrics; // autowired, provided by this starter

    InvoiceWorker(ObsWorkerMetrics metrics) {
        this.metrics = metrics;
    }

    void process(Message message) {
        ObsJob job = metrics.startJob("invoices");
        try {
            handle(message);
            job.finish(true);
        } catch (Exception e) {
            job.finish(false);
            throw e;
        }
    }

    @Scheduled(fixedRate = 30_000)
    void reportQueueDepth() {
        metrics.setQueueDepth("invoices", queue.approximateDepth());
    }
}
```

## Configuration

```yaml
obs:
  instrumentation:
    error-threshold: 500 # minimum status code counted as an error; 400 to also count client errors
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] # seconds
```

## Route labels and cardinality

Routes come from `HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE`, the
same attribute Spring MVC's own `DispatcherServlet` sets once it resolves
a handler -- never the raw request path (see
[../../README.md](../../README.md#metric-naming-contract)'s cardinality
rule). Requests that never reach a handler (404s) get `route="unmatched"`.

## Quickstart

See [../quickstart](../quickstart) for a minimal Spring Boot application
and Dockerfile.
