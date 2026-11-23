package com.acme.obs.instrumentation;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuration under {@code obs.instrumentation.*}. See
 * ../../../../../../../README.md for the full option reference.
 */
@ConfigurationProperties(prefix = "obs.instrumentation")
public class ObsInstrumentationProperties {

    /**
     * Minimum HTTP status code counted into
     * {@code http_server_request_errors_total}. Default 500 (server errors
     * only); set to 400 to also count client errors.
     */
    private int errorThreshold = 500;

    /**
     * Histogram bucket boundaries (seconds) for
     * {@code http_server_request_duration_seconds} and
     * {@code worker_job_duration_seconds}. Defaults to the SDK-wide
     * 5ms-10s sequence in CONTRACT.md.
     */
    private List<Double> buckets = List.of(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0);

    public int getErrorThreshold() {
        return errorThreshold;
    }

    public void setErrorThreshold(int errorThreshold) {
        this.errorThreshold = errorThreshold;
    }

    public List<Double> getBuckets() {
        return buckets;
    }

    public void setBuckets(List<Double> buckets) {
        this.buckets = buckets;
    }

    /** Buckets converted to {@link Duration}, as Micrometer's Timer API expects. */
    public Duration[] bucketDurations() {
        return buckets.stream()
                .map(seconds -> Duration.ofNanos((long) (seconds * 1_000_000_000L)))
                .toArray(Duration[]::new);
    }
}
