// Command quickstart is a 10-minute integration proof: a minimal net/http
// server with obs-instrumentation-sdk's HTTP golden signals wired in.
//
//	go run ./go/quickstart
//	curl localhost:8080/hello/arda
//	curl localhost:8080/metrics
package main

import (
	"log"
	"net/http"

	"github.com/acme/obs-instrumentation-sdk/go/httpmetrics"
	"github.com/acme/obs-instrumentation-sdk/go/metrics"
)

func main() {
	// 1. Build the shared registry (swap in metrics.Config{OTLPEndpoint: "..."}
	//    to also push to a collector -- see ../README.md).
	reg, err := metrics.New(metrics.Config{})
	if err != nil {
		log.Fatal(err)
	}

	// 2. One line of middleware.
	mw := httpmetrics.New(reg, httpmetrics.Config{})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /hello/{name}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hello, " + r.PathValue("name")))
	})
	mux.HandleFunc("GET /boom", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "simulated failure", http.StatusInternalServerError)
	})

	// 3. /metrics is just another handler.
	mux.Handle("GET /metrics", reg.Handler())

	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mw.Handler(mux)))
}
