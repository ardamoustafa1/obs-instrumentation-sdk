# @acme/obs-instrumentation (Node.js)

```bash
npm install @acme/obs-instrumentation
```

Golden-signal HTTP/worker instrumentation for Node.js, exporting exactly
the metric families in [../CONTRACT.md](../CONTRACT.md). Built on
`@opentelemetry/sdk-metrics`; `/metrics` is served through
`@opentelemetry/exporter-prometheus` on your app's own port (no second
port to secure/scrape), and the same instruments can push over OTLP.
Compatible with Express and Fastify out of the box; anything else can call
`HttpMetrics.recordRequest()` directly.

## Quickstart (10 minutes)

```js
const express = require('express');
const { createRegistry, HttpMetrics } = require('@acme/obs-instrumentation');

const registry = createRegistry();
const httpMetrics = new HttpMetrics(registry);

const app = express();
app.use(httpMetrics.express());          // one line
app.get('/hello/:name', (req, res) => res.send(`hello, ${req.params.name}`));
app.get('/metrics', registry.metricsHandler);

app.listen(8080);
```

Full runnable version: [quickstart/server.js](quickstart/server.js).

```bash
cd quickstart
npm install   # installs the sibling SDK via "file:.." for this monorepo;
              # a real consumer would just list "@acme/obs-instrumentation": "^1.0.0"
node server.js
curl localhost:8080/hello/arda
curl localhost:8080/metrics
```

Docker (build context is `node/`, not `node/quickstart/`, so the sibling
SDK source is available to the `file:..` dependency):

```bash
docker build -f quickstart/Dockerfile -t obs-instrumentation-node-quickstart .
docker run -p 8080:8080 obs-instrumentation-node-quickstart
```

## Fastify

```js
const Fastify = require('fastify');
const { createRegistry, HttpMetrics } = require('@acme/obs-instrumentation');

const registry = createRegistry();
const httpMetrics = new HttpMetrics(registry);

const fastify = Fastify();
await fastify.register(httpMetrics.fastify()); // one line
fastify.get('/hello/:name', async (req) => `hello, ${req.params.name}`);
fastify.get('/metrics', (req, reply) => registry.metricsHandler(req.raw, reply.raw));

await fastify.listen({ port: 8080 });
```

`httpMetrics.fastify()` is wrapped with `fastify-plugin` internally so its
`onRequest`/`onResponse` hooks apply to your whole app, not just routes
registered inside that one `register()` call -- a common Fastify
encapsulation gotcha this SDK avoids for you.

## Route labels and cardinality

- Express: reads `req.route.path` (joined with `req.baseUrl` for
  sub-routers), available once Express has matched the route -- the
  middleware reads it inside the response `finish` event, not immediately
  after `next()`.
- Fastify: reads `request.routeOptions.url`.
- Neither ever uses the raw request path. Unmatched requests (404s) all
  collapse into a single `route="unmatched"` label value -- see
  [../README.md](../README.md#metric-naming-contract)'s cardinality rule.

## Worker/queue metrics

```js
const { WorkerMetrics } = require('@acme/obs-instrumentation');
const workerMetrics = new WorkerMetrics(registry);

const job = workerMetrics.startJob('invoices');
try {
  await process(message);
  job.finish(true);
} catch (err) {
  job.finish(false);
  throw err;
}

// wherever you already poll queue depth:
workerMetrics.setQueueDepth('invoices', depth);
```

## Exemplars

**Partial support, disclosed honestly**: `@opentelemetry/sdk-metrics`
supports exemplars internally (trace-based exemplar filters/reservoirs),
but as of `@opentelemetry/exporter-prometheus@0.222.0` the Prometheus
serializer does not yet emit exemplar lines in its OpenMetrics output --
this is an upstream gap in the JS exporter, not something this package
works around with custom code (see [../go/README.md](../go/README.md)'s
Exemplars section for the Go SDK, where the equivalent official exporter
does serialize them today). Because this package is built on the standard
OpenTelemetry metrics API rather than a bespoke recorder, exemplars will
start appearing with **zero changes to your instrumentation code** once
that upstream exporter adds serialization -- only a dependency bump. In
the meantime, OTLP push (below) already carries full exemplar data in the
wire protocol; route metrics through an OTel Collector if you need
exemplars today.

## OTLP push

```js
const registry = createRegistry({
  otlpEndpoint: 'otel-collector.obs-system.svc:4317',
});
```

The same instruments now also push to the collector every 15s
(`otlpIntervalMillis` to change that), in addition to being scrapeable at
`/metrics`. Dormant infrastructure for a future Tempo/trace pipeline --
no code changes needed later, just set `otlpEndpoint`.

## Testing your own naming

See [test/naming.test.js](test/naming.test.js) for the pattern this
package's own conformance test uses: build a `Registry`, drive some
requests/jobs through it, call `registry.metricsHandler` against a fake
`(req, res)`, and assert on `# TYPE <name> <type>` lines. It is exactly
what `obs-manifest-schema`'s CI checks for the metric names you'll later
put in your `observability.yaml`.
