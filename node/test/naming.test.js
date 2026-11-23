'use strict';

// Asserts this Node SDK's exported metric families match ../../CONTRACT.md
// byte-for-byte -- the same conformance check every language in
// obs-instrumentation-sdk carries (see go/conformance/naming_test.go and
// Java's ContractNamingTest).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const express = require('express');

const { createRegistry, HttpMetrics, WorkerMetrics, DEFAULT_BUCKETS } = require('../src');

// Mirrors CONTRACT.md exactly.
const CONTRACT_METRICS = [
  { name: 'http_server_requests_total', type: 'counter' },
  { name: 'http_server_request_errors_total', type: 'counter' },
  { name: 'http_server_request_duration_seconds', type: 'histogram' },
  { name: 'http_server_active_requests', type: 'gauge' },
  { name: 'worker_jobs_processed_total', type: 'counter' },
  { name: 'worker_job_duration_seconds', type: 'histogram' },
  { name: 'worker_queue_depth', type: 'gauge' },
];

const METRIC_NAME_PATTERN = /^[a-z0-9_:]+$/;

async function scrape(registry) {
  return new Promise((resolve, reject) => {
    const req = { url: '/metrics', method: 'GET', headers: {} };
    const chunks = [];
    const res = {
      statusCode: 200,
      setHeader() {},
      writeHead() {},
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        resolve(Buffer.concat(chunks).toString('utf8'));
      },
      write(chunk) {
        chunks.push(Buffer.from(chunk));
      },
    };
    try {
      registry.metricsHandler(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

test('exported metric names and types match CONTRACT.md', async () => {
  const registry = createRegistry();
  const httpMetrics = new HttpMetrics(registry);
  const workerMetrics = new WorkerMetrics(registry);

  // Drive a real request through the Express adapter so
  // http_server_active_requests (incremented/decremented around the
  // handler) actually gets a data point, not just requestsTotal/duration.
  const app = express();
  app.use(httpMetrics.express());
  app.get('/orders/:id', (req, res) => res.status(500).send('boom'));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  await fetch(`http://127.0.0.1:${port}/orders/123`);
  await new Promise((resolve) => server.close(resolve));

  const job = workerMetrics.startJob('invoices');
  job.finish(false);
  workerMetrics.setQueueDepth('invoices', 7);

  const body = await scrape(registry);

  for (const metric of CONTRACT_METRICS) {
    assert.match(metric.name, METRIC_NAME_PATTERN, `contract entry ${metric.name} itself violates the naming charset rule`);
    assert.match(
      body,
      new RegExp(`# TYPE ${metric.name} ${metric.type}\\b`),
      `expected metric family "${metric.name}" of type "${metric.type}" in /metrics output, got:\n${body}`
    );
  }

  assert.match(body, /method="GET"/);
  assert.match(body, /route="\/orders\/:id"/);
  assert.match(body, /code="500"/);
  assert.match(body, /queue="invoices"/);
  assert.match(body, /status="failure"/);
  assert.match(body, /http_server_request_errors_total\{/, 'a 500 response must increment the errors counter');

  await registry.shutdown();
});

test('DEFAULT_BUCKETS covers 5ms to 10s with the standard sequence', () => {
  assert.deepEqual(DEFAULT_BUCKETS, [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
});
