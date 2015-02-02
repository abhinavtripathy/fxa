/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Hapi = require('hapi');

const AppError = require('./error');
const auth = require('./auth');
const config = require('./config').root();
const logger = require('./logging')('server');
const hapiLogger = require('./logging')('server.hapi');
const summary = require('./logging/summary');

exports.create = function createServer() {

  if (config.localRedirects && config.env !== 'dev') {
    // nightly, latest, etc will probably set this to true, but it's
    // worth explicitly yelling about it.
    logger.warn('localRedirect',
      '*** localRedirects is set to TRUE. Should only be used for developers.');
  }
  var isProd = config.env === 'prod';
  var server = Hapi.createServer(
    config.server.host,
    config.server.port,
    {
      cors: true,
      debug: false,
      payload: {
        maxBytes: 16384
      },
      security: {
        hsts: {
          maxAge: 15552000,
          includeSubdomains: true
        },
        xframe: false,
        xss: false,
        noOpen: false,
        noSniff: false
      }
    }
  );



  server.auth.scheme(auth.AUTH_SCHEME, auth.strategy);
  server.auth.strategy(auth.AUTH_STRATEGY, auth.AUTH_SCHEME);

  var routes = require('./routing');
  if (isProd) {
    logger.info('prod', 'Disabling response schema validation');
    routes.forEach(function(route) {
      delete route.config.response;
    });
  }

  // require json by default
  routes.forEach(function(route) {
    var method = route.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      if (!route.config.payload) {
        route.config.payload = { allow: 'application/json' };
      }
      logger.verbose('route.payload', {
        url: route.url,
        method: method,
        payload: route.config.payload
      });
    }
  });

  server.route(routes);

  // hapi internal logging: server and request
  server.on('log', function onServerLog(ev, tags) {
    if (tags.error && tags.implementation) {
      hapiLogger.critical('error.uncaught', { tags: ev.tags, error: ev.data });
    }
  });

  server.on('request', function onRequestLog(req, ev, tags) {
    if (tags.error && tags.implementation) {
      hapiLogger.critical('error.uncaught', { tags: ev.tags, error: ev.data });
    }
  });

  server.ext('onPreResponse', function onPreResponse(request, next) {
    var response = request.response;
    if (response.isBoom) {
      response = AppError.translate(response);
    }
    summary(request, response);
    next(response);
  });

  return server;
};
