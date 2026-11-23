'use strict';

/**
 * Shared OpenTelemetry MeterProvider + Prometheus exposition backend every
 * obs-instrumentation-sdk component (httpMetrics, workerMetrics) builds its
 * instruments on top of.
 *
 * Design mirrors the Go and Java packages in this repo: instruments are
 * created through the OpenTelemetry metrics API
 * (@opentelemetry/sdk-metrics), and @opentelemetry/exporter-prometheus
 * exposes those same instruments at /metrics, translating OTel instrument
 * names into the exact Prometheus names in ../../CONTRACT.md. The one
 * naming quirk this package works around (see naming.js): this exporter
 * version does not auto-append a "_seconds" unit suffix for histograms the
 * way its Go counterpart does, so histogram instrument names are given
 * their unit suffix explicitly (see naming.js DURATION_SECONDS_NAME
 * constants) rather than relying on translation.
 */

const { MeterProvider } = require('@opentelemetry/sdk-metrics');
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');

/**
 * @typedef {Object} RegistryConfig
 * @property {string} [otlpEndpoint] When set, also pushes every metric
 *   recorded through this registry to an OTLP/gRPC endpoint every
 *   otlpIntervalMillis, in addition to the pull-based /metrics endpoint.
 * @property {number} [otlpIntervalMillis] Push interval, default 15000.
 * @property {import('@opentelemetry/sdk-metrics').ViewOptions[]} [views]
 *   Extra Views beyond the histogram-bucket views this package installs by
 *   default for http.server.request.duration_seconds and
 *   worker.job.duration_seconds.
 */

/**
 * Standard 5ms-10s histogram bucket boundaries this SDK recommends for
 * every latency histogram it ships. See CONTRACT.md.
 * @type {number[]}
 */
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const HISTOGRAM_INSTRUMENT_NAMES_WITH_DEFAULT_BUCKETS = [
  'http.server.request.duration_seconds',
  'worker.job.duration_seconds',
];

class Registry {
  /**
   * @param {import('@opentelemetry/sdk-metrics').MeterProvider} provider
   * @param {PrometheusExporter} exporter
   * @param {Array<() => Promise<void>>} shutdownFns
   */
  constructor(provider, exporter, shutdownFns) {
    this._provider = provider;
    this._exporter = exporter;
    this._shutdownFns = shutdownFns;
  }

  /**
   * Returns the shared Meter obs-instrumentation-sdk components (and your
   * own custom instrumentation) should use.
   * @param {string} instrumentationName e.g. your package name.
   */
  meter(instrumentationName) {
    return this._provider.getMeter(instrumentationName);
  }

  /**
   * Express-compatible request handler for GET /metrics:
   *   app.get('/metrics', registry.metricsHandler);
   */
  get metricsHandler() {
    return this._exporter.getMetricsRequestHandler.bind(this._exporter);
  }

  /** Flushes and stops OTLP push (if configured) and the MeterProvider. */
  async shutdown() {
    for (const fn of this._shutdownFns) {
      await fn();
    }
    await this._provider.shutdown();
  }
}

/**
 * Builds a Registry.
 * @param {RegistryConfig} [config]
 * @returns {Registry}
 */
function createRegistry(config = {}) {
  const exporter = new PrometheusExporter({
    // We mount metricsHandler ourselves on the app's own port/router
    // instead of the exporter's own standalone HTTP server -- one process,
    // one port, one /metrics, matching the "auto expose" requirement
    // without opening a second port teams have to remember to secure/scrape.
    preventServerStart: true,
    withoutScopeInfo: true,
    withoutTargetInfo: true,
  });

  const views = HISTOGRAM_INSTRUMENT_NAMES_WITH_DEFAULT_BUCKETS.map((name) => ({
    instrumentName: name,
    aggregation: {
      type: require('@opentelemetry/sdk-metrics').AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries: DEFAULT_BUCKETS },
    },
  }));
  if (Array.isArray(config.views)) {
    views.push(...config.views);
  }

  const readers = [exporter];
  const shutdownFns = [];
  if (config.otlpEndpoint) {
    // Optional peer dependency: only required if OTLP push is actually used.
    // eslint-disable-next-line global-require
    const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-grpc');
    // eslint-disable-next-line global-require
    const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
    const otlpExporter = new OTLPMetricExporter({ url: config.otlpEndpoint });
    const reader = new PeriodicExportingMetricReader({
      exporter: otlpExporter,
      exportIntervalMillis: config.otlpIntervalMillis || 15000,
    });
    readers.push(reader);
    shutdownFns.push(() => reader.shutdown());
  }

  const provider = new MeterProvider({ readers, views });
  return new Registry(provider, exporter, shutdownFns);
}

module.exports = { createRegistry, Registry, DEFAULT_BUCKETS };
