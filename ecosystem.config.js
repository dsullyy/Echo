require('dotenv').config();

module.exports = {
  apps : [{
    name: 'my-app',
    script: 'index.js',

    // Options reference: https://pm2.keymetrics.io/docs/usage/application-declaration/
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      MONGODB_URI: process.env.MONGODB_URI
    },
    env_production: {
      NODE_ENV: 'production',
      MONGODB_URI: process.env.MONGODB_URI
    }
  }],
};
