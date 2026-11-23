'use strict';

// 10-minute integration proof: a minimal Express server with
// obs-instrumentation-sdk's HTTP golden signals wired in.
//
//   npm install
//   node server.js
//   curl localhost:8080/hello/arda
//   curl localhost:8080/metrics

const express = require('express');
const { createRegistry, HttpMetrics } = require('@acme/obs-instrumentation');

// 1. Build the shared registry (pass { otlpEndpoint: '...' } to also push
//    to a collector -- see ../README.md).
const registry = createRegistry();

// 2. One line of middleware.
const httpMetrics = new HttpMetrics(registry);

const app = express();
app.use(httpMetrics.express());

app.get('/hello/:name', (req, res) => {
  res.send(`hello, ${req.params.name}`);
});

app.get('/boom', (req, res) => {
  res.status(500).send('simulated failure');
});

// 3. /metrics is just another route.
app.get('/metrics', registry.metricsHandler);

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`listening on :${port}`));
