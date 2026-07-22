const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const root = path.join(__dirname, '..');

function readBundle(relativePath) {
  const encoded = fs.readFileSync(path.join(root, relativePath), 'utf8').trim();
  return zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const serverSource = fs.existsSync(path.join(root, 'server.bundle.gz.b64'))
  ? readBundle('server.bundle.gz.b64')
  : fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const htmlSource = fs.existsSync(path.join(root, 'public/index.bundle.gz.b64'))
  ? readBundle('public/index.bundle.gz.b64')
  : fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

new vm.Script(serverSource, { filename: 'runtime-server.js' });

const inlineScripts = [...htmlSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(source => source.trim());
assert(inlineScripts.length > 0, 'Klienta inline JavaScript netika atrasts.');
for (const [index, source] of inlineScripts.entries()) {
  new vm.Script(source, { filename: `client-inline-${index + 1}.js` });
}

assert(htmlSource.includes('id="soundToggle"'), 'Nav skaņas ieslēgšanas/izslēgšanas pogas.');
assert(htmlSource.includes("TW:'3V'"), 'Nav latviskā 3V apzīmējuma.');
assert(htmlSource.includes("DL:'2B'"), 'Nav latviskā 2B apzīmējuma.');
assert(htmlSource.includes('/api/check-word'), 'Klientā nav vārdu pārbaudes.');
assert(serverSource.includes('classifyDictionaryEntry'), 'Serverī nav vārdnīcas ierakstu klasifikācijas.');
assert(serverSource.includes('Saīsinājumi un akronīmi nav atļauti'), 'Serverī nav saīsinājumu aizlieguma.');
assert(serverSource.includes('Īpašvārdi nav atļauti'), 'Serverī nav īpašvārdu aizlieguma.');

console.log('✓ Servera JavaScript sintakse');
console.log('✓ Klienta JavaScript sintakse');
console.log('✓ Skaņas poga');
console.log('✓ Latviskie laukuma apzīmējumi');
console.log('✓ Stingrā vārdu pārbaude');
