// Package httpmetrics provides a one-line net/http middleware exporting the
// HTTP golden signals defined in CONTRACT.md:
// http_server_requests_total, http_server_request_errors_total,
// http_server_request_duration_seconds and http_server_active_requests.
package httpmetrics

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"github.com/acme/obs-instrumentation-sdk/go/metrics"
)

// RouteExtractor returns the router-template route for r (e.g. "/users/{id}"),
// never the raw path -- a raw path label has unbounded cardinality (see
// CONTRACT.md's cardinality rule). Plug your router's own accessor in:
// chi.RouteContext(r.Context()).RoutePattern(), gin's c.FullPath(), etc.
// The default only understands Go 1.22+ http.ServeMux's pattern matching.
type RouteExtractor func(r *http.Request) string

func defaultRouteExtractor(r *http.Request) string {
	// r.Pattern is populated by net/http's ServeMux (Go 1.22+) when routes
	// are registered as e.g. mux.HandleFunc("GET /users/{id}", ...). It
	// includes the method prefix, which we strip since method is already
	// its own label.
	if r.Pattern == "" {
		return "unmatched"
	}
	if idx := strings.IndexByte(r.Pattern, ' '); idx >= 0 {
		return r.Pattern[idx+1:]
	}
	return r.Pattern
}

// Config configures a Middleware.
type Config struct {
	// RouteExtractor defaults to reading Go 1.22+ http.ServeMux's r.Pattern.
	RouteExtractor RouteExtractor
	// ErrorThreshold is the minimum HTTP status code counted into
	// http_server_request_errors_total. Defaults to 500 (server errors
	// only; set to 400 to also count client errors as "errors" for
	// services where that is the right signal).
	ErrorThreshold int
}

// Middleware instruments HTTP handlers with the golden-signal metrics.
type Middleware struct {
	requestsTotal  metric.Float64Counter
	errorsTotal    metric.Float64Counter
	duration       metric.Float64Histogram
	activeRequests metric.Int64UpDownCounter
	routeExtractor RouteExtractor
	errorThreshold int
}

// New builds a Middleware backed by reg's shared Meter.
func New(reg *metrics.Registry, cfg Config) *Middleware {
	if cfg.RouteExtractor == nil {
		cfg.RouteExtractor = defaultRouteExtractor
	}
	if cfg.ErrorThreshold == 0 {
		cfg.ErrorThreshold = 500
	}

	meter := reg.Meter("github.com/acme/obs-instrumentation-sdk/go/httpmetrics")

	requestsTotal, err := meter.Float64Counter("http.server.requests",
		metric.WithUnit("1"),
		metric.WithDescription("Total number of HTTP requests, by method, route and status code."))
	mustNotErr(err)

	errorsTotal, err := meter.Float64Counter("http.server.request.errors",
		metric.WithUnit("1"),
		metric.WithDescription("Total number of HTTP requests that resulted in a server error, by method, route and status code."))
	mustNotErr(err)

	duration, err := meter.Float64Histogram("http.server.request.duration",
		metric.WithUnit("s"),
		metric.WithDescription("HTTP request duration in seconds, by method and route."))
	mustNotErr(err)

	activeRequests, err := meter.Int64UpDownCounter("http.server.active_requests",
		metric.WithUnit("1"),
		metric.WithDescription("Number of HTTP requests currently being served, by method."))
	mustNotErr(err)

	return &Middleware{
		requestsTotal:  requestsTotal,
		errorsTotal:    errorsTotal,
		duration:       duration,
		activeRequests: activeRequests,
		routeExtractor: cfg.RouteExtractor,
		errorThreshold: cfg.ErrorThreshold,
	}
}

func mustNotErr(err error) {
	if err != nil {
		// Only fails on a programming error (e.g. re-registering the same
		// instrument name with an incompatible kind); fail fast at
		// startup rather than silently drop metrics.
		panic("obs-instrumentation-sdk/go/httpmetrics: " + err.Error())
	}
}

// Handler wraps next with golden-signal instrumentation. One line:
//
//	http.ListenAndServe(":8080", mw.Handler(router))
func (m *Middleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		methodAttr := attribute.String("method", r.Method)

		m.activeRequests.Add(ctx, 1, metric.WithAttributes(methodAttr))
		defer m.activeRequests.Add(ctx, -1, metric.WithAttributes(methodAttr))

		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		elapsed := time.Since(start).Seconds()

		route := m.routeExtractor(r)
		routeAttr := attribute.String("route", route)
		codeAttr := attribute.String("code", strconv.Itoa(rec.status))

		m.requestsTotal.Add(ctx, 1, metric.WithAttributes(methodAttr, routeAttr, codeAttr))
		if rec.status >= m.errorThreshold {
			m.errorsTotal.Add(ctx, 1, metric.WithAttributes(methodAttr, routeAttr, codeAttr))
		}
		// Exemplars: if ctx carries a sampled OpenTelemetry span, the SDK
		// automatically attaches its trace ID to this observation -- no
		// extra code here or in the caller. See CONTRACT.md.
		m.duration.Record(ctx, elapsed, metric.WithAttributes(methodAttr, routeAttr))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}
