const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { patchAchievementServer, patchAchievementInterface } = require('../achievement-patches');
const { evaluateMoveAchievements, unlockMoveAchievements } = require('../achievements');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const labels = Array.from({ length: 15 }, () => Array(15).fill(''));
labels[0][0] = '3V';
labels[0][1] = '2B';
const placements = Array.from({ length: 7 }, (_, index) => ({ x: index, y: 0 }));
const placementsMap = new Map(placements.map((placement, index) => [
  `${placement.x},${placement.y}`,
  { ch: index === 0 ? 'ā' : 'a', blank: index === 0 },
]));
const room = { mult: { label: labels }, achievementUnlocked: new Map() };
const words = [{ word: 'ābolmaize' }, { word: 'ala' }, { word: 'mala' }];

const evaluated = evaluateMoveAchievements({ room, total: 112, words, placements, placementsMap });
const ids = new Set(evaluated.map((item) => item.id));
for (const id of ['all-seven', 'score-100', 'three-words', 'bonus-chain', 'blank-tile', 'long-word']) {
  assert(ids.has(id), `Nav sasnieguma ${id}.`);
}
assert(!ids.has('score-50'), '100 punktu sasniegums nedrīkst vienlaikus dublēt 50 punktu sasniegumu.');

const firstUnlock = unlockMoveAchievements({ room, playerId: 'p1', playerName: 'Mikus', total: 112, words, placements, placementsMap });
const secondUnlock = unlockMoveAchievements({ room, playerId: 'p1', playerName: 'Mikus', total: 112, words, placements, placementsMap });
assert(firstUnlock.length >= 6, 'Pirmajā reizē sasniegumi netika atbloķēti.');
assert(secondUnlock.length === 0, 'Sasniegums vienam spēlētājam sesijā nedrīkst atkārtoties.');

const fixture = `
const io={to(){return{emit(){}}}};
const { createWordValidator } = require("./word-validator");
const { verifyWordStrict } = createWordValidator({ httpGet });
function makeRoom(){return{
    rematchVotes: new Set(),
    mult:{label:[]}
}}
function human(){
    room.lastMove = { by:socket.id, byName:player.name, total:res.total, words:res.words, hits, at:Date.now() };
    io.to(roomId).emit("effect",{type:"accepted", by:socket.id, byName:player.name, total:res.total, words:res.words, hits});
}
function bot(){
    current.lastMove={by:botId,byName:bot.name,total:result.total,words:result.words,at:Date.now()};
    for(const item of result.words.filter(item=>item.word!=="BONUS")){}
    io.to(roomId).emit("effect",{type:"accepted",by:botId,byName:bot.name,total:result.total,words:result.words,hits:[]});
}
`;
const patchedServer = patchAchievementServer(fixture);
assert(patchedServer.includes('type:"achievements"'), 'Servera ielāpā nav sasniegumu efekta.');
assert(patchedServer.includes('achievementUnlocked: new Map()'), 'Istabai nav sasniegumu stāvokļa.');
assert(patchedServer.includes('emitMoveAchievements(roomId,room,socket.id'), 'Cilvēka gājiens nav pieslēgts sasniegumiem.');
assert(patchedServer.includes('emitMoveAchievements(roomId,current,botId'), 'Datora gājiens nav pieslēgts sasniegumiem.');
new vm.Script(patchedServer, { filename: 'achievement-server-fixture.js' });

const patchedHtml = patchAchievementInterface('<!doctype html><html><head></head><body></body></html>');
assert(patchedHtml.includes('/achievements.css'), 'Interfeisā nav sasniegumu stilu.');
assert(patchedHtml.includes('/achievements-ui.js'), 'Interfeisā nav sasniegumu skripta.');
new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'public', 'achievements-ui.js'), 'utf8'), { filename: 'achievements-ui.js' });

console.log('✓ Sasniegumu noteikumi');
console.log('✓ Sasniegumi neatkārtojas vienā istabas sesijā');
console.log('✓ Cilvēka un datora gājiena sasniegumu pieslēgums');
console.log('✓ Dejojošā burtu burvja interfeiss');