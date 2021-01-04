const fp = require('fastify-plugin');

function injectToken(token, next) {
  const req = this;
  if (token != null) {
    req.headers.authorization = `Bearer ${token}`;
  }

  if (next != null) {
    next();
  }
}

const onRequest = (fastify, options, next) => {
  return function fastifyCookieOnReqHandler(req, reply, next) {
    if (req.cookies == null) {
      throw new Error(
        'cookies not available. have you forgotten to register `fastify.cookie` before this?'
      );
    }

    // don't clobber existing headers
    if (req.headers.authorization != null) {
      return next();
    }

    // make sure we have a cookie to search for
    if (options.name == null) {
      return next();
    }

    injectToken.bind(req)(req.cookies[options.name], next);
  };
};

const impl = (fastify, options, next) => {
  fastify.decorateRequest('injectToken', injectToken);
  fastify.addHook('onRequest', onRequest(fastify, options, next));

  next();
};

module.exports = fp(impl, {
  fastify: '>=3.0.0-alpha.1',
  name: 'fastify-auth-cookie-to-bearer',
});
