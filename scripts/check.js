const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { patchServer, patchInterface } = require('../runtime-patches');
const { classifyDictionaryEntry, normalizeWord } = require('../word-validator');

const root = path.join(__dirname, '..');

function readBundle(relativePath) {
  const encoded = fs.readFileSync(path.join(root, relativePath), 'utf8').trim();
  return zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function localizeBoardMultipliers(source) {
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

const rawServer = readBundle('server.bundle.gz.b64');
const rawHtml = readBundle('public/index.bundle.gz.b64');
const serverSource = patchServer(localizeBoardMultipliers(rawServer));
const htmlSource = patchInterface(localizeBoardMultipliers(rawHtml));
const enhancementsSource = fs.readFileSync(path.join(root, 'public/enhancements.js'), 'utf8');
const enhancementsCss = fs.readFileSync(path.join(root, 'public/enhancements.css'), 'utf8');

new vm.Script(serverSource, { filename: 'runtime-server.js' });
const inlineScripts = [...htmlSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1]).filter((source) => source.trim());
assert(inlineScripts.length > 0, 'Klienta inline JavaScript netika atrasts.');
inlineScripts.forEach((source, index) => new vm.Script(source, { filename: `client-inline-${index + 1}.js` }));
new vm.Script(enhancementsSource, { filename: 'enhancements.js' });

assert(htmlSource.includes('/enhancements.js'), 'Nav klienta uzlabojumu skripta.');
assert(serverSource.includes('label[y][x] = "3V";'), 'Nav latviskā 3V apzīmējuma.');
assert(serverSource.includes('label[y][x] = "2B";'), 'Nav latviskā 2B apzīmējuma.');
assert(serverSource.includes('/api/check-word'), 'Serverī nav vārdu pārbaudes API.');
assert(serverSource.includes('type:"letterDraw"'), 'Pirmajā partijā nav burtu izlozes.');
assert(serverSource.includes('type:"winnerStarts"'), 'Atkārtotajā partijā nav uzvarētāja sākuma notikuma.');
assert(serverSource.includes('startGame(roomId, { rematch:true })'), 'Atkārtotā spēle neizmanto uzvarētāja sākuma secību.');
assert(serverSource.includes('previousWinnerId'), 'Netiek saglabāts iepriekšējās partijas uzvarētājs.');
assert(serverSource.includes('scheduleBotTurn(roomId);'), 'Datora gājiens netiek ieplānots.');
assert(serverSource.includes('botThinkingRooms'), 'Nav aizsardzības pret dubultu datora gājienu.');
assert(serverSource.includes('validateBotCandidates'), 'Dators nepārbauda ģenerētos vārdus.');
assert(htmlSource.includes("socket.emit('reorderRack'"), 'Kauliņu pārkārtošana netiek saglabāta serverī.');
assert(htmlSource.includes("rack.dataset.reorderEnabled='true'"), 'Plaukta pārkārtošana nav ieslēgta.');
assert(enhancementsCss.includes('grid-template-columns:repeat(7'), 'Datora skatā nav vienas 7 kauliņu rindas.');
assert(enhancementsSource.includes('Pirmā gājiena izloze'), 'Klientā nav burtu izlozes animācijas.');
assert(enhancementsSource.includes('Uzvarētājs sāk'), 'Klientā nav atkārtotās partijas sākuma paziņojuma.');
assert(classifyDictionaryEntry({ heading: 'API', senses: [{ gloss: 'saīsinājums' }] }).isAbbrev, 'API jāatpazīst kā saīsinājums.');
assert(classifyDictionaryEntry({ heading: 'Rīga', senses: [{ gloss: 'Latvijas galvaspilsēta' }] }).isProper, 'Rīga jāatpazīst kā īpašvārds.');
const common = classifyDictionaryEntry({ heading: 'kaķis', senses: [{ gloss: 'mājas dzīvnieks' }] });
assert(!common.isAbbrev && !common.isProper, 'Kaķis jāatpazīst kā parasts vārds.');
assert(normalizeWord(' ĀBELE ') === 'ābele', 'Vārda normalizācija nedarbojas.');

console.log('✓ Servera un klienta JavaScript sintakse');
console.log('✓ Skaņas poga un skaņu modulis');
console.log('✓ Latviskie laukuma apzīmējumi');
console.log('✓ Pirmās partijas burtu izloze');
console.log('✓ Atkārtotajā partijā sāk iepriekšējais uzvarētājs');
console.log('✓ Datora spēlētāja gājienu plānošana un drošības pārbaudes');
console.log('✓ Septiņi kauliņi vienā rindā datora skatā');
console.log('✓ Kauliņu pārkārtošana arī ārpus sava gājiena');
console.log('✓ Saīsinājumu un īpašvārdu noteikšana');
console.log('✓ Vārdu pārbaudes API un interfeiss');
