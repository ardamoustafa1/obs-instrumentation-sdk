package com.acme.obs.instrumentation.worker;

import com.acme.obs.instrumentation.ObsInstrumentationProperties;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Tags;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Manual worker/queue instrumentation, exporting exactly the metric
 * families in ../../../../../../../../CONTRACT.md:
 *
 * <pre>
 *   worker_jobs_processed_total{queue,status}
 *   worker_job_duration_seconds{queue}
 *   worker_queue_depth{queue}
 * </pre>
 *
 * Autowire this bean (auto-configured by the starter) directly:
 *
 * <pre>{@code
 * @Service
 * class InvoiceWorker {
 *     private final ObsWorkerMetrics metrics;
 *
 *     void process(Message message) {
 *         ObsJob job = metrics.startJob("invoices");
 *         try {
 *             handle(message);
 *             job.finish(true);
 *         } catch (Exception e) {
 *             job.finish(false);
 *             throw e;
 *         }
 *     }
 * }
 * }</pre>
 */
public class ObsWorkerMetrics {

    private final MeterRegistry registry;
    private final Duration[] buckets;
    private final ConcurrentMap<String, Timer> durationTimersByQueue = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, AtomicReference<Double>> queueDepthByQueue = new ConcurrentHashMap<>();

    public ObsWorkerMetrics(MeterRegistry registry, ObsInstrumentationProperties properties) {
        this.registry = registry;
        this.buckets = properties.bucketDurations();
    }

    /** Begins timing one job on {@code queue}. Call {@code job.finish(success)} exactly once. */
    public ObsJob startJob(String queue) {
        Timer durationTimer = durationTimersByQueue.computeIfAbsent(queue, this::registerDurationTimer);
        return new ObsJob(this, queue, Timer.start(registry), durationTimer);
    }

    void recordFinish(ObsJob job, boolean success) {
        String status = success ? "success" : "failure";
        Counter.builder("worker.jobs.processed")
                .tags(Tags.of("queue", job.queue(), "status", status))
                .description("Total number of worker jobs processed, by queue and outcome.")
                .register(registry)
                .increment();
        job.sample().stop(job.durationTimer());
    }

    /**
     * Records the current depth of {@code queue}. This class does not poll
     * your queue on your own behalf -- call this from wherever your
     * service already knows the depth (an SQS
     * {@code ApproximateNumberOfMessages} response, a Redis {@code LLEN},
     * a DB row count, ...), e.g. from a {@code @Scheduled} method.
     */
    public void setQueueDepth(String queue, double depth) {
        AtomicReference<Double> value = queueDepthByQueue.computeIfAbsent(queue, this::registerQueueDepthGauge);
        value.set(depth);
    }

    private Timer registerDurationTimer(String queue) {
        return Timer.builder("worker.job.duration")
                .tag("queue", queue)
                .description("Worker job processing duration in seconds, by queue.")
                .serviceLevelObjectives(buckets)
                .register(registry);
    }

    private AtomicReference<Double> registerQueueDepthGauge(String queue) {
        AtomicReference<Double> value = new AtomicReference<>(0.0);
        Gauge.builder("worker.queue.depth", value, ref -> ref.get())
                .tag("queue", queue)
                .description("Current number of pending jobs, by queue.")
                .register(registry);
        return value;
    }
}
