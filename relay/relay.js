#!/usr/bin/env node
// Servidor de salas independiente para compartir kneeboards entre pilotos.
// Uso:  npm install ws  &&  node relay.js [puerto]
// Los pilotos ponen en Ajustes > Vuelo compartido:  ws://IP_DEL_SERVIDOR:7790
const { createRelay } = require('./relay-core');

const port = Number(process.argv[2] || process.env.PORT || 7790);
createRelay({ port, log: (m) => console.log(new Date().toISOString(), m) });
console.log(`Sala de LF Kneeboard escuchando en el puerto ${port}`);
