function tilePoints(tile) {
  const value = Number(tile?.pts);
  return Number.isFinite(value) ? value : 0;
}

function rackPoints(player) {
  return (Array.isArray(player?.rack) ? player.rack : []).reduce((sum, tile) => sum + tilePoints(tile), 0);
}

function applyEmptyRackScoring(players, finisherId) {
  if (!(players instanceof Map)) throw new TypeError('players jābūt Map objektam.');
  const finisher = players.get(finisherId);
  if (!finisher) throw new Error('Spēlētājs, kurš izlicis visus kauliņus, nav atrasts.');

  const adjustments = [];
  let transfer = 0;

  for (const [id, player] of players.entries()) {
    const beforeScore = Number(player.score) || 0;
    const remainingPoints = rackPoints(player);
    const isFinisher = id === finisherId;
    const adjustment = isFinisher ? 0 : -remainingPoints;

    if (!isFinisher) {
      player.score = beforeScore + adjustment;
      transfer += remainingPoints;
    } else {
      player.score = beforeScore;
    }

    adjustments.push({
      id,
      name: String(player.name || 'Spēlētājs'),
      beforeScore,
      remainingPoints,
      adjustment,
      afterScore: Number(player.score) || 0,
      isFinisher,
    });
  }

  finisher.score = (Number(finisher.score) || 0) + transfer;
  const finisherAdjustment = adjustments.find((item) => item.id === finisherId);
  if (finisherAdjustment) {
    finisherAdjustment.adjustment = transfer;
    finisherAdjustment.afterScore = Number(finisher.score) || 0;
  }

  const final = [...players.entries()]
    .map(([id, player]) => ({ id, name: String(player.name || 'Spēlētājs'), score: Number(player.score) || 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'lv'));

  const topScore = final[0]?.score ?? 0;
  const topPlayers = final.filter((player) => player.score === topScore);
  const hasUniqueWinner = topPlayers.length === 1;
  const winner = hasUniqueWinner ? topPlayers[0] : null;

  return {
    finisherId,
    finisherName: String(finisher.name || 'Spēlētājs'),
    transfer,
    adjustments,
    final,
    winnerId: winner?.id || null,
    winnerName: winner?.name || 'Neizšķirts',
    winnerScore: topScore,
    hasUniqueWinner,
  };
}

module.exports = { tilePoints, rackPoints, applyEmptyRackScoring };
