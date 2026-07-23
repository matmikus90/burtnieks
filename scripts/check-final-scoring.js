const vm = require('vm');
const { applyEmptyRackScoring } = require('../final-scoring');
const { patchFinalScoringServer, patchFinalScoringInterface } = require('../final-score-patches');
function assert(condition, message) { if (!condition) throw new Error(message); }

const players = new Map([
  ['madara', { name: 'Madara', score: 269, rack: [{ pts: 5 }] }],
  ['mikalis', { name: 'mikalis', score: 255, rack: [{ pts: 10 }, { pts: 2 }] }],
  ['alisuks', { name: 'Alisuks', score: 128, rack: [] }],
]);
const result = applyEmptyRackScoring(players, 'alisuks');
assert(result.transfer === 17, 'Izlicējam nav pieskaitīta pretinieku atlikušo kauliņu summa.');
assert(players.get('madara').score === 264, 'Madara gala punktiem jābūt 264.');
assert(players.get('mikalis').score === 243, 'mikalis gala punktiem jābūt 243.');
assert(players.get('alisuks').score === 145, 'Alisuks gala punktiem jābūt 145.');
assert(result.winnerName === 'Madara' && result.winnerScore === 264, 'Uzvarētājam jābūt lielākā gala rezultāta īpašniekam.');
assert(result.finisherName === 'Alisuks', 'Jāsaglabā atsevišķi spēlētājs, kurš izlicis visus kauliņus.');

const fixture = `
const { unlockMoveAchievements } = require("./achievements");
function endByEmptyRack(roomId, winnerId){ return winnerId; }

function isParticipant(room, sid){ return true; }
`;
const patchedServer = patchFinalScoringServer(fixture);
assert(patchedServer.includes('applyEmptyRackScoring(room.players,finisherId)'), 'Serveris neizmanto korekto gala aprēķinu.');
assert(patchedServer.includes('winnerId:scoring.winnerId'), 'Atkārtotās partijas sākumam netiek saglabāts īstais uzvarētājs.');
new vm.Script(patchedServer, { filename: 'final-scoring-server-fixture.js' });

const htmlFixture = `<!doctype html><html><head></head><body><script>
function showGameOver(e){old()}
  $('chatToggle').onclick=()=>{};
</script></body></html>`;
const patchedHtml = patchFinalScoringInterface(htmlFixture);
assert(patchedHtml.includes('/final-scoring.css'), 'Nav gala punktu noformējuma stilu.');
assert(patchedHtml.includes('Saņemts no pārējiem'), 'Beigu logā nav saņemto punktu sadalījuma.');
assert(patchedHtml.includes('Plauktā palika'), 'Beigu logā nav atņemto punktu sadalījuma.');

console.log('✓ Pretiniekiem atņem plauktā palikušo kauliņu punktus');
console.log('✓ Izlicējam pieskaita visu atņemto punktu summu');
console.log('✓ Uzvarētāju nosaka pēc lielākā gala rezultāta');
console.log('✓ Beigu logs rāda + un − korekcijas');
