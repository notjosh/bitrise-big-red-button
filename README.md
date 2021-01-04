# Bitrise Big Red Button

A simple, web-based, big red button to kick off a build on Bitrise (and allow cancelling existing build). Allows non-technical folks to kick off builds, instead of having to log into Bitrise.

It's protected by auth0, to keep things safe. It's up to you how you want to limit that. I've got an allow list (via `ALLOWED_IDENTITIES` env var) to only let a few people in, but you might want to expand that out to an org more generically.

## Development

It's a fairly simple Node.js app, which uses [Fastify](https://www.fastify.io/) and [art-template](https://aui.github.io/art-template/) to orchestrate auth (via auth0) and Bitrise.

Refer to `.env.sample` to figure out what you need to get things running in your own `.env`

Run `nodemon server.js` and open `https://localhost:3000/` to get going.

## Deployment

I've got this running on Heroku without any headaches, via `yarn start`. ymmv with other providers, but should be fine. You may need to supply `PORT` env var, if it doesn't already?

🐴
