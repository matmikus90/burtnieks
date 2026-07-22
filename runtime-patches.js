function patchWordValidation(source) {
  if (source.includes("require('./word-validator')") || source.includes('require("./word-validator")')) return source;
  const startMarker = '// ✅ Stingra pārbaude: atļauj tikai parastus vārdus (ne īpašvārdus, ne saīsinājumus)';
  const endMarker = 'const inflCache = new Map();';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error('Neizdevās atrast veco vārdu pārbaudes bloku.');
  const replacement = `// Stingra vārdu pārbaude ir nodalīta testējamā modulī.\nconst { createWordValidator } = require("./word-validator");\nconst { verifyWordStrict } = createWordValidator({ httpGet });\napp.get("/api/check-word", async (req,res)=>{\n  const out = await verifyWordStrict(String(req.query.word || req.query.q || ""));\n  res.status(out.serviceUnavailable ? 503 : 200);\n  res.setHeader("Cache-Control", "no-store");\n  res.setHeader("Content-Type", "application/json; charset=utf-8");\n  res.end(JSON.stringify({ ok:!!out.ok, word:out.word, reason:out.reason||"", heading:out.heading||"", lemma:out.lemma||"", tezaursId:out.tezaursId||"" }));\n});\n\n`;
  return source.slice(0, start) + replacement + source.slice(end);
}

function patchSessionStartOrder(source) {
  if (source.includes('type:"winnerStarts"') && source.includes('startGame(roomId, { rematch:true })')) return source;

  const finalizeRanking = '  const final=[...room.players.values()].map(p=>({name:p.name, score:p.score})).sort((a,b)=>b.score-a.score);\n  const winner = final[0] || {name:"—", score:0};';
  const finalizeRankingReplacement = '  const ranked=[...room.players.entries()].map(([id,p])=>({id,name:p.name,score:p.score})).sort((a,b)=>b.score-a.score);\n  const final=ranked.map(({name,score})=>({name,score}));\n  const hasUniqueWinner=ranked.length>0 && (ranked.length===1 || ranked[0].score>ranked[1].score);\n  const winnerId=hasUniqueWinner ? ranked[0].id : null;\n  const winner=hasUniqueWinner ? ranked[0] : {name:"Neizšķirts", score:ranked[0]?.score||0};';
  if (!source.includes(finalizeRanking)) throw new Error('Neizdevās atrast partijas gala rezultātu bloku.');
  source = source.replace(finalizeRanking, finalizeRankingReplacement);

  const finalizeGameOver = '  room.lastGameOver = { winnerName: winner.name, winnerScore: winner.score, final, at: Date.now(), durationMs, reason };';
  if (!source.includes(finalizeGameOver)) throw new Error('Neizdevās atrast partijas beigu stāvokli.');
  source = source.replace(finalizeGameOver, '  room.lastGameOver = { winnerId, winnerName: winner.name, winnerScore: winner.score, final, at: Date.now(), durationMs, reason };');

  const emptyRackGameOver = '  room.lastGameOver = { winnerName: winner.name, winnerScore: winner.score, transfer, final, at: Date.now(), durationMs, reason:"Beidzās kauliņi" };';
  if (!source.includes(emptyRackGameOver)) throw new Error('Neizdevās atrast tukšā statīva partijas beigu stāvokli.');
  source = source.replace(emptyRackGameOver, '  room.lastGameOver = { winnerId, winnerName: winner.name, winnerScore: winner.score, transfer, final, at: Date.now(), durationMs, reason:"Beidzās kauliņi" };');

  const startMarker = 'function startGame(roomId){';
  const endMarker = '\nio.on("connection",(socket)=>{';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error('Neizdevās atrast spēles sākšanas funkciju.');

  const startGameReplacement = `function startGame(roomId, options={}){
  const room = rooms.get(roomId);
  if(!room || room.started || room.players.size < 2) return false;

  const rematch = !!options.rematch;
  const previousGame = room.lastGameOver;
  const previousOrder = room.turnOrder.filter(id=>room.players.has(id));
  const previousWinnerId = rematch ? (previousGame?.winnerId || null) : null;

  resetRoomForNewGame(room);
  room.started = true;
  room.gameStartAt = Date.now();
  room.lastGameOver = null;

  let order=[];
  if(previousWinnerId && room.players.has(previousWinnerId)){
    order = previousOrder.slice();
    for(const id of room.players.keys()) if(!order.includes(id)) order.push(id);
    const winnerIndex = order.indexOf(previousWinnerId);
    if(winnerIndex>0) order = order.slice(winnerIndex).concat(order.slice(0,winnerIndex));
    room.turnOrder = order;
    room.turnIndex = 0;
    io.to(roomId).emit("effect",{
      type:"winnerStarts",
      starterId:previousWinnerId,
      starterName:room.players.get(previousWinnerId)?.name||"?",
      order:order.map(id=>({id,name:room.players.get(id)?.name||"?"}))
    });
  }else{
    const draw = computeTurnOrderByLetter(room);
    order = draw.order;
    room.turnOrder = order;
    room.turnIndex = 0;
    io.to(roomId).emit("effect",{
      type:"letterDraw",
      draws:draw.drawPublic,
      order:order.map(id=>({id,name:room.players.get(id)?.name||"?"})),
      rematchFallback:rematch
    });
  }

  for(const [,p] of room.players.entries()) p.rack = drawTiles(room,7);
  startTurnTimer(roomId);
  emitState(roomId);
  emitRoomsList();
  return true;
}`;
  source = source.slice(0, start) + startGameReplacement + source.slice(end);

  const rematchStart = '    if(allReady) startGame(roomId);';
  if (!source.includes(rematchStart)) throw new Error('Neizdevās atrast atkārtotās spēles sākšanu.');
  source = source.replace(rematchStart, '    if(allReady) startGame(roomId, { rematch:true });');

  return source;
}

function patchServer(source) {
  source = patchWordValidation(source);
  source = patchSessionStartOrder(source);
  return source;
}

function patchInterface(source) {
  if (!source.includes('window.__burtnieksSocket')) {
    source = source.replace(
      "let state=null, temp=new Map(), rackOrder=[], chatMin=true, toastTimer=null;",
      "window.__burtnieksSocket=socket; let state=null, temp=new Map(), rackOrder=[], chatMin=true, toastTimer=null;"
    );
    source = source.replace(
      "socket.on('state',s=>{state=s;",
      "socket.on('state',s=>{state=s;window.__burtnieksState=s;window.dispatchEvent(new CustomEvent('burtnieks:state',{detail:s}));"
    );
  }
  if (!source.includes('/enhancements.css')) source = source.replace('</head>', '<link rel="stylesheet" href="/enhancements.css">\n</head>');
  if (!source.includes('/enhancements.js')) source = source.replace('</body>', '<script src="/enhancements.js"></script>\n</body>');
  return source;
}

module.exports = { patchServer, patchInterface };
