package com.acme.obs.instrumentation.worker;

import io.micrometer.core.instrument.Timer;

/** A started-but-not-yet-finished unit of work; see {@link ObsWorkerMetrics#startJob}. */
public final class ObsJob {

    private final ObsWorkerMetrics metrics;
    private final String queue;
    private final Timer.Sample sample;
    private final Timer durationTimer;

    ObsJob(ObsWorkerMetrics metrics, String queue, Timer.Sample sample, Timer durationTimer) {
        this.metrics = metrics;
        this.queue = queue;
        this.sample = sample;
        this.durationTimer = durationTimer;
    }

    /**
     * Records the job's outcome and duration.
     * {@code worker_jobs_processed_total{status="success"|"failure"}} is
     * incremented, and {@code worker_job_duration_seconds} observes the
     * elapsed time since {@code startJob}.
     */
    public void finish(boolean success) {
        metrics.recordFinish(this, success);
    }

    String queue() {
        return queue;
    }

    Timer.Sample sample() {
        return sample;
    }

    Timer durationTimer() {
        return durationTimer;
    }
}
