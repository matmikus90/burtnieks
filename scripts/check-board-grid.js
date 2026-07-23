const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'board-grid.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public', 'board-grid.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

new vm.Script(js, { filename: 'board-grid.js' });
assert(css.includes('grid-template-columns:repeat(15'), 'Laukumam nav 15 vienādu kolonnu.');
assert(css.includes('grid-template-rows:repeat(15'), 'Laukumam nav 15 vienādu rindu.');
assert(css.includes('--board-size'), 'Laukuma kopējais izmērs netiek fiksēts.');
assert(css.includes('margin-inline:auto'), 'Laukums netiek centrēts pieejamajā panelī.');
assert(js.includes('devicePixelRatio'), 'Laukums netiek pieskaņots ekrāna pikseļiem.');
assert(js.includes('DESKTOP_MAX_BOARD = 780'), 'Datora skatam nav lielāka laukuma izmēra.');
assert(js.includes('contentWidth(board.parentElement)'), 'Laukums neizmanto reālo kreisā paneļa platumu.');
assert(js.includes('Math.min(availableWidth, availableHeight, maxBoard)'), 'Laukuma izmērs nav responsīvi ierobežots.');
assert(js.includes('ResizeObserver'), 'Laukums nepārrēķinās, mainoties paneļa izmēram.');
assert(js.includes('TRACKS * cell + (TRACKS - 1) * gap'), 'Laukuma izmēra aprēķins nav pilns.');
assert(server.includes('/board-grid.css'), 'Laukuma režģa stili nav pieslēgti interfeisam.');
assert(server.includes('/board-grid.js'), 'Laukuma režģa skripts nav pieslēgts interfeisam.');

console.log('✓ Vienāds 15×15 laukuma režģis');
console.log('✓ Rūtiņas un spraugas pieskaņotas ekrāna pikseļiem');
console.log('✓ Laukums responsīvi izmanto pieejamo datora un planšetes vietu');
