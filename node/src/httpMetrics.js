'use strict';

/**
 * HTTP golden-signal instrumentation, exporting exactly the metric
 * families in ../../CONTRACT.md:
 *   http_server_requests_total{method,route,code}
 *   http_server_request_errors_total{method,route,code}
 *   http_server_request_duration_seconds{method,route}
 *   http_server_active_requests{method}
 */

const { hrtime } = require('node:process');
const fp = require('fastify-plugin');

class HttpMetrics {
  /**
   * @param {import('./registry').Registry} registry
   * @param {Object} [options]
   * @param {number} [options.errorThreshold] Minimum status code counted
   *   into http_server_request_errors_total. Default 500.
   */
  constructor(registry, options = {}) {
    const meter = registry.meter('@acme/obs-instrumentation/http');
    this._errorThreshold = options.errorThreshold || 500;

    this._requestsTotal = meter.createCounter('http.server.requests', {
      unit: '1',
      description: 'Total number of HTTP requests, by method, route and status code.',
    });
    this._errorsTotal = meter.createCounter('http.server.request.errors', {
      unit: '1',
      description: 'Total number of HTTP requests that resulted in a server error, by method, route and status code.',
    });
    // Unit suffix baked into the instrument name -- see registry.js's doc
    // comment on why this exporter does not add it automatically.
    this._duration = meter.createHistogram('http.server.request.duration_seconds', {
      unit: 's',
      description: 'HTTP request duration in seconds, by method and route.',
    });
    this._activeRequests = meter.createUpDownCounter('http.server.active_requests', {
      unit: '1',
      description: 'Number of HTTP requests currently being served, by method.',
    });
  }

  /**
   * Records one completed request. Framework adapters (express(), fastify())
   * call this; use it directly if you have a different framework.
   * @param {{method: string, route: string, statusCode: number, durationSeconds: number}} sample
   */
  recordRequest(sample) {
    const attrs = { method: sample.method, route: sample.route, code: String(sample.statusCode) };
    this._requestsTotal.add(1, attrs);
    if (sample.statusCode >= this._errorThreshold) {
      this._errorsTotal.add(1, attrs);
    }
    this._duration.record(sample.durationSeconds, { method: sample.method, route: sample.route });
  }

  /**
   * Express middleware. One line:
   *   app.use(httpMetrics.express());
   * Must be registered before your routes so timing covers the whole
   * request; route template is read from req.route once Express has
   * matched it (available by the time the response finishes).
   */
  express() {
    const self = this;
    return function obsInstrumentationExpressMiddleware(req, res, next) {
      const method = req.method;
      self._activeRequests.add(1, { method });
      const start = hrtime.bigint();

      res.on('finish', () => {
        self._activeRequests.add(-1, { method });
        const elapsedNs = hrtime.bigint() - start;
        const route = expressRoute(req);
        self.recordRequest({
          method,
          route,
          statusCode: res.statusCode,
          durationSeconds: Number(elapsedNs) / 1e9,
        });
      });

      next();
    };
  }

  /**
   * Fastify plugin. One line:
   *   fastify.register(httpMetrics.fastify());
   */
  fastify() {
    const self = this;
    // Wrapped with fastify-plugin so these hooks apply to the whole
    // Fastify instance (including routes registered after this plugin),
    // not just an encapsulated child context -- the encapsulation Fastify
    // applies to plain fastify.register() calls would otherwise silently
    // instrument nothing outside this plugin's own scope.
    return fp(async function obsInstrumentationFastifyPlugin(fastify) {
      fastify.addHook('onRequest', async (request) => {
        request.obsInstrumentationStart = hrtime.bigint();
        self._activeRequests.add(1, { method: request.method });
      });
      fastify.addHook('onResponse', async (request, reply) => {
        self._activeRequests.add(-1, { method: request.method });
        const elapsedNs = hrtime.bigint() - (request.obsInstrumentationStart || hrtime.bigint());
        self.recordRequest({
          method: request.method,
          route: fastifyRoute(request),
          statusCode: reply.statusCode,
          durationSeconds: Number(elapsedNs) / 1e9,
        });
      });
    });
  }
}

/**
 * Route template, never the raw path (unbounded cardinality -- see
 * CONTRACT.md's cardinality rule). req.route.path is relative to the
 * router it was matched in, so it is joined with req.baseUrl for
 * sub-routers; falls back to "unmatched" for 404s.
 * @param {import('http').IncomingMessage & {route?: any, baseUrl?: string}} req
 */
function expressRoute(req) {
  if (req.route && req.route.path) {
    return (req.baseUrl || '') + req.route.path;
  }
  return 'unmatched';
}

/**
 * @param {import('fastify').FastifyRequest} request
 */
function fastifyRoute(request) {
  if (request.routeOptions && request.routeOptions.url) {
    return request.routeOptions.url;
  }
  if (request.routerPath) {
    return request.routerPath;
  }
  return 'unmatched';
}

module.exports = { HttpMetrics };
