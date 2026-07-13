'use strict';

const { createApplication } = require('./src/create-application');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;

function configuredPort(value) {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  return port;
}

const host = process.env.HOST || DEFAULT_HOST;
const port = configuredPort(process.env.PORT);
const testMode = process.env.DEMO_TEST_MODE === '1';
const server = createApplication({
  host,
  testMode,
  testToken: process.env.DEMO_TEST_TOKEN,
  runtime: {
    publicBaseUrl:
      process.env.PUBLIC_BASE_URL || `http://${host}:${port}`,
  },
});

server.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}/`);
});
