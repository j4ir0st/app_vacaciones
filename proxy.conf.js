require('dotenv').config();

console.log('--- DEBUG PROXY ---');
console.log('BACKEND_URL:', process.env.BACKEND_URL);
console.log('-------------------');

const PROXY_CONFIG = [
  {
    context: [
      "/api-proxy"
    ],
    target: process.env.BACKEND_URL || "https://api.tu-servidor.com",
    secure: true,
    changeOrigin: true,
    pathRewrite: {
      "^/api-proxy": ""
    },
    logLevel: "debug"
  }
];

module.exports = PROXY_CONFIG;
