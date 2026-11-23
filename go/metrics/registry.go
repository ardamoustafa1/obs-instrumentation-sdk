// Package metrics is the shared OpenTelemetry MeterProvider + Prometheus
// exposition backend every obs-instrumentation-sdk component
// (httpmetrics, worker) builds its instruments on top of.
//
// Design: instruments are created through the OpenTelemetry metrics API
// (go.opentelemetry.io/otel/metric), not github.com/prometheus/client_golang
// directly. The official go.opentelemetry.io/otel/exporters/prometheus
// bridge then exposes those same instruments at /metrics in Prometheus
// exposition format, translating OTel dotted instrument names into
// Prometheus snake_case names with the expected _total/_seconds suffixes
// (verified against CONTRACT.md's exact names -- see each component's
// naming_test.go). The same instruments can simultaneously be pushed over
// OTLP (see Config.OTLPEndpoint) with zero additional instrumentation code,
// and trace exemplars attach automatically whenever a sampled span is
// active in the context passed to Add/Record -- no code changes needed
// once a team wires up tracing (requirement 5).
package metrics

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

// DefaultBuckets are the standard 5ms-10s histogram bucket boundaries this
// SDK recommends for every latency histogram it ships
// (http_server_request_duration_seconds, worker_job_duration_seconds).
// See CONTRACT.md.
var DefaultBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

// HistogramNamesWithDefaultBuckets lists the OTel instrument names this
// package pins to DefaultBuckets via a View. Add your own via
// Config.Views if you introduce another histogram and want it on this
// package's /metrics + OTLP outputs.
var HistogramNamesWithDefaultBuckets = []string{
	"http.server.request.duration",
	"worker.job.duration",
}

// Config configures a Registry.
type Config struct {
	// OTLPEndpoint, when set, additionally pushes every metric recorded
	// through this Registry to an OTLP/gRPC endpoint (typically an OTel
	// Collector in front of a metrics backend) every OTLPInterval. Leave
	// empty to only expose the pull-based /metrics endpoint.
	OTLPEndpoint string
	// OTLPInsecure disables TLS for the OTLP/gRPC connection (local
	// collector sidecars typically run without TLS).
	OTLPInsecure bool
	// OTLPInterval is how often metrics are pushed. Defaults to 15s.
	OTLPInterval time.Duration
	// Views lets a caller override aggregation for instrument names beyond
	// the ones this package already pins buckets for (see
	// HistogramNamesWithDefaultBuckets).
	Views []sdkmetric.View
}

// Registry bundles the OpenTelemetry MeterProvider and the Prometheus
// registry backing /metrics.
type Registry struct {
	promRegistry *prometheus.Registry
	provider     *sdkmetric.MeterProvider
	shutdownFns  []func(context.Context) error
}

// New builds a Registry. Call Meter to get the shared metric.Meter every
// obs-instrumentation-sdk component instruments through, and Handler for
// the /metrics http.Handler.
func New(cfg Config) (*Registry, error) {
	promRegistry := prometheus.NewRegistry()
	promExporter, err := otelprom.New(
		otelprom.WithRegisterer(promRegistry),
		// Scope/target info are separate metric families this bridge adds
		// by default; the naming contract only promises the metric
		// families themselves, so keep /metrics minimal and predictable.
		otelprom.WithoutScopeInfo(),
		otelprom.WithoutTargetInfo(),
	)
	if err != nil {
		return nil, fmt.Errorf("build prometheus exporter: %w", err)
	}

	opts := []sdkmetric.Option{sdkmetric.WithReader(promExporter)}
	for _, name := range HistogramNamesWithDefaultBuckets {
		opts = append(opts, sdkmetric.WithView(bucketView(name, DefaultBuckets)))
	}
	opts = append(opts, viewOptions(cfg.Views)...)

	var shutdownFns []func(context.Context) error
	if cfg.OTLPEndpoint != "" {
		otlpOpts := []otlpmetricgrpc.Option{otlpmetricgrpc.WithEndpoint(cfg.OTLPEndpoint)}
		if cfg.OTLPInsecure {
			otlpOpts = append(otlpOpts, otlpmetricgrpc.WithInsecure())
		}
		otlpExporter, err := otlpmetricgrpc.New(context.Background(), otlpOpts...)
		if err != nil {
			return nil, fmt.Errorf("build otlp metric exporter: %w", err)
		}
		interval := cfg.OTLPInterval
		if interval <= 0 {
			interval = 15 * time.Second
		}
		reader := sdkmetric.NewPeriodicReader(otlpExporter, sdkmetric.WithInterval(interval))
		opts = append(opts, sdkmetric.WithReader(reader))
		shutdownFns = append(shutdownFns, reader.Shutdown)
	}

	provider := sdkmetric.NewMeterProvider(opts...)
	return &Registry{promRegistry: promRegistry, provider: provider, shutdownFns: shutdownFns}, nil
}

func bucketView(instrumentName string, buckets []float64) sdkmetric.View {
	return sdkmetric.NewView(
		sdkmetric.Instrument{Name: instrumentName},
		sdkmetric.Stream{Aggregation: sdkmetric.AggregationExplicitBucketHistogram{Boundaries: buckets}},
	)
}

func viewOptions(views []sdkmetric.View) []sdkmetric.Option {
	opts := make([]sdkmetric.Option, len(views))
	for i, v := range views {
		opts[i] = sdkmetric.WithView(v)
	}
	return opts
}

// Meter returns the shared Meter obs-instrumentation-sdk components (and
// application code recording its own custom metrics alongside them) should
// use. instrumentationName conventionally identifies the calling package,
// e.g. "github.com/acme/checkout-api/internal/handlers".
func (r *Registry) Meter(instrumentationName string) metric.Meter {
	return r.provider.Meter(instrumentationName)
}

// Handler returns the /metrics http.Handler. It negotiates OpenMetrics vs
// classic Prometheus text exposition per request's Accept header --
// OpenMetrics is required to carry exemplars (see package doc and
// CONTRACT.md's "Exemplar sözleşmesi").
func (r *Registry) Handler() http.Handler {
	return promhttp.HandlerFor(r.promRegistry, promhttp.HandlerOpts{
		Registry:          r.promRegistry,
		EnableOpenMetrics: true,
	})
}

// Shutdown flushes and stops any OTLP push readers, then shuts down the
// MeterProvider. Call during graceful shutdown; safe to call even when
// OTLP push was never configured.
func (r *Registry) Shutdown(ctx context.Context) error {
	for _, fn := range r.shutdownFns {
		if err := fn(ctx); err != nil {
			return err
		}
	}
	return r.provider.Shutdown(ctx)
}
