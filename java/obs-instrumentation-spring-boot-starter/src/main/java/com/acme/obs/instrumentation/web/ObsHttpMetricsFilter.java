package com.acme.obs.instrumentation.web;

import com.acme.obs.instrumentation.ObsInstrumentationProperties;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Tags;
import io.micrometer.core.instrument.Timer;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

/**
 * Servlet filter exporting the HTTP golden signals defined in
 * ../../../../../../../../CONTRACT.md:
 *
 * <pre>
 *   http_server_requests_total{method,route,code}
 *   http_server_request_errors_total{method,route,code}
 *   http_server_request_duration_seconds{method,route}
 *   http_server_active_requests{method}
 * </pre>
 *
 * <p>Registered automatically by {@code ObsInstrumentationAutoConfiguration}
 * -- adding this starter as a dependency is the entire integration; no
 * application code is required.
 *
 * <p>Route labels come from {@link HandlerMapping#BEST_MATCHING_PATTERN_ATTRIBUTE},
 * which Spring MVC's {@code DispatcherServlet} sets once it has resolved a
 * handler. Because this filter reads the attribute <em>after</em> {@code
 * filterChain.doFilter(...)} returns (i.e. after the whole request,
 * including dispatch, has completed), the attribute is reliably present --
 * this mirrors how Spring's own {@code ServerHttpObservationFilter} reads
 * it. A request that never reaches a handler (e.g. a 404) leaves the
 * attribute unset, which this filter maps to {@code route="unmatched"}
 * rather than a raw, unbounded-cardinality path (see CONTRACT.md's
 * cardinality rule).
 */
public class ObsHttpMetricsFilter extends OncePerRequestFilter {

    private final MeterRegistry registry;
    private final int errorThreshold;
    private final ConcurrentMap<String, AtomicInteger> activeRequestsByMethod = new ConcurrentHashMap<>();
    private final Duration[] buckets;

    public ObsHttpMetricsFilter(MeterRegistry registry, ObsInstrumentationProperties properties) {
        this.registry = registry;
        this.errorThreshold = properties.getErrorThreshold();
        this.buckets = properties.bucketDurations();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String method = request.getMethod();
        AtomicInteger activeRequests = activeRequestsByMethod.computeIfAbsent(method, this::registerActiveRequestsGauge);
        activeRequests.incrementAndGet();
        long startNanos = System.nanoTime();
        try {
            filterChain.doFilter(request, response);
        } finally {
            activeRequests.decrementAndGet();
            long elapsedNanos = System.nanoTime() - startNanos;

            String route = resolveRoute(request);
            String code = String.valueOf(response.getStatus());
            Tags tags = Tags.of("method", method, "route", route, "code", code);

            // Counter.builder(...).register(registry) is an idempotent
            // lookup-or-create keyed by (name, tags) in Micrometer, not a
            // fresh registration on every call -- cheap enough to do per
            // request without our own instrument cache.

            Counter.builder("http.server.requests")
                    .tags(tags)
                    .description("Total number of HTTP requests, by method, route and status code.")
                    .register(registry)
                    .increment();

            if (response.getStatus() >= errorThreshold) {
                Counter.builder("http.server.request.errors")
                        .tags(tags)
                        .description("Total number of HTTP requests that resulted in a server error, by method, route and status code.")
                        .register(registry)
                        .increment();
            }

            Timer.builder("http.server.request.duration")
                    .tags(Tags.of("method", method, "route", route))
                    .description("HTTP request duration in seconds, by method and route.")
                    .serviceLevelObjectives(buckets)
                    .register(registry)
                    .record(elapsedNanos, TimeUnit.NANOSECONDS);
        }
    }

    private AtomicInteger registerActiveRequestsGauge(String method) {
        AtomicInteger counter = new AtomicInteger(0);
        Gauge.builder("http.server.active_requests", counter, AtomicInteger::get)
                .tag("method", method)
                .description("Number of HTTP requests currently being served, by method.")
                .register(registry);
        return counter;
    }

    private static String resolveRoute(HttpServletRequest request) {
        Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        if (pattern == null) {
            return "unmatched";
        }
        return pattern.toString();
    }
}
