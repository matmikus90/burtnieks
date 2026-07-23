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

function patchComputerPlayer(source) {
  if (source.includes('const botTurnTimers = new Map();') && source.includes('scheduleBotTurn(roomId);')) return source;

  const botStart = source.indexOf('async function botTakeTurn(roomId){');
  const botEndMarker = '/* ================================================================ */';
  const botEnd = source.indexOf(botEndMarker, botStart);
  if (botStart === -1 || botEnd === -1) throw new Error('Neizdevās atrast datora spēlētāja funkciju.');

  const replacement = `const BOT_COMMON_WORDS = Object.freeze([
  "ar","es","ir","un","uz","no","pa","par","pie","tas","tā","tu","te","tur","kur","kas","kā","ja","jā","ne","nav",
  "būt","bija","būs","iet","nāk","dod","ņem","redz","saka","sēž","stāv","skrien","lec","ēd","dzer","guļ",
  "māja","māte","tēvs","bērns","brālis","māsa","draugs","kaķis","suns","pele","lācis","vilks","lapsa","zivs","putns",
  "koks","zars","lapa","zāle","puķe","upe","jūra","ezers","sala","ceļš","iela","logs","durvis","galds","krēsls","siena","jumts",
  "saule","mēness","zeme","gaiss","vējš","lietus","sniegs","rīts","vakars","diena","nakts","laiks","gads","vārds","burts","spēle","punkts",
  "roka","kāja","acs","auss","galva","sirds","maize","piens","ūdens","sāls","medus","ola","siers","ābols","oga","rieksts","rīsi","zupa","tēja","kafija",
  "labs","slikts","liels","mazs","jauns","vecs","ātrs","lēns","silts","auksts","balts","melns","zaļš","zils","viens","divi","trīs","četri","pieci","seši",
  "viss","daudz","maz","augšā","lejā","iekšā","ārā","kopā","tuvu","tālu","šodien","rīt","vakar"
]);
const botTurnTimers = new Map();
const botThinkingRooms = new Set();

function findBestBotMove(room, botId, words){
  let best=null;
  const empty=isBoardEmpty(room);
  const uniqueWords=[...new Set(words.map(w=>String(w||"").toLowerCase()).filter(w=>w.length>=2&&w.length<=8))];

  if(empty){
    for(const word of uniqueWords){
      for(let i=0;i<word.length;i++){
        const move=tryPlaceWordAt(room,botId,word,7-i,7,1,0);
        if(move&&(!best||move.score>best.score)) best={...move,word};
      }
    }
    return best;
  }

  for(let y=0;y<15;y++) for(let x=0;x<15;x++){
    const fixed=room.board[y][x];
    if(!fixed) continue;
    const fixedCh=String(fixed.ch||"").toLowerCase();
    for(const word of uniqueWords){
      for(let i=0;i<word.length;i++){
        if(word[i]!==fixedCh) continue;
        const horizontal=tryPlaceWordAt(room,botId,word,x-i,y,1,0);
        if(horizontal&&(!best||horizontal.score>best.score)) best={...horizontal,word};
        const vertical=tryPlaceWordAt(room,botId,word,x,y-i,0,1);
        if(vertical&&(!best||vertical.score>best.score)) best={...vertical,word};
      }
    }
  }
  return best;
}

function generateBotCandidates(room,rack,limit=96){
  const rackLetters=(rack||[]).map(t=>String(t.ch||"").toLowerCase()).filter(ch=>ch&&ch!=="_");
  const blankCount=(rack||[]).filter(t=>t.blank||t.ch==="_").length;
  const anchors=[];
  if(!isBoardEmpty(room)){
    for(let y=0;y<15;y++) for(let x=0;x<15;x++){
      const ch=String(room.board[y][x]?.ch||"").toLowerCase();
      if(ch&&!anchors.includes(ch)) anchors.push(ch);
    }
  }
  const blankLetters=["a","i","s","e","t","r","u","n","k","m"];
  const pools=[rackLetters];
  for(const anchor of anchors.slice(0,8)) pools.push(rackLetters.concat(anchor));
  if(blankCount>0) for(const ch of blankLetters) pools.push(rackLetters.concat(ch));

  const out=new Set();
  function addPermutations(pool,maxLength){
    const used=Array(pool.length).fill(false);
    function walk(word,target){
      if(out.size>=limit) return;
      if(word.length===target){out.add(word);return;}
      for(let i=0;i<pool.length;i++){
        if(used[i]) continue;
        used[i]=true; walk(word+pool[i],target); used[i]=false;
        if(out.size>=limit) return;
      }
    }
    for(let length=2;length<=maxLength&&out.size<limit;length++) walk("",length);
  }
  for(const pool of pools){
    addPermutations(pool,Math.min(4,pool.length));
    if(out.size>=limit) break;
  }
  return [...out];
}

async function validateBotCandidates(candidates,wanted=24){
  const valid=[];
  for(let i=0;i<candidates.length&&valid.length<wanted;i+=10){
    const batch=candidates.slice(i,i+10);
    const checked=await Promise.all(batch.map(async word=>{
      try{const result=await verifyWordStrict(word);return result.ok?word:null;}catch{return null;}
    }));
    for(const word of checked) if(word&&!valid.includes(word)) valid.push(word);
  }
  return valid;
}

function finishBotWithoutMove(roomId,botId,bot){
  const room=rooms.get(roomId);
  if(!room||!room.started||currentTurnId(room)!==botId) return;
  if((room.bag?.length||0)>=7){
    returnRackToBag(room,bot.rack||[]);
    bot.rack=drawTiles(room,7);
    room.passStreak.set(botId,0);
    io.to(roomId).emit("effect",{type:"exchanged",by:botId,byName:bot.name});
  }else{
    room.passStreak.set(botId,(room.passStreak.get(botId)||0)+1);
    io.to(roomId).emit("effect",{type:"passed",by:botId,byName:bot.name});
  }
  room.draft=null;
  if(checkAllPassedTwice(roomId)) return;
  room.turnIndex=(room.turnIndex+1)%room.turnOrder.length;
  startTurnTimer(roomId);
  emitState(roomId);
}

async function botTakeTurn(roomId){
  const room=rooms.get(roomId);
  const botId=makeBotId(roomId);
  if(!room||!room.started||!room.players.has(botId)||currentTurnId(room)!==botId||botThinkingRooms.has(roomId)) return;

  botThinkingRooms.add(roomId);
  stopTurnTimer(room);
  const bot=room.players.get(botId);
  io.to(roomId).emit("effect",{type:"botThinking",by:botId,byName:bot?.name||"Dators"});

  try{
    if(!bot.rack||bot.rack.length<7) bot.rack=(bot.rack||[]).concat(drawTiles(room,Math.max(0,7-(bot.rack||[]).length)));

    let best=findBestBotMove(room,botId,BOT_COMMON_WORDS);
    if(!best){
      const generated=generateBotCandidates(room,bot.rack,96);
      const verified=await validateBotCandidates(generated,24);
      const current=rooms.get(roomId);
      if(!current||!current.started||currentTurnId(current)!==botId) return;
      best=findBestBotMove(current,botId,verified);
    }

    const current=rooms.get(roomId);
    if(!current||!current.started||currentTurnId(current)!==botId) return;
    if(!best) return finishBotWithoutMove(roomId,botId,bot);

    const result=validateAndScoreMove(current,botId,best.placements);
    if(!result.ok) return finishBotWithoutMove(roomId,botId,bot);

    applyMove(current,botId,result.placements,result.placementsMap);
    bot.score+=result.total;
    current.passStreak.set(botId,0);
    current.draft=null;
    current.lastMove={by:botId,byName:bot.name,total:result.total,words:result.words,at:Date.now()};
    for(const item of result.words.filter(item=>item.word!=="BONUS")){
      current.last3.unshift({word:item.word,lemma:item.word,meaning:"",summary:"",byName:bot.name,ts:Date.now()});
    }
    current.last3=current.last3.slice(0,3);
    io.to(roomId).emit("effect",{type:"accepted",by:botId,byName:bot.name,total:result.total,words:result.words,hits:[]});

    if((bot.rack?.length||0)===0) return endByEmptyRack(roomId,botId);
    current.turnIndex=(current.turnIndex+1)%current.turnOrder.length;
    startTurnTimer(roomId);
    emitState(roomId);
  }catch(error){
    console.error("Datora gājiens neizdevās:",error);
    const current=rooms.get(roomId);
    if(current?.started&&currentTurnId(current)===botId) finishBotWithoutMove(roomId,botId,bot);
  }finally{
    botThinkingRooms.delete(roomId);
  }
}

function scheduleBotTurn(roomId){
  const room=rooms.get(roomId);
  const botId=room?currentTurnId(room):null;
  if(!room||!room.started||!botId||!isBotId(botId)||botTurnTimers.has(roomId)||botThinkingRooms.has(roomId)) return;
  const expectedGameStart=room.gameStartAt;
  const expectedTurnIndex=room.turnIndex;
  const justStarted=Date.now()-Number(room.gameStartAt||0)<1500;
  const delay=justStarted?3600:650;
  const timer=setTimeout(async()=>{
    botTurnTimers.delete(roomId);
    const current=rooms.get(roomId);
    if(!current||!current.started||current.gameStartAt!==expectedGameStart||current.turnIndex!==expectedTurnIndex||currentTurnId(current)!==botId) return;
    await botTakeTurn(roomId);
  },delay);
  botTurnTimers.set(roomId,timer);
}
`;

  source = source.slice(0, botStart) + replacement + botEndMarker + source.slice(botEnd + botEndMarker.length);

  const timerMarker = '  stopTurnTimer(room);\n  if(!room.started || !room.turnTimeSec || room.turnTimeSec<=0 || room.turnOrder.length===0) return;';
  if (!source.includes(timerMarker)) throw new Error('Neizdevās pieslēgt datora gājienu taimerim.');
  source = source.replace(timerMarker, '  stopTurnTimer(room);\n  scheduleBotTurn(roomId);\n  if(!room.started || !room.turnTimeSec || room.turnTimeSec<=0 || room.turnOrder.length===0) return;');
  return source;
}

function patchRackControls(source) {
  if (source.includes("rack.dataset.reorderEnabled='true'")) return source;
  const start = source.indexOf('function renderRack(){');
  const end = source.indexOf('function renderPlayers(){', start);
  if (start === -1 || end === -1) throw new Error('Neizdevās atrast kauliņu plaukta renderēšanu.');

  const replacement = `function renderRack(){
    const rack=$('rack');rack.innerHTML='';
    if(state.role!=='player'){rack.textContent='Skatītāja režīms';return}
    const used=new Set([...temp.values()].map(v=>String(v.tileId)));
    const ids=(state.myRack||[]).map(t=>String(t.id));
    if(rackOrder.length!==ids.length||ids.some(id=>!rackOrder.includes(id)))rackOrder=ids.slice();
    for(const id of rackOrder){
      if(used.has(id))continue;
      const t=state.myRack.find(z=>String(z.id)===id);
      if(t)rack.appendChild(tileEl(t,'rack',id));
    }
    rack.dataset.reorderEnabled='true';
    const clearTargets=()=>rack.querySelectorAll('.rack-drop-target').forEach(el=>el.classList.remove('rack-drop-target'));
    rack.ondragover=e=>{
      e.preventDefault();clearTargets();
      const target=e.target.closest?.('.tile[data-id]');
      if(target)target.classList.add('rack-drop-target');
    };
    rack.ondragleave=e=>{if(!rack.contains(e.relatedTarget))clearTargets()};
    rack.ondrop=e=>{
      e.preventDefault();clearTargets();
      let d=null;try{d=JSON.parse(e.dataTransfer.getData('text/plain'))}catch{return}
      if(d.source==='temp'){temp.delete(key(d.x,d.y));render();emitDraft();return}
      if(d.source!=='rack')return;
      const dragged=String(d.id);
      const targetEl=e.target.closest?.('.tile[data-id]');
      const target=targetEl?String(targetEl.dataset.id):null;
      const next=rackOrder.filter(id=>id!==dragged);
      if(target&&next.includes(target)){
        const rect=targetEl.getBoundingClientRect();
        const after=e.clientX>rect.left+rect.width/2;
        next.splice(next.indexOf(target)+(after?1:0),0,dragged);
      }else next.push(dragged);
      rackOrder=next;
      renderRack();
      socket.emit('reorderRack',{roomId:state.roomId,order:rackOrder});
    };
  }
  `;
  return source.slice(0, start) + replacement + source.slice(end);
}

function patchServer(source) {
  source = patchWordValidation(source);
  source = patchSessionStartOrder(source);
  source = patchComputerPlayer(source);
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
  source = patchRackControls(source);
  if (!source.includes('/enhancements.css')) source = source.replace('</head>', '<link rel="stylesheet" href="/enhancements.css">\n</head>');
  if (!source.includes('/enhancements.js')) source = source.replace('</body>', '<script src="/enhancements.js"></script>\n</body>');
  return source;
}

module.exports = { patchServer, patchInterface };
