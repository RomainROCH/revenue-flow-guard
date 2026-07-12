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
const server = createApplication();

server.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}/`);
});
