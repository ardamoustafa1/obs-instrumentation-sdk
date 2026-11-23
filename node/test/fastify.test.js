'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');

const { createRegistry, HttpMetrics } = require('../src');

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

test('fastify: one-line plugin records route template, not raw path', async () => {
  const registry = createRegistry();
  const httpMetrics = new HttpMetrics(registry);

  const fastify = Fastify();
  await fastify.register(httpMetrics.fastify());
  fastify.get('/users/:id', async (request) => ({ id: request.params.id }));
  await fastify.ready();

  await fastify.inject({ method: 'GET', url: '/users/42' });
  await fastify.inject({ method: 'GET', url: '/users/99' });
  await fastify.close();

  const body = await scrapeText(registry);
  assert.match(body, /http_server_requests_total\{method="GET",route="\/users\/:id",code="200"\} 2/);
  assert.doesNotMatch(body, /route="\/users\/42"/, 'raw path must never become a label value');
});

test('fastify: unmatched routes (404) fall back to "unmatched"', async () => {
  const registry = createRegistry();
  const httpMetrics = new HttpMetrics(registry);

  const fastify = Fastify();
  await fastify.register(httpMetrics.fastify());
  fastify.get('/known', async () => 'ok');
  await fastify.ready();

  await fastify.inject({ method: 'GET', url: '/nope' });
  await fastify.close();

  const body = await scrapeText(registry);
  assert.match(body, /http_server_requests_total\{method="GET",route="unmatched",code="404"\} 1/);
});
