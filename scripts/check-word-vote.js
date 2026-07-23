const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { patchServer, patchInterface } = require('../runtime-patches');
const { patchAchievementServer, patchAchievementInterface } = require('../achievement-patches');
const { patchWordVoteServer, patchWordVoteInterface } = require('../word-vote-patches');

const root = path.join(__dirname, '..');
function assert(condition, message) { if (!condition) throw new Error(message); }
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

const serverSource = patchWordVoteServer(patchAchievementServer(patchServer(localize(readBundle('server.bundle.gz.b64')))));
new vm.Script(serverSource, { filename: 'word-vote-runtime-server.js' });

for (const marker of [
  'socket.on("startWordVote"',
  'socket.on("castWordVote"',
  'socket.on("cancelWordVote"',
  'pendingWordVote: null',
  'WORD_VOTE_DURATION_MS = 30000',
  'reason!=="Vārds nav atrasts Tēzaurā"',
  'voterIds.every(id=>vote.votes.get(id)===true)',
  'applyUnanimouslyAcceptedMove',
  'validateAndScoreMove(room,vote.by,vote.placements)',
]) assert(serverSource.includes(marker), `Nav vārdu balsošanas marķiera: ${marker}`);

assert(serverSource.includes('isHumanWordVoter'), 'Datora spēlētājs nedrīkst būt balsotājs.');
assert(serverSource.includes('rejectWordVote(roomId,room,vote'), 'Viena noraidoša balss neaptur balsojumu.');
assert(serverSource.includes('stopTurnTimer(room)'), 'Balsošanas laikā netiek apturēts taimeris.');
assert(serverSource.includes('socket.on("swapBlank",({roomId,x,y,rackTileId})=>{\n    const room=rooms.get(roomId);\n    if(!room||!room.started) return;\n    if(room.pendingWordVote)'), 'Tukšā kauliņa maiņa nav bloķēta balsošanas laikā.');
assert(serverSource.includes('if(room.pendingWordVote) return;\n  scheduleBotTurn(roomId);'), 'Bots nav apturēts balsošanas laikā.');

const htmlSource = patchWordVoteInterface(patchAchievementInterface(patchInterface(localize(readBundle('public/index.bundle.gz.b64')))));
assert(htmlSource.includes('/word-vote.css'), 'Interfeisā nav balsošanas stilu.');
assert(htmlSource.includes('/word-vote.js'), 'Interfeisā nav balsošanas skripta.');
assert(htmlSource.includes('word-vote-chat'), 'Balsošanas čata ziņām nav īpaša noformējuma.');
new vm.Script(fs.readFileSync(path.join(root, 'public', 'word-vote.js'), 'utf8'), { filename: 'word-vote.js' });

console.log('✓ Tēzaurā neatrasta vārda balsošanas piedāvājums');
console.log('✓ Vienbalsīgs visu pārējo cilvēku spēlētāju apstiprinājums');
console.log('✓ Viena noraidoša balss un autora atcelšana');
console.log('✓ Gājiena atkārtota validācija pirms pieņemšanas');
console.log('✓ Balsošanas panelis čatā un taimera apturēšana');
