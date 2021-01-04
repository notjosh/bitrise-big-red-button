'use strict';

require('dotenv').config();
const path = require('path');
const querystring = require('querystring');
const url = require('url');

const bitrise = require('@lifeomic/bitrise');
const fastify = require('fastify')({ logger: true });

const client = bitrise({ token: process.env.BITRISE_TOKEN }).app({
  slug: process.env.BITRISE_APP_SLUG,
});

const identities = process.env.ALLOWED_IDENTITIES.split(',')
  .map((s) => s.trim())
  .filter((s) => s !== '');

const buildForSlug = (buildSlug) => {
  const builder = require('@lifeomic/bitrise/src/build');

  return builder({
    appSlug: client.slug,
    buildSlug,
    client: require('./src/axios-bitrise-client')(process.env.BITRISE_TOKEN),
    buildInfo: {},
  });
};

fastify.register(require('fastify-helmet'), {
  contentSecurityPolicy:
    process.env.NODE_ENV === 'development' ? false : undefined,
});
fastify.register(require('fastify-cookie'));
fastify.register(require('./src/fastify-auth-cookie-to-bearer'), {
  name: 'token',
});
fastify.register(require('fastify-static'), {
  root: path.join(__dirname, 'public'),
});
fastify.register(require('fastify-static'), {
  root: path.join(__dirname, 'node_modules/modern-css-reset/dist'),
  prefix: '/modern-css-reset/',
  decorateReply: false,
});
fastify.register(require('fastify-oauth2'), {
  name: 'auth0',
  scope: ['openid', 'profile', 'name', 'picture'],
  credentials: {
    client: {
      id: process.env.AUTH0_CLIENT_ID,
      secret: process.env.AUTH0_CLIENT_SECRET,
    },
    auth: {
      tokenHost: `https://${process.env.AUTH0_DOMAIN}/`,
      authorizePath: '/authorize',
      tokenPath: '/oauth/token',
    },
  },
  startRedirectPath: '/login',
  callbackUri: `${process.env.PROJECT_URL}login/callback`,
});
fastify.register(require('fastify-auth0-verify'), {
  domain: `https://${process.env.AUTH0_DOMAIN}/`,
  secret: process.env.AUTH0_CLIENT_SECRET,
  audience: process.env.AUTH0_CLIENT_ID,
});
fastify.register(require('fastify-sensible'), { errorHandler: false });
fastify.register(require('fastify-formbody'));
fastify.register(require('point-of-view'), {
  engine: {
    'art-template': require('art-template'),
  },
  templates: 'templates',
  options: {
    htmlMinifierOptions: {
      collapseWhitespace: true,
      conservativeCollapse: true, // need this, as some of the rule parsing ("{{ }}") breaks whitespace sometimes, for some reason?
      minifyCSS: true,
      minifyJS: true,
      ignoreCustomFragments: [],
    },
  },
});

fastify.addHook('preHandler', function (req, reply, done) {
  reply.locals = {
    user: req.user,
  };

  done();
});

fastify.get('/', async (req, reply) => {
  try {
    // total hack, to allow single endpoit to be both auth'd and non
    await fastify.authenticate(req, reply);
  } catch (error) {}

  if (req.user == null) {
    return reply.view('./whoareyou.art');
  }

  const result = await client.listBuilds({
    sort_by: 'created_at',
    status: 0,
    limit: 5,
  });
  const builds = await Promise.all(
    (result.builds || []).map(async (build) => await build.describe())
  );

  return reply.view('./home.art', { builds, user: req.user });
});

const authenticated = (fastify, options, done) => {
  fastify.post(
    '/new-build',
    { preValidation: [fastify.authenticate] },
    async (req, reply) => {
      const existingBuilds = await client.listBuilds({
        status: 0, // "not finished"
        sort_by: 'created_at',
        limit: 5,
      });

      for (let i = 0; i < existingBuilds.builds.length; i += 1) {
        let build = existingBuilds.builds[i];

        await build.abort({
          reason: 'obsolete, running new build via big red button',
          skipNotifications: true,
        });
      }

      const { buildSlug } = await client.triggerBuild({
        branch: 'main',
        workflow: 'primary',
      });

      return reply.redirect(`/build/${buildSlug}`);
    }
  );

  fastify.get(
    '/last',
    { preValidation: [fastify.authenticate] },
    async (req, reply) => {
      const result = await client.listBuilds({
        sort_by: 'created_at',
        limit: 1,
      });

      if (result.builds.length === 0) {
        throw fastify.httpErrors.notFound();
      }

      return reply.redirect(`/build/${result.builds[0].buildSlug}`);
    }
  );

  fastify.get(
    '/build/:buildSlug',
    { preValidation: [fastify.authenticate] },
    async (req, reply) => {
      const builder = buildForSlug(req.params.buildSlug);

      try {
        const build = await builder.describe();
        return reply.view('./build.art', { build });
      } catch {}

      throw fastify.httpErrors.notFound();
    }
  );

  fastify.post(
    '/build/:buildSlug/abort',
    { preValidation: [fastify.authenticate] },
    async (req, reply) => {
      const builder = buildForSlug(req.params.buildSlug);

      try {
        const build = await builder.describe();
        await builder.abort({
          reason: 'cancelled via big red button',
          skipNotifications: true,
        });

        return reply.redirect(`/build/${build.slug}`);
      } catch (e) {}

      throw fastify.httpErrors.notFound();
    }
  );

  fastify.get(
    '/me',
    { preValidation: [fastify.authenticate] },
    async (req, reply) => {
      return reply.view('./me.art');
    }
  );
  done();
};

fastify.register(authenticated);

fastify.get('/login/callback', async (req, reply) => {
  const token = await fastify.auth0.getAccessTokenFromAuthorizationCodeFlow(
    req
  );

  req.injectToken(token.id_token);

  const decoded = req.jwtDecode();
  if (!identities.includes(decoded.sub)) {
    throw fastify.httpErrors.unauthorized();
  }

  await req.jwtVerify();

  reply.setCookie('token', token.id_token, {
    domain: process.env.PROJECT_DOMAIN,
    path: '/',
    secure: process.env.NODE_ENV !== 'development',
    httpOnly: true,
    sameSite: 'lax',
  });

  reply.redirect('/');
});

fastify.get('/logout', (req, reply) => {
  reply.clearCookie('token', {
    domain: process.env.PROJECT_DOMAIN,
    path: '/',
    secure: process.env.NODE_ENV !== 'development',
    httpOnly: true,
    sameSite: 'lax',
  });

  const logoutURL = new url.URL(
    `https://${process.env.AUTH0_DOMAIN}/v2/logout`
  );
  const searchString = querystring.stringify({
    client_id: process.env.AUTH0_CLIENT_ID,
    returnTo: process.env.PROJECT_URL,
  });
  logoutURL.search = searchString;

  reply.redirect(logoutURL.toString());
});

fastify.setNotFoundHandler((req, reply) => {
  reply.code(404).view('./404.art');
});

fastify.setErrorHandler((error, req, reply) => {
  fastify.log.error(error);
  reply.view('./error.art', {
    message: error.message,
    statusCode: reply.statusCode,
  });
});

const start = async () => {
  try {
    await fastify.listen({
      host: process.env.NODE_ENV === 'development' ? '127.0.0.1' : '::',
      port: process.env.PORT || 3000,
    });
    fastify.log.info(`server listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
