const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { patchServer, patchInterface } = require('../runtime-patches');
const { patchAchievementServer, patchAchievementInterface } = require('../achievement-patches');
const { patchWordVoteServer, patchWordVoteInterface } = require('../word-vote-patches');
const { patchFinalScoringServer, patchFinalScoringInterface } = require('../final-score-patches');
const { patchLayoutConnectionServer, patchLayoutConnectionInterface } = require('../layout-connection-patches');

function assert(condition, message) { if (!condition) throw new Error(message); }
const root = path.join(__dirname, '..');

function readBundle(relativePath) {
  const encoded = fs.readFileSync(path.join(root, relativePath), 'utf8').trim();
  return zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
}
function localize(source) {
  return source
    .replaceAll('label[y][x] = "TW";', 'label[y][x] = "3V";')
    .replaceAll('label[y][x] = (x===7&&y===7) ? "★" : "DW";', 'label[y][x] = (x===7&&y===7) ? "★" : "2V";')
    .replaceAll('label[y][x] = "TL";', 'label[y][x] = "3B";')
    .replaceAll('label[y][x] = "DL";', 'label[y][x] = "2B";')
    .replaceAll('.cell[data-m=TW]', '.cell[data-m="3V"]')
    .replaceAll('.cell[data-m=DW]', '.cell[data-m="2V"]')
    .replaceAll('.cell[data-m=TL]', '.cell[data-m="3B"]')
    .replaceAll('.cell[data-m=DL]', '.cell[data-m="2B"]');
}
function patchBoardGridInterface(source) {
  if (!source.includes('/board-grid.css')) source = source.replace('</head>', '<link rel="stylesheet" href="/board-grid.css">\n</head>');
  if (!source.includes('/board-grid.js')) source = source.replace('</body>', '<script src="/board-grid.js"></script>\n</body>');
  return source;
}

const generatedServer = patchLayoutConnectionServer(
  patchFinalScoringServer(
    patchWordVoteServer(
      patchAchievementServer(
        patchServer(localize(readBundle('server.bundle.gz.b64')))
      )
    )
  )
);
new vm.Script(generatedServer, { filename: 'generated-runtime-server.js' });
assert(generatedServer.includes('app.get("/healthz"'), 'Gala serverī nav /healthz pārbaudes maršruta.');

const generatedHtml = patchLayoutConnectionInterface(
  patchFinalScoringInterface(
    patchBoardGridInterface(
      patchWordVoteInterface(
        patchAchievementInterface(
          patchInterface(localize(readBundle('public/index.bundle.gz.b64')))
        )
      )
    )
  )
);
assert(generatedHtml.includes("transports:['websocket','polling']"), 'Socket.IO neizmēģina WebSocket un polling transportus.');
assert(generatedHtml.includes('tryAllTransports:true'), 'Nav Socket.IO transportu rezerves varianta.');
assert(generatedHtml.includes('/layout-connection.css'), 'Nav jaunā izkārtojuma stilu.');
assert(generatedHtml.includes('/layout-connection.js'), 'Nav jaunā izkārtojuma skripta.');
assert(generatedHtml.includes('Pārbaudi Burtnieks servisu vai Nginx'), 'Nav saprotama savienojuma kļūdas paziņojuma.');

for (const match of generatedHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  const code = match[1].trim();
  if (code) new vm.Script(code, { filename: 'generated-inline-client.js' });
}

const layoutJs = fs.readFileSync(path.join(root, 'public', 'layout-connection.js'), 'utf8');
const layoutCss = fs.readFileSync(path.join(root, 'public', 'layout-connection.css'), 'utf8');
new vm.Script(layoutJs, { filename: 'layout-connection.js' });
assert(layoutJs.includes('game-top-strip'), 'Lobija paneļi netiek pārvietoti augšā.');
assert(layoutJs.includes("fetch('/healthz'"), 'Klients nediagnosticē servera sasniedzamību.');
assert(layoutCss.includes('grid-template-columns:minmax(0,1fr) minmax(285px,325px)'), 'Sānu kolonna nav sašaurināta.');
assert(layoutCss.includes('#lobbyPanel'), 'Lobija augšējais izkārtojums nav noformēts.');

console.log('✓ Gala servera un klienta kods ir sintaktiski derīgs');
console.log('✓ Lobija informācija pārvietota augšējā joslā');
console.log('✓ Sānu kolonna padarīta kompaktāka');
console.log('✓ Socket.IO izmēģina WebSocket un polling rezerves transportu');
console.log('✓ Savienojuma kļūda atšķir servera un Nginx problēmu');
