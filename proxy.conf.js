require('dotenv').config();

console.log('--- DEBUG PROXY ---');
console.log('BACKEND_URL original:', process.env.BACKEND_URL);

let target = (process.env.BACKEND_URL || "http://localhost:8000").trim().replace(/\/$/, '');

// Redirigir localhost a host.docker.internal si corre en contenedor Docker
const fs = require('fs');
const enDocker = fs.existsSync('/.dockerenv') || Boolean(process.env.HOSTNAME && process.env.NODE_VERSION);
if (enDocker && (target.includes('localhost') || target.includes('127.0.0.1'))) {
  target = target.replace('localhost', 'host.docker.internal').replace('127.0.0.1', 'host.docker.internal');
}

console.log('BACKEND_URL target:', target);
console.log('-------------------');

const PROXY_CONFIG = [
  {
    context: [
      "/api",
      "/users",
      "/SolicitudVacaciones",
      "/EU_Area",
      "/EU_Puesto",
      "/Empresa",
      "/NewAPI",
      "/admin",
      "/api-proxy"
    ],
    target: target,
    secure: false,
    changeOrigin: true,
    logLevel: "debug"
  }
];

module.exports = PROXY_CONFIG;

