function replaceOnce(source, marker, replacement, errorMessage) {
  if (!source.includes(marker)) throw new Error(errorMessage);
  return source.replace(marker, replacement);
}

function patchFinalScoringServer(source) {
  if (source.includes('applyEmptyRackScoring(room.players,finisherId)')) return source;

  const requireMarker = 'const { unlockMoveAchievements } = require("./achievements");';
  source = replaceOnce(
    source,
    requireMarker,
    `${requireMarker}\nconst { applyEmptyRackScoring } = require("./final-scoring");`,
    'Neizdevās pieslēgt gala punktu aprēķina moduli.'
  );

  const startMarker = 'function endByEmptyRack(roomId, winnerId){';
  const endMarker = '\n\nfunction isParticipant(room, sid)';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error('Neizdevās atrast spēles pabeigšanu pēc visu kauliņu izlikšanas.');

  const replacement = `function endByEmptyRack(roomId, finisherId){
  const room=rooms.get(roomId);
  if(!room || !room.players.has(finisherId)) return;

  const scoring=applyEmptyRackScoring(room.players,finisherId);
  const durationMs=room.gameStartAt ? (Date.now()-room.gameStartAt) : 0;

  if(scoring.winnerId && scoring.winnerName && scoring.winnerName!=="Neizšķirts"){
    winsByName[scoring.winnerName]=(Number(winsByName[scoring.winnerName])||0)+1;
    saveWins(winsByName);
    emitPublic();
  }

  room.started=false;
  stopTurnTimer(room);
  room.draft=null;
  room.rematchVotes.clear();

  const gameOver={
    winnerId:scoring.winnerId,
    winnerName:scoring.winnerName,
    winnerScore:scoring.winnerScore,
    finisherId:scoring.finisherId,
    finisherName:scoring.finisherName,
    transfer:scoring.transfer,
    adjustments:scoring.adjustments,
    final:scoring.final,
    at:Date.now(),
    durationMs,
    reason:"Beidzās kauliņi"
  };
  room.lastGameOver=gameOver;

  io.to(roomId).emit("effect",{type:"gameOver",...gameOver});
  emitState(roomId);
  emitRoomsList();
}`;

  return source.slice(0, start) + replacement + source.slice(end);
}

function patchFinalScoringInterface(source) {
  if (!source.includes('/final-scoring.css')) {
    source = source.replace('</head>', '<link rel="stylesheet" href="/final-scoring.css">\n</head>');
  }
  if (source.includes('final-adjustment')) return source;

  const startMarker = 'function showGameOver(e){';
  const start = source.indexOf(startMarker);
  const end = source.indexOf("\n  $('chatToggle').onclick", start);
  if (start === -1 || end === -1) throw new Error('Neizdevās atrast partijas beigu loga renderēšanu.');

  const replacement = `function showGameOver(e){
    $('gameOver').classList.remove('hidden');
    $('winner').textContent=\`${e.winnerName||'—'} · ${e.winnerScore||0} p.\`;
    const finisherNote=e.reason==='Beidzās kauliņi'&&e.finisherName
      ? \` · Visus kauliņus izlika ${e.finisherName} (+${e.transfer||0} p.)\`
      : '';
    $('gameOverReason').textContent=\`Istaba: ${state?.roomName||state?.roomId||'—'} · ${e.reason||'Partija pabeigta'}${finisherNote} · laiks ${fmt(e.durationMs||0)}\`;
    const adjustments=new Map((e.adjustments||[]).map(item=>[String(item.id||item.name),item]));
    $('finalList').innerHTML=(e.final||[]).map((p,i)=>{
      const adjustment=adjustments.get(String(p.id||p.name));
      let details='';
      if(adjustment){
        const sign=adjustment.adjustment>0?'+':'';
        details=adjustment.isFinisher
          ? \`<div class="final-adjustment gain">Pirms: ${adjustment.beforeScore} p. · Saņemts no pārējiem: +${adjustment.adjustment} p. · Gala rezultāts: ${adjustment.afterScore} p.</div>\`
          : \`<div class="final-adjustment loss">Pirms: ${adjustment.beforeScore} p. · Plauktā palika: ${adjustment.remainingPoints} p. · Korekcija: ${sign}${adjustment.adjustment} p. · Gala rezultāts: ${adjustment.afterScore} p.</div>\`;
      }
      return \`<div class="final-row final-row-detailed"><div><b>${i+1}. ${esc(p.name)}</b>${adjustment?.isFinisher?'<span class="finisher-badge">Izlika visus kauliņus</span>':''}${details}</div><span class="final-score">${p.score} p.</span></div>\`;
    }).join('');
    $('rematch').disabled=(state?.rematchVotes||[]).includes(state?.meId);
    $('rematchStatus').textContent=$('rematch').disabled?'Tu jau izvēlējies atkārtotu spēli.':'';
  }`;

  return source.slice(0, start) + replacement + source.slice(end);
}

module.exports = { patchFinalScoringServer, patchFinalScoringInterface, replaceOnce };
