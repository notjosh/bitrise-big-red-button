'use strict';

require('dotenv').config();
const bitrise = require('@lifeomic/bitrise');
const fastify = require('fastify')({ logger: true });

const client = bitrise({ token: process.env.BITRISE_TOKEN }).app({
  slug: process.env.BITRISE_APP_SLUG,
});

const buildForSlug = (buildSlug) => {
  const builder = require('@lifeomic/bitrise/src/build');

  return builder({
    appSlug: client.slug,
    buildSlug,
    client: require('./src/axios-bitrise-client')(process.env.BITRISE_TOKEN),
    buildInfo: {},
  });
};

fastify.register(require('fastify-formbody'));
fastify.register(require('point-of-view'), {
  engine: {
    'art-template': require('art-template'),
  },
  templates: 'templates',
});

fastify.get('/', async (req, reply) => {
  const result = await client.listBuilds({
    sort_by: 'created_at',
    status: 0,
    limit: 5,
  });
  const builds = await Promise.all(
    (result.builds || []).map(async (build) => await build.describe())
  );

  return reply.view('./index.art', { builds });
});

fastify.post('/new-build', async (req, reply) => {
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
});

fastify.get('/last', async (req, reply) => {
  const result = await client.listBuilds({
    sort_by: 'created_at',
    limit: 1,
  });

  if (result.builds.length === 0) {
    return reply.callNotFound();
  }

  return reply.redirect(`/build/${result.builds[0].buildSlug}`);
});

fastify.get('/build/:buildSlug', async (req, reply) => {
  const builder = buildForSlug(req.params.buildSlug);
  const build = await builder.describe();

  if (build == null) {
    return reply.callNotFound();
  }

  return reply.view('./build.art', { build });
});

fastify.post('/build/:buildSlug/abort', async (req, reply) => {
  const builder = buildForSlug(req.params.buildSlug);
  const build = await builder.describe();

  if (build == null) {
    return reply.callNotFound();
  }

  try {
    await builder.abort({
      reason: 'cancelled via big red button',
      skipNotifications: true,
    });
  } catch (e) {}

  return reply.redirect(`/build/${build.slug}`);
});

const start = async () => {
  try {
    await fastify.listen(3000);
    fastify.log.info(`server listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
