'use strict';

/**
 * Worker/queue golden-signal instrumentation, exporting exactly the metric
 * families in ../../CONTRACT.md:
 *   worker_jobs_processed_total{queue,status}
 *   worker_job_duration_seconds{queue}
 *   worker_queue_depth{queue}
 */

const { hrtime } = require('node:process');

class Job {
  constructor(workerMetrics, queue) {
    this._workerMetrics = workerMetrics;
    this._queue = queue;
    this._start = hrtime.bigint();
  }

  /**
   * Records the job's outcome and duration.
   * @param {boolean} success
   */
  finish(success) {
    const status = success ? 'success' : 'failure';
    const elapsedSeconds = Number(hrtime.bigint() - this._start) / 1e9;
    this._workerMetrics._jobsProcessed.add(1, { queue: this._queue, status });
    this._workerMetrics._jobDuration.record(elapsedSeconds, { queue: this._queue });
  }
}

class WorkerMetrics {
  /**
   * @param {import('./registry').Registry} registry
   */
  constructor(registry) {
    const meter = registry.meter('@acme/obs-instrumentation/worker');

    this._jobsProcessed = meter.createCounter('worker.jobs.processed', {
      unit: '1',
      description: 'Total number of worker jobs processed, by queue and outcome.',
    });
    this._jobDuration = meter.createHistogram('worker.job.duration_seconds', {
      unit: 's',
      description: 'Worker job processing duration in seconds, by queue.',
    });
    this._queueDepth = meter.createGauge('worker.queue.depth', {
      description: 'Current number of pending jobs, by queue.',
    });
  }

  /**
   * Begins timing one job on queue. Call job.finish(success) exactly once:
   *
   *   const job = workerMetrics.startJob('invoices');
   *   try {
   *     await process(message);
   *     job.finish(true);
   *   } catch (err) {
   *     job.finish(false);
   *     throw err;
   *   }
   *
   * @param {string} queue
   * @returns {Job}
   */
  startJob(queue) {
    return new Job(this, queue);
  }

  /**
   * Records the current depth of queue. This package does not poll your
   * queue on your own behalf -- call this from wherever your service
   * already knows the depth (SQS ApproximateNumberOfMessages, Redis LLEN,
   * a DB row count, ...), e.g. on a setInterval.
   * @param {string} queue
   * @param {number} depth
   */
  setQueueDepth(queue, depth) {
    this._queueDepth.record(depth, { queue });
  }
}

module.exports = { WorkerMetrics, Job };
