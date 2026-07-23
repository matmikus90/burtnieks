const ACHIEVEMENTS = Object.freeze({
  ALL_SEVEN: Object.freeze({
    id: 'all-seven',
    title: 'Septiņu burtu burvestība',
    description: 'Vienā gājienā izlikti visi 7 kauliņi — klasiskais “bingo”.',
    icon: '7',
    priority: 100,
  }),
  SCORE_100: Object.freeze({
    id: 'score-100',
    title: 'Simtnieka sprādziens',
    description: 'Vienā gājienā iegūti vismaz 100 punkti.',
    icon: '100',
    priority: 95,
  }),
  SCORE_50: Object.freeze({
    id: 'score-50',
    title: 'Punktu vētra',
    description: 'Vienā gājienā iegūti vismaz 50 punkti.',
    icon: '50',
    priority: 80,
  }),
  THREE_WORDS: Object.freeze({
    id: 'three-words',
    title: 'Krustvārdu burvis',
    description: 'Ar vienu gājienu izveidoti vismaz 3 derīgi vārdi.',
    icon: '✚',
    priority: 75,
  }),
  BONUS_CHAIN: Object.freeze({
    id: 'bonus-chain',
    title: 'Bonusu ķēde',
    description: 'Vienā gājienā izmantoti vismaz 2 bonusa lauciņi.',
    icon: '★',
    priority: 70,
  }),
  BLANK_TILE: Object.freeze({
    id: 'blank-tile',
    title: 'Mainīgais burts',
    description: 'Vārdā veiksmīgi izmantots tukšais kauliņš.',
    icon: '_',
    priority: 60,
  }),
  LONG_WORD: Object.freeze({
    id: 'long-word',
    title: 'Garvārdu meistars',
    description: 'Izveidots vismaz 8 burtus garš vārds.',
    icon: '8+',
    priority: 55,
  }),
});

function normalizeWords(words) {
  return (Array.isArray(words) ? words : [])
    .map((item) => String(item?.word || item || '').trim().toLowerCase())
    .filter((word) => word && word !== 'bonus');
}

function placementUsesBlank(placementsMap) {
  if (!placementsMap || typeof placementsMap.values !== 'function') return false;
  for (const tile of placementsMap.values()) {
    if (tile?.blank || tile?.ch === '_') return true;
  }
  return false;
}

function countPremiumPlacements(room, placements) {
  if (!room?.mult?.label || !Array.isArray(placements)) return 0;
  let count = 0;
  for (const placement of placements) {
    const x = Number(placement?.x);
    const y = Number(placement?.y);
    const label = room.mult.label?.[y]?.[x] || '';
    // Centra zvaigzne pirmajā gājienā ir obligāta, tāpēc to neuzskatām par sasnieguma bonusu.
    if (label && label !== '★') count += 1;
  }
  return count;
}

function evaluateMoveAchievements({ room, total, words, placements, placementsMap }) {
  const unlocked = [];
  const cleanWords = normalizeWords(words);
  const placedCount = Array.isArray(placements) ? placements.length : 0;
  const score = Number(total) || 0;
  const longestWord = cleanWords.reduce((longest, word) => word.length > longest.length ? word : longest, '');

  if (placedCount === 7) unlocked.push(ACHIEVEMENTS.ALL_SEVEN);
  if (score >= 100) unlocked.push(ACHIEVEMENTS.SCORE_100);
  else if (score >= 50) unlocked.push(ACHIEVEMENTS.SCORE_50);
  if (cleanWords.length >= 3) unlocked.push(ACHIEVEMENTS.THREE_WORDS);
  if (countPremiumPlacements(room, placements) >= 2) unlocked.push(ACHIEVEMENTS.BONUS_CHAIN);
  if (placementUsesBlank(placementsMap)) unlocked.push(ACHIEVEMENTS.BLANK_TILE);
  if (longestWord.length >= 8) unlocked.push(ACHIEVEMENTS.LONG_WORD);

  return unlocked
    .slice()
    .sort((a, b) => b.priority - a.priority)
    .map((achievement) => ({ ...achievement, letter: (longestWord[0] || 'B').toUpperCase() }));
}

function claimAchievements(room, playerId, candidates) {
  if (!room) return [];
  if (!(room.achievementUnlocked instanceof Map)) room.achievementUnlocked = new Map();
  const key = String(playerId || 'unknown');
  if (!(room.achievementUnlocked.get(key) instanceof Set)) room.achievementUnlocked.set(key, new Set());
  const claimed = room.achievementUnlocked.get(key);
  const fresh = [];
  for (const candidate of candidates) {
    if (claimed.has(candidate.id)) continue;
    claimed.add(candidate.id);
    fresh.push(candidate);
  }
  return fresh;
}

function unlockMoveAchievements({ room, playerId, playerName, total, words, placements, placementsMap }) {
  const candidates = evaluateMoveAchievements({ room, total, words, placements, placementsMap });
  return claimAchievements(room, playerId, candidates).map((achievement) => ({
    ...achievement,
    playerId: String(playerId || ''),
    playerName: String(playerName || 'Spēlētājs'),
  }));
}

module.exports = {
  ACHIEVEMENTS,
  normalizeWords,
  countPremiumPlacements,
  evaluateMoveAchievements,
  claimAchievements,
  unlockMoveAchievements,
};