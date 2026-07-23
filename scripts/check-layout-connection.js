const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { patchLayoutConnectionServer, patchLayoutConnectionInterface } = require('../layout-connection-patches');

function assert(condition, message) { if (!condition) throw new Error(message); }
const root = path.join(__dirname, '..');

const serverFixture = 'const app={get(){},use(){}};app.use(express.static("public"));';
const patchedServer = patchLayoutConnectionServer(serverFixture);
assert(patchedServer.includes('app.get("/healthz"'), 'Nav /healthz pārbaudes maršruta.');

const socketInit = "const socket=io({reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:500,reconnectionDelayMax:4000});";
const htmlFixture = `<!doctype html><html><head></head><body><script>${socketInit}\n  socket.on('connect_error',err=>{$('connection').textContent='Nav savienojuma';toast(\`Nav savienojuma ar serveri: \${err.message}\`)});\n  socket.on('online',n=>{});</script></body></html>`;
const patchedHtml = patchLayoutConnectionInterface(htmlFixture);
assert(patchedHtml.includes("transports:['websocket','polling']"), 'Socket.IO neizmēģina WebSocket un polling transportus.');
assert(patchedHtml.includes('tryAllTransports:true'), 'Nav transportu rezerves varianta.');
assert(patchedHtml.includes('/layout-connection.css'), 'Nav jaunā izkārtojuma stilu.');
assert(patchedHtml.includes('/layout-connection.js'), 'Nav jaunā izkārtojuma skripta.');
assert(patchedHtml.includes('Pārbaudi Burtnieks servisu vai Nginx'), 'Nav saprotama savienojuma kļūdas paziņojuma.');

const layoutJs = fs.readFileSync(path.join(root, 'public', 'layout-connection.js'), 'utf8');
const layoutCss = fs.readFileSync(path.join(root, 'public', 'layout-connection.css'), 'utf8');
new vm.Script(layoutJs, { filename: 'layout-connection.js' });
assert(layoutJs.includes('game-top-strip'), 'Lobija paneļi netiek pārvietoti augšā.');
assert(layoutJs.includes("fetch('/healthz'"), 'Klients nediagnosticē servera sasniedzamību.');
assert(layoutCss.includes('grid-template-columns:minmax(0,1fr) minmax(285px,325px)'), 'Sānu kolonna nav sašaurināta.');
assert(layoutCss.includes('#lobbyPanel'), 'Lobija augšējais izkārtojums nav noformēts.');

console.log('✓ Lobija informācija pārvietota augšējā joslā');
console.log('✓ Sānu kolonna padarīta kompaktāka');
console.log('✓ Socket.IO izmēģina WebSocket un polling rezerves transportu');
console.log('✓ Savienojuma kļūda atšķir servera un Nginx problēmu');
