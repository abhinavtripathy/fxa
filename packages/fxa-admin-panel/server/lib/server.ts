/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import express from 'express';
import path from 'path';
import serveStatic from 'serve-static';
import helmet from 'helmet';
import config from '../config';
import fs from 'fs';
import { noRobots } from './no-robots';
import log from './logging';

const logger = log('server.main');
const proxyUrl = config.get('proxyStaticResourcesFrom');

const app = express();

// TO DO: CSP, CORS, other security-related tasks (#4312)

const CLIENT_CONFIG = {
  env: config.get('env'),
  servers: {
    admin: {
      url: config.get('servers.admin.url'),
    },
  },
};

app.use(
  helmet.frameguard({
    action: 'deny',
  }),
  helmet.xssFilter(),
  helmet.noSniff(),
  noRobots as express.RequestHandler
);

app.disable('x-powered-by');

const hstsEnabled = config.get('hstsEnabled');
if (hstsEnabled) {
  app.use(
    helmet.hsts({
      force: true,
      includeSubDomains: true,
      maxAge: config.get('hstsMaxAge'),
    })
  );
}

function injectMetaContent(html: any, metaContent: any = {}) {
  let result = html;

  Object.keys(metaContent).forEach(k => {
    result = result.replace(
      k,
      encodeURIComponent(JSON.stringify(metaContent[k]))
    );
  });

  return result;
}

function injectHtmlConfig(html: any, config: any) {
  return injectMetaContent(html, {
    __SERVER_CONFIG__: config,
  });
}

// Note - the static route handlers must come last
// because the proxyUrl handler's app.use('/') captures
// all requests that match no others.
if (proxyUrl) {
  logger.info('static.proxying', { url: proxyUrl });
  const proxy = require('express-http-proxy');
  app.use(
    '/',
    proxy(proxyUrl, {
      userResDecorator: function(
        proxyRes: any,
        proxyResData: any,
        userReq: any /*, userRes*/
      ) {
        const contentType = proxyRes.headers['content-type'];
        if (!contentType || !contentType.startsWith('text/html')) {
          return proxyResData;
        }
        if (userReq.url.startsWith('/sockjs-node/')) {
          // This is a development WebPack channel that we don't want to modify
          return proxyResData;
        }
        const body = proxyResData.toString('utf8');
        return injectHtmlConfig(body, CLIENT_CONFIG);
      },
    })
  );
} else {
  const STATIC_DIRECTORY = path.join(
    __dirname,
    '..',
    '..',
    config.get('staticResources.directory')
  );

  const STATIC_INDEX_HTML = fs.readFileSync(
    path.join(STATIC_DIRECTORY, 'index.html'),
    { encoding: 'UTF-8' }
  );

  ['/', '/email-blocks'].forEach(route => {
    // FIXME: should set ETag, Not-Modified:
    app.get(route, (req, res) => {
      res.send(injectHtmlConfig(STATIC_INDEX_HTML, CLIENT_CONFIG));
    });
  });

  logger.info('static.directory', { directory: STATIC_DIRECTORY });
  app.use(
    serveStatic(STATIC_DIRECTORY, {
      maxAge: config.get('staticResources.maxAge'),
    })
  );
}

export async function createServer() {
  const port = config.get('listen.port');
  const host = config.get('listen.host');
  logger.info('server.starting', { port });
  app.listen(port, host, error => {
    if (error) {
      logger.error('server.start.error', { error });
      return;
    }

    logger.info('server.started', { port });
  });
}
