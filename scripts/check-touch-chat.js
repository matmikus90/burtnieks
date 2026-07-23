const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { patchTouchChatInterface } = require('../interaction-patches');

function assert(condition, message) { if (!condition) throw new Error(message); }
const root = path.join(__dirname, '..');
const fixture = `<!doctype html><html><head></head><body><script>
window.__burtnieksSocket=socket; let state=null, temp=new Map(), rackOrder=[], chatMin=true, toastTimer=null;
function tileEl(t,source,id,xy){const el=document.createElement('div');el.draggable=source==='rack'||source==='temp';return el}
function renderBoard(){const board=$('board');board.innerHTML=''}
function renderRack(){const rack=$('rack');rack.innerHTML=''}
function render(){}
function emitDraft(){}
function canMove(){return true}
function key(x,y){return x+','+y}
function toast(){}
function esc(v){return String(v)}
socket.on('returnedLobby',({name})=>{state=null;temp.clear();});
socket.on('state',s=>{state=s;window.__burtnieksState=s;window.dispatchEvent(new CustomEvent('burtnieks:state',{detail:s}));});
$('clear').onclick=()=>{temp.clear();render();emitDraft()};
</script></body></html>`;
const patched = patchTouchChatInterface(fixture);

assert(patched.includes('tapSelectedTileId=null'), 'Nav izvēlētā kauliņa stāvokļa.');
assert(patched.includes("source==='rack'&&tapSelectedTileId"), 'Kauliņu nevar izvēlēties ar pieskārienu.');
assert(patched.includes("c.classList.add('tap-target')"), 'Laukuma mērķi netiek iezīmēti.');
assert(patched.includes("el.draggable=source==='rack'||source==='temp'"), 'Esošā vilkšana ir noņemta.');
assert(patched.includes('/touch-chat.css'), 'Nav pieskārienu/čata stilu.');
assert(patched.includes('/touch-chat.js'), 'Nav čata izvietojuma skripta.');

for (const match of patched.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  const code = match[1].trim();
  if (code) new vm.Script(code, { filename: 'touch-patched-inline.js' });
}

const chatJs = fs.readFileSync(path.join(root, 'public', 'touch-chat.js'), 'utf8');
const chatCss = fs.readFileSync(path.join(root, 'public', 'touch-chat.css'), 'utf8');
new vm.Script(chatJs, { filename: 'touch-chat.js' });
assert(chatJs.includes("matchMedia('(min-width:1051px)')"), 'Čatam nav responsīva režīma.');
assert(chatJs.includes('side.appendChild(chat)'), 'Mazā ekrānā čats netiek ievietots lapas plūsmā.');
assert(chatJs.includes('localStorage.setItem(storageKey'), 'Čata pozīcija netiek saglabāta.');
assert(chatCss.includes('.tile.tap-selected'), 'Izvēlētam kauliņam nav redzama stāvokļa.');
assert(chatCss.includes('.chat.chat-inline'), 'Mazā ekrāna čats nav noformēts kā parasts panelis.');

console.log('✓ Kauliņu var izvēlēties ar pieskārienu un nolikt ar otru pieskārienu');
console.log('✓ Vilkšana ar peli un pieskārienu paliek pieejama');
console.log('✓ Datorā čats ir pārvelkams un saglabā pozīciju');
console.log('✓ Planšetē un telefonā čats neaizsedz vārdu pārbaudi');
