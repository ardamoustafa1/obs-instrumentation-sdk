'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createRegistry, HttpMetrics } = require('../src');

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function scrapeText(registry) {
  return new Promise((resolve) => {
    const chunks = [];
    registry.metricsHandler(
      { url: '/metrics', method: 'GET' },
      {
        statusCode: 200,
        setHeader() {},
        end(chunk) {
          if (chunk) chunks.push(Buffer.from(chunk));
          resolve(Buffer.concat(chunks).toString('utf8'));
        },
        write(chunk) {
          chunks.push(Buffer.from(chunk));
        },
      }
    );
  });
}

test('express: one-line middleware records route template, not raw path', async () => {
  const registry = createRegistry();
  const httpMetrics = new HttpMetrics(registry);

  const app = express();
  app.use(httpMetrics.express());
  app.get('/users/:id', (req, res) => res.json({ id: req.params.id }));

  await withServer(app, async (base) => {
    await fetch(`${base}/users/42`);
    await fetch(`${base}/users/99`);
  });

  const body = await scrapeText(registry);
  assert.match(body, /http_server_requests_total\{method="GET",route="\/users\/:id",code="200"\} 2/);
  assert.doesNotMatch(body, /route="\/users\/42"/, 'raw path must never become a label value');
});

test('express: unmatched routes (404) fall back to a single "unmatched" route label', async () => {
  const registry = createRegistry();
  const httpMetrics = new HttpMetrics(registry);

  const app = express();
  app.use(httpMetrics.express());
  app.get('/known', (req, res) => res.send('ok'));

  await withServer(app, async (base) => {
    await fetch(`${base}/totally/unknown/path`);
  });

  const body = await scrapeText(registry);
  assert.match(body, /http_server_requests_total\{method="GET",route="unmatched",code="404"\} 1/);
});

test('express: custom errorThreshold counts 4xx as errors when configured', async () => {
  const registry = createRegistry();
  const httpMetrics = new HttpMetrics(registry, { errorThreshold: 400 });

  const app = express();
  app.use(httpMetrics.express());
  app.get('/missing', (req, res) => res.status(404).send('not found'));

  await withServer(app, async (base) => {
    await fetch(`${base}/missing`);
  });

  const body = await scrapeText(registry);
  assert.match(body, /http_server_request_errors_total\{method="GET",route="\/missing",code="404"\} 1/);
});
