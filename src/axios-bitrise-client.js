'use strict';

const assert = require('assert');
const axios = require('axios');
const axiosRetry = require('axios-retry');

// @lifeomic/bitrise doesn't expose the client (instead using bound args), so we recreate it here
//
// could be a fun source of subtle bugs, but there's not much choice right now

const maker = (token) => {
  assert(token, 'An access token is required');

  const client = axios.create({
    baseURL: 'https://api.bitrise.io/v0.1',
    headers: { Authorization: `token ${token}` },
  });

  axiosRetry(client, { retryDelay: axiosRetry.exponentialDelay });

  return client;
};

module.exports = maker;
