// Package conformance asserts that this Go SDK's exported metric families
// match CONTRACT.md byte-for-byte. It exists as its own package (rather
// than living inside httpmetrics/worker) so it can import both without a
// circular dependency, mirroring the same conformance check every language
// in obs-instrumentation-sdk carries (see node/test/naming.test.js and
// java's ContractNamingTest).
package conformance

import (
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/acme/obs-instrumentation-sdk/go/httpmetrics"
	"github.com/acme/obs-instrumentation-sdk/go/metrics"
	"github.com/acme/obs-instrumentation-sdk/go/worker"
)

// contractMetrics mirrors CONTRACT.md exactly. A change here without a
// matching CONTRACT.md bump (or vice versa) is the bug this test exists to
// catch.
var contractMetrics = []struct {
	name string
	typ  string
}{
	{"http_server_requests_total", "counter"},
	{"http_server_request_errors_total", "counter"},
	{"http_server_request_duration_seconds", "histogram"},
	{"http_server_active_requests", "gauge"},
	{"worker_jobs_processed_total", "counter"},
	{"worker_job_duration_seconds", "histogram"},
	{"worker_queue_depth", "gauge"},
}

var metricNamePattern = regexp.MustCompile(`^[a-z0-9_:]+$`)

func TestExportedMetricNamesMatchContract(t *testing.T) {
	reg, err := metrics.New(metrics.Config{})
	if err != nil {
		t.Fatal(err)
	}

	mw := httpmetrics.New(reg, httpmetrics.Config{})
	handler := mw.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	req := httptest.NewRequest(http.MethodGet, "/orders/123", nil)
	req.Pattern = "GET /orders/{id}"
	handler.ServeHTTP(httptest.NewRecorder(), req)

	workerMetrics := worker.New(reg)
	job := workerMetrics.StartJob(req.Context(), "invoices")
	job.Finish(false)
	workerMetrics.SetQueueDepth(req.Context(), "invoices", 7)

	body := scrape(t, reg)

	for _, m := range contractMetrics {
		if !metricNamePattern.MatchString(m.name) {
			t.Errorf("contract entry %q itself violates the [a-z0-9_:] charset rule", m.name)
		}
		wantHelp := "# HELP " + m.name
		wantType := "# TYPE " + m.name + " " + m.typ
		if !strings.Contains(body, wantHelp) {
			t.Errorf("expected %q in /metrics output (metric family missing), got:\n%s", wantHelp, body)
		}
		if !strings.Contains(body, wantType) {
			t.Errorf("expected %q in /metrics output (wrong or missing type), got:\n%s", wantType, body)
		}
	}

	// Spot-check the label contract on the two request-scoped families.
	if !strings.Contains(body, `method="GET"`) || !strings.Contains(body, `route="/orders/{id}"`) || !strings.Contains(body, `code="500"`) {
		t.Errorf("expected method/route/code labels on http_server_requests_total, got:\n%s", body)
	}
	if !strings.Contains(body, `queue="invoices"`) || !strings.Contains(body, `status="failure"`) {
		t.Errorf("expected queue/status labels on worker_jobs_processed_total, got:\n%s", body)
	}

	// The 500 response must count as an error under the default threshold.
	if !strings.Contains(body, "http_server_request_errors_total{") {
		t.Errorf("expected a 500 response to increment http_server_request_errors_total, got:\n%s", body)
	}
}

func TestDefaultBucketsAreFiveMillisecondsToTenSeconds(t *testing.T) {
	want := []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}
	got := metrics.DefaultBuckets
	if len(got) != len(want) {
		t.Fatalf("expected %d buckets, got %d: %v", len(want), len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("bucket[%d]: expected %v, got %v (full: %v)", i, want[i], got[i], got)
		}
	}
}

func scrape(t *testing.T, reg *metrics.Registry) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rw := httptest.NewRecorder()
	reg.Handler().ServeHTTP(rw, req)
	body, err := io.ReadAll(rw.Result().Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}
