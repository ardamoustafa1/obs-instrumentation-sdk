package com.acme.obs.instrumentation;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.obs.instrumentation.web.ObsHttpMetricsFilter;
import com.acme.obs.instrumentation.worker.ObsJob;
import com.acme.obs.instrumentation.worker.ObsWorkerMetrics;
import io.micrometer.prometheus.PrometheusConfig;
import io.micrometer.prometheus.PrometheusMeterRegistry;
import jakarta.servlet.FilterChain;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.servlet.HandlerMapping;

/**
 * Asserts this Spring Boot starter's exported metric families match
 * ../../../../../../../../CONTRACT.md byte-for-byte -- the same
 * conformance check every language in obs-instrumentation-sdk carries
 * (see go/conformance/naming_test.go and node/test/naming.test.js).
 */
class ContractNamingTest {

    private static final Pattern METRIC_NAME_PATTERN = Pattern.compile("^[a-z0-9_:]+$");

    private record ContractMetric(String name, String type) {}

    private static final ContractMetric[] CONTRACT_METRICS = {
        new ContractMetric("http_server_requests_total", "counter"),
        new ContractMetric("http_server_request_errors_total", "counter"),
        new ContractMetric("http_server_request_duration_seconds", "histogram"),
        new ContractMetric("http_server_active_requests", "gauge"),
        new ContractMetric("worker_jobs_processed_total", "counter"),
        new ContractMetric("worker_job_duration_seconds", "histogram"),
        new ContractMetric("worker_queue_depth", "gauge"),
    };

    @Test
    void exportedMetricNamesAndTypesMatchContract() throws Exception {
        PrometheusMeterRegistry registry = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
        ObsInstrumentationProperties properties = new ObsInstrumentationProperties();
        ObsHttpMetricsFilter httpFilter = new ObsHttpMetricsFilter(registry, properties);
        ObsWorkerMetrics workerMetrics = new ObsWorkerMetrics(registry, properties);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/orders/123");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = (req, res) -> {
            // Simulate what Spring MVC's DispatcherServlet does once it
            // resolves a handler, so the filter can read the route
            // template rather than the raw path.
            req.setAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE, "/orders/{id}");
            ((MockHttpServletResponse) res).setStatus(500);
        };
        httpFilter.doFilter(request, response, chain);

        ObsJob job = workerMetrics.startJob("invoices");
        job.finish(false);
        workerMetrics.setQueueDepth("invoices", 7);

        String scraped = registry.scrape();

        for (ContractMetric metric : CONTRACT_METRICS) {
            assertThat(METRIC_NAME_PATTERN.matcher(metric.name()).matches())
                    .as("contract entry %s itself violates the [a-z0-9_:] charset rule", metric.name())
                    .isTrue();
            assertThat(scraped)
                    .as("expected metric family %s of type %s in scrape output, got:\n%s", metric.name(), metric.type(), scraped)
                    .contains("# TYPE " + metric.name() + " " + metric.type());
        }

        assertThat(scraped).contains("method=\"GET\"");
        assertThat(scraped).contains("route=\"/orders/{id}\"");
        assertThat(scraped).contains("code=\"500\"");
        assertThat(scraped).contains("queue=\"invoices\"");
        assertThat(scraped).contains("status=\"failure\"");
        assertThat(scraped)
                .as("a 500 response must increment http_server_request_errors_total")
                .contains("http_server_request_errors_total{");
    }

    @Test
    void defaultBucketsCoverFiveMillisecondsToTenSeconds() {
        ObsInstrumentationProperties properties = new ObsInstrumentationProperties();
        assertThat(properties.getBuckets())
                .containsExactly(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0);
    }
}
