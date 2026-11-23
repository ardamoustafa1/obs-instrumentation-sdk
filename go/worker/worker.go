// Package worker provides a small manual-instrumentation API for
// worker/queue style services, exporting worker_jobs_processed_total,
// worker_job_duration_seconds and worker_queue_depth (CONTRACT.md). Unlike
// httpmetrics there is no framework-agnostic "start/end of a job" hook to
// wrap automatically, so this package exposes a two-call pattern instead.
package worker

import (
	"context"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"github.com/acme/obs-instrumentation-sdk/go/metrics"
)

// Metrics exports the worker golden signals.
type Metrics struct {
	jobsProcessed metric.Float64Counter
	jobDuration   metric.Float64Histogram
	queueDepth    metric.Float64Gauge
}

// New builds a Metrics backed by reg's shared Meter.
func New(reg *metrics.Registry) *Metrics {
	meter := reg.Meter("github.com/acme/obs-instrumentation-sdk/go/worker")

	jobsProcessed, err := meter.Float64Counter("worker.jobs.processed",
		metric.WithUnit("1"),
		metric.WithDescription("Total number of worker jobs processed, by queue and outcome."))
	mustNotErr(err)

	jobDuration, err := meter.Float64Histogram("worker.job.duration",
		metric.WithUnit("s"),
		metric.WithDescription("Worker job processing duration in seconds, by queue."))
	mustNotErr(err)

	// Deliberately no WithUnit("1") here: the OTel->Prometheus translator
	// suffixes dimensionless *gauges* with "_ratio" (unlike counters/
	// UpDownCounters), which would rename this to worker_queue_depth_ratio
	// and violate CONTRACT.md. Verified by conformance/naming_test.go.
	queueDepth, err := meter.Float64Gauge("worker.queue.depth",
		metric.WithDescription("Current number of pending jobs, by queue."))
	mustNotErr(err)

	return &Metrics{jobsProcessed: jobsProcessed, jobDuration: jobDuration, queueDepth: queueDepth}
}

func mustNotErr(err error) {
	if err != nil {
		panic("obs-instrumentation-sdk/go/worker: " + err.Error())
	}
}

// SetQueueDepth records the current depth of queue. This package does not
// poll your queue on your own behalf -- call this from wherever your
// service already knows the depth (an SQS ApproximateNumberOfMessages
// response, a Redis LLEN, a DB row count, ...), e.g. on a ticker.
func (m *Metrics) SetQueueDepth(ctx context.Context, queue string, depth float64) {
	m.queueDepth.Record(ctx, depth, metric.WithAttributes(attribute.String("queue", queue)))
}

// Job is a started-but-not-yet-finished unit of work returned by StartJob.
type Job struct {
	metrics *Metrics
	ctx     context.Context
	queue   string
	start   time.Time
}

// StartJob begins timing one job on queue. Call Finish exactly once,
// typically with defer:
//
//	job := workerMetrics.StartJob(ctx, "invoices")
//	defer func() { job.Finish(err == nil) }()
func (m *Metrics) StartJob(ctx context.Context, queue string) *Job {
	return &Job{metrics: m, ctx: ctx, queue: queue, start: time.Now()}
}

// Finish records the job's outcome and duration.
// worker_jobs_processed_total{status="success"|"failure"} is incremented,
// and worker_job_duration_seconds observes the elapsed time since StartJob
// (with an automatic trace exemplar if j's context carries a sampled span).
func (j *Job) Finish(success bool) {
	status := "success"
	if !success {
		status = "failure"
	}
	queueAttr := attribute.String("queue", j.queue)
	j.metrics.jobsProcessed.Add(j.ctx, 1, metric.WithAttributes(queueAttr, attribute.String("status", status)))
	j.metrics.jobDuration.Record(j.ctx, time.Since(j.start).Seconds(), metric.WithAttributes(queueAttr))
}
