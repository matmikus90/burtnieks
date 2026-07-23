function replaceOnce(source, marker, replacement, errorMessage) {
  if (!source.includes(marker)) throw new Error(errorMessage);
  return source.replace(marker, replacement);
}

function patchWordVoteServer(source) {
  if (source.includes('socket.on("startWordVote"') && source.includes('pendingWordVote')) return source;

  const helperMarker = '\nio.on("connection",(socket)=>{';
  const helperIndex = source.indexOf(helperMarker);
  if (helperIndex === -1) throw new Error('Neizdevās atrast Socket.IO savienojuma sākumu vārdu balsošanai.');

  const helpers = `
const WORD_VOTE_OFFER_MS = 20000;
const WORD_VOTE_DURATION_MS = 30000;

function isHumanWordVoter(id){
  return !(typeof isBotId === "function" && isBotId(id));
}
function pushWordVoteChat(room,name,msg){
  if(!Array.isArray(room.chat)) room.chat=[];
  room.chat.push({name,msg,ts:Date.now(),system:true,wordVote:true});
  if(room.chat.length>50) room.chat=room.chat.slice(-50);
}
function clearWordVoteTimer(vote){
  if(vote?.timer){clearTimeout(vote.timer);vote.timer=null;}
}
function detachPendingWordVote(room){
  const vote=room?.pendingWordVote||null;
  clearWordVoteTimer(vote);
  if(room) room.pendingWordVote=null;
  return vote;
}
function wordVoteWordsText(words){
  return (words||[]).map(word=>String(word||"").toUpperCase()).join(", ");
}
function resumeTurnAfterWordVote(roomId,room){
  if(room?.started && currentTurnId(room)) startTurnTimer(roomId);
}
function emitWordVoteUpdate(roomId,vote){
  const accepted=[...vote.votes.entries()].filter(([,value])=>value===true).map(([id])=>id);
  io.to(roomId).emit("effect",{
    type:"wordVoteUpdate",
    by:vote.by,
    byName:vote.byName,
    words:vote.words,
    voterIds:vote.voterIds,
    acceptedIds:accepted,
    acceptedCount:accepted.length,
    totalCount:vote.voterIds.length,
    expiresAt:vote.expiresAt
  });
}
function rejectWordVote(roomId,room,vote,reason,rejectedByName=""){
  if(room.pendingWordVote!==vote) return;
  detachPendingWordVote(room);
  const detail=rejectedByName ? rejectedByName+" noraidīja balsojumu." : reason;
  pushWordVoteChat(room,"❌ Balsojums",wordVoteWordsText(vote.words)+" netika pieņemts. "+detail);
  io.to(roomId).emit("effect",{type:"wordVoteResolved",accepted:false,words:vote.words,reason:detail});
  resumeTurnAfterWordVote(roomId,room);
  emitState(roomId);
}
function expireWordVote(roomId,expectedVote){
  const room=rooms.get(roomId);
  if(!room || room.pendingWordVote!==expectedVote) return;
  if(expectedVote.phase==="offer"){
    detachPendingWordVote(room);
    io.to(expectedVote.by).emit("effect",{type:"wordVoteCancelled",reason:"Balsošanas izvēles laiks beidzās."});
    resumeTurnAfterWordVote(roomId,room);
    emitState(roomId);
    return;
  }
  rejectWordVote(roomId,room,expectedVote,"Balsošanas laiks beidzās.");
}
function cancelWordVoteForDeparture(roomId,room,playerId){
  const vote=room?.pendingWordVote;
  if(!vote) return;
  if(vote.by!==playerId && !(vote.voterIds||[]).includes(playerId)) return;
  detachPendingWordVote(room);
  pushWordVoteChat(room,"⚪ Balsojums","Balsošana par "+wordVoteWordsText(vote.words)+" atcelta, jo dalībnieks pameta spēli.");
  io.to(roomId).emit("effect",{type:"wordVoteResolved",accepted:false,words:vote.words,reason:"Dalībnieks pameta spēli."});
}
async function applyUnanimouslyAcceptedMove(roomId,room,vote){
  if(!room || !room.started || !room.players.has(vote.by) || currentTurnId(room)!==vote.by){
    io.to(roomId).emit("effect",{type:"wordVoteResolved",accepted:false,words:vote.words,reason:"Gājiens vairs nav aktuāls."});
    resumeTurnAfterWordVote(roomId,room);
    emitState(roomId);
    return;
  }
  const res=validateAndScoreMove(room,vote.by,vote.placements);
  if(!res.ok){
    io.to(roomId).emit("effect",{type:"wordVoteResolved",accepted:false,words:vote.words,reason:res.err||"Gājienu vairs nevar piemērot."});
    resumeTurnAfterWordVote(roomId,room);
    emitState(roomId);
    return;
  }

  const player=room.players.get(vote.by);
  const wasVote=Array.isArray(vote.words)&&vote.words.length>0;
  stopTurnTimer(room);
  const cells=res.placements.map(p=>{
    const x=Number(p.x),y=Number(p.y);
    const t=res.placementsMap.get(String(x)+","+String(y));
    const m=room.mult.label?.[y]?.[x]||"";
    return {x,y,ch:t.ch,pts:t.pts,blank:t.blank,m};
  });
  const hits=[...new Set(cells.map(cell=>cell.m).filter(Boolean))];

  player.score+=res.total;
  applyMove(room,vote.by,res.placements,res.placementsMap);
  room.passStreak.set(vote.by,0);
  room.draft=null;
  room.lastMove={by:vote.by,byName:player.name,total:res.total,words:res.words,hits,voted:wasVote,votedWords:wasVote?vote.words:[],at:Date.now()};

  const votedWords=new Set((vote.words||[]).map(word=>String(word).toLowerCase()));
  const made=[...new Set((res.words||[]).map(item=>String(item.word||"").toLowerCase()).filter(word=>word&&word!=="bonus"))];
  for(const word of made){
    const wasVoted=votedWords.has(word);
    const strict=wasVoted?{ok:false,word,lemma:word,tezaursId:word+":1",morph:{}}:await verifyWordStrict(word);
    const info=await infoFromTezaurs(word);
    const explanation="Pieņemts ar vienbalsīgu spēlētāju balsojumu.";
    room.last3.unshift({
      word,
      tezaursId:strict.tezaursId||info.tezaursId||(word+":1"),
      lemma:strict.lemma||info.lemma||word,
      meaning:info.meaning||(wasVoted?explanation:""),
      morph:strict.morph||info.morph||{},
      summary:info.summary||(wasVoted?explanation:""),
      byName:player.name,
      voted:wasVoted,
      ts:Date.now()
    });
  }
  room.last3=room.last3.slice(0,3);

  if(wasVote){
    pushWordVoteChat(room,"✅ Balsojums",player.name+" gājiens ar "+wordVoteWordsText(vote.words)+" pieņemts vienbalsīgi.");
    io.to(roomId).emit("effect",{type:"wordVoteResolved",accepted:true,words:vote.words,by:vote.by,byName:player.name});
  }
  io.to(roomId).emit("effect",{type:"accepted",by:vote.by,byName:player.name,total:res.total,words:res.words,hits,voted:wasVote,votedWords:wasVote?vote.words:[]});
  if(typeof appendMoveAchievementsToChat==="function") appendMoveAchievementsToChat(room,vote.by,player.name,{total:res.total,words:res.words,placements:res.placements,placementsMap:res.placementsMap});

  if((player.rack?.length||0)===0) return endByEmptyRack(roomId,vote.by);
  room.turnIndex=(room.turnIndex+1)%room.turnOrder.length;
  startTurnTimer(roomId);
  emitState(roomId);
}
`;
  source = source.slice(0, helperIndex) + helpers + source.slice(helperIndex);

  const roomMarker = '    achievementUnlocked: new Map(),';
  source = replaceOnce(source, roomMarker, `${roomMarker}\n    pendingWordVote: null,`, 'Neizdevās pievienot vārdu balsošanas stāvokli istabai.');

  const timerMarker = '  stopTurnTimer(room);\n  scheduleBotTurn(roomId);';
  source = replaceOnce(source, timerMarker, '  stopTurnTimer(room);\n  if(room.pendingWordVote) return;\n  scheduleBotTurn(roomId);', 'Neizdevās apturēt taimeri vārdu balsošanas laikā.');

  const commitStart = source.indexOf('  socket.on("commitMove", async ({roomId,placements})=>{');
  const commitEnd = source.indexOf('\n\n  socket.on("disconnect"', commitStart);
  if (commitStart === -1 || commitEnd === -1) throw new Error('Neizdevās atrast gājiena apstiprināšanas apstrādi vārdu balsošanai.');

  const replacement = `  socket.on("commitMove", async ({roomId,placements})=>{
    const room=rooms.get(roomId);
    if(!room) return;
    if(room.pendingWordVote) return io.to(socket.id).emit("toast","Vispirms pabeidziet vārda balsošanu.");
    if(!room.players.has(socket.id)) return io.to(socket.id).emit("toast","Tu esi skatītājs — nevar veikt gājienus.");
    if(!room.started) return io.to(socket.id).emit("toast","Lai sāktu spēli, visiem jānospiež “Gatavs ✅” (lobijā).");
    if(currentTurnId(room)!==socket.id) return io.to(socket.id).emit("toast","Tagad nav tavs gājiens.");

    const res=validateAndScoreMove(room,socket.id,placements);
    if(!res.ok){io.to(socket.id).emit("toast",res.err);emitState(roomId);return;}

    stopTurnTimer(room);
    const madeStrict=[...new Set((res.words||[]).map(item=>String(item.word||"").toLowerCase()).filter(word=>word&&word!=="bonus"))];
    const checks=await Promise.all(madeStrict.map(async word=>({word,check:await verifyWordStrict(word)})));
    const hardInvalid=checks.find(item=>!item.check.ok && item.check.reason!=="Vārds nav atrasts Tēzaurā");
    if(hardInvalid){
      io.to(socket.id).emit("toast","Nederīgs vārds: "+hardInvalid.word.toUpperCase()+" — "+hardInvalid.check.reason);
      startTurnTimer(roomId);emitState(roomId);return;
    }
    const missingWords=checks.filter(item=>!item.check.ok).map(item=>item.word);
    if(missingWords.length){
      const normalizedPlacements=(Array.isArray(placements)?placements:[]).map(p=>({x:Number(p.x),y:Number(p.y),tileId:String(p.tileId),as:p.as?String(p.as).toLowerCase():null}));
      const vote={phase:"offer",by:socket.id,byName:room.players.get(socket.id)?.name||"Spēlētājs",placements:normalizedPlacements,words:missingWords,voterIds:[],votes:new Map(),expiresAt:Date.now()+WORD_VOTE_OFFER_MS,timer:null};
      room.pendingWordVote=vote;
      vote.timer=setTimeout(()=>expireWordVote(roomId,vote),WORD_VOTE_OFFER_MS);
      io.to(socket.id).emit("effect",{type:"wordVoteOffer",words:missingWords,expiresAt:vote.expiresAt});
      emitState(roomId);
      return;
    }

    const vote={by:socket.id,byName:room.players.get(socket.id)?.name||"Spēlētājs",placements:Array.isArray(placements)?placements:[],words:[]};
    await applyUnanimouslyAcceptedMove(roomId,room,vote);
  });

  socket.on("startWordVote",({roomId})=>{
    const room=rooms.get(roomId);
    const vote=room?.pendingWordVote;
    if(!room||!vote||vote.phase!=="offer"||vote.by!==socket.id) return;
    const voterIds=room.turnOrder.filter(id=>id!==vote.by&&room.players.has(id)&&isHumanWordVoter(id));
    if(!voterIds.length){
      detachPendingWordVote(room);
      io.to(socket.id).emit("effect",{type:"wordVoteCancelled",reason:"Nav citu cilvēku spēlētāju, kuri var balsot."});
      resumeTurnAfterWordVote(roomId,room);emitState(roomId);return;
    }
    clearWordVoteTimer(vote);
    vote.phase="voting";
    vote.voterIds=voterIds;
    vote.votes=new Map();
    vote.expiresAt=Date.now()+WORD_VOTE_DURATION_MS;
    vote.timer=setTimeout(()=>expireWordVote(roomId,vote),WORD_VOTE_DURATION_MS);
    pushWordVoteChat(room,"🗳️ Balsošana",vote.byName+" lūdz pieņemt Tēzaurā neatrastu vārdu: "+wordVoteWordsText(vote.words)+".");
    io.to(roomId).emit("effect",{type:"wordVoteStarted",by:vote.by,byName:vote.byName,words:vote.words,voterIds,acceptedIds:[],acceptedCount:0,totalCount:voterIds.length,expiresAt:vote.expiresAt});
    emitState(roomId);
  });

  socket.on("castWordVote",({roomId,accept})=>{
    const room=rooms.get(roomId);
    const vote=room?.pendingWordVote;
    if(!room||!vote||vote.phase!=="voting"||!vote.voterIds.includes(socket.id)||vote.votes.has(socket.id)) return;
    const voterName=room.players.get(socket.id)?.name||"Spēlētājs";
    if(accept!==true){rejectWordVote(roomId,room,vote,"Balsojums noraidīts.",voterName);return;}
    vote.votes.set(socket.id,true);
    emitWordVoteUpdate(roomId,vote);
    if(vote.voterIds.every(id=>vote.votes.get(id)===true)){
      detachPendingWordVote(room);
      applyUnanimouslyAcceptedMove(roomId,room,vote).catch(error=>{
        console.error("Vienbalsīgi pieņemtā gājiena kļūda:",error);
        resumeTurnAfterWordVote(roomId,room);emitState(roomId);
      });
    }
  });

  socket.on("cancelWordVote",({roomId})=>{
    const room=rooms.get(roomId);
    const vote=room?.pendingWordVote;
    if(!room||!vote||vote.by!==socket.id) return;
    const wasVoting=vote.phase==="voting";
    detachPendingWordVote(room);
    if(wasVoting){
      pushWordVoteChat(room,"⚪ Balsojums",vote.byName+" atcēla balsošanu par "+wordVoteWordsText(vote.words)+".");
      io.to(roomId).emit("effect",{type:"wordVoteResolved",accepted:false,words:vote.words,reason:"Gājiena autors atcēla balsošanu."});
    }else io.to(socket.id).emit("effect",{type:"wordVoteCancelled",reason:"Balsošana atcelta."});
    resumeTurnAfterWordVote(roomId,room);emitState(roomId);
  });`;

  source = source.slice(0, commitStart) + replacement + source.slice(commitEnd);

  const draftMarker = '    if(!room||!room.started) return;\n    if(!room.players.has(socket.id)) return;\n    if(currentTurnId(room)!==socket.id) return;\n    setDraft(room,socket.id,placements||[]);';
  source = replaceOnce(source, draftMarker, '    if(!room||!room.started) return;\n    if(room.pendingWordVote) return;\n    if(!room.players.has(socket.id)) return;\n    if(currentTurnId(room)!==socket.id) return;\n    setDraft(room,socket.id,placements||[]);', 'Neizdevās bloķēt melnrakstu balsošanas laikā.');

  const draftClearMarker = '    if(!room) return;\n    if(room.draft?.by===socket.id){ room.draft=null; emitState(roomId); }';
  source = replaceOnce(source, draftClearMarker, '    if(!room) return;\n    if(room.pendingWordVote) return;\n    if(room.draft?.by===socket.id){ room.draft=null; emitState(roomId); }', 'Neizdevās bloķēt melnraksta dzēšanu balsošanas laikā.');

  const passMarker = '    if(!room||!room.started) return;\n    if(!room.players.has(socket.id)) return;\n    if(currentTurnId(room)!==socket.id) return;\n\n    room.passStreak.set(socket.id, (room.passStreak.get(socket.id)||0) + 1);';
  source = replaceOnce(source, passMarker, '    if(!room||!room.started) return;\n    if(room.pendingWordVote) return io.to(socket.id).emit("toast","Vispirms pabeidziet vārda balsošanu.");\n    if(!room.players.has(socket.id)) return;\n    if(currentTurnId(room)!==socket.id) return;\n\n    room.passStreak.set(socket.id, (room.passStreak.get(socket.id)||0) + 1);', 'Neizdevās bloķēt gājiena izlaišanu balsošanas laikā.');

  const exchangeMarker = '    if(!room||!room.started) return;\n    const pid=socket.id;\n    if(!room.players.has(pid)) return;\n    if(currentTurnId(room)!==pid) return;';
  source = replaceOnce(source, exchangeMarker, '    if(!room||!room.started) return;\n    if(room.pendingWordVote) return io.to(socket.id).emit("toast","Vispirms pabeidziet vārda balsošanu.");\n    const pid=socket.id;\n    if(!room.players.has(pid)) return;\n    if(currentTurnId(room)!==pid) return;', 'Neizdevās bloķēt kauliņu maiņu balsošanas laikā.');

  const swapBlankMarker = '  socket.on("swapBlank",({roomId,x,y,rackTileId})=>{\n    const room=rooms.get(roomId);\n    if(!room||!room.started) return;\n    const pid=socket.id;';
  source = replaceOnce(source, swapBlankMarker, '  socket.on("swapBlank",({roomId,x,y,rackTileId})=>{\n    const room=rooms.get(roomId);\n    if(!room||!room.started) return;\n    if(room.pendingWordVote) return io.to(socket.id).emit("toast","Vispirms pabeidziet vārda balsošanu.");\n    const pid=socket.id;', 'Neizdevās bloķēt tukšā kauliņa maiņu balsošanas laikā.');

  const leaveMarker = '    const pid=socket.id;\n    if(!room.players.has(pid)) return;\n\n    const p=room.players.get(pid);';
  source = replaceOnce(source, leaveMarker, '    const pid=socket.id;\n    if(!room.players.has(pid)) return;\n    cancelWordVoteForDeparture(roomId,room,pid);\n\n    const p=room.players.get(pid);', 'Neizdevās atcelt balsošanu, spēlētājam pametot partiju.');

  const disconnectMarker = '      if(room.players.has(socket.id)){\n        if(room.draft?.by===socket.id) room.draft=null;';
  source = replaceOnce(source, disconnectMarker, '      if(room.players.has(socket.id)){\n        cancelWordVoteForDeparture(roomId,room,socket.id);\n        if(room.draft?.by===socket.id) room.draft=null;', 'Neizdevās atcelt balsošanu spēlētāja atvienošanās laikā.');

  return source;
}

function patchWordVoteInterface(source) {
  if (!source.includes('/word-vote.css')) source = source.replace('</head>', '<link rel="stylesheet" href="/word-vote.css">\n</head>');
  if (!source.includes('/word-vote.js')) source = source.replace('</body>', '<script src="/word-vote.js"></script>\n</body>');
  const achievementChat = '<div class="chat-msg ${m.achievement?\'achievement-chat\':\'\'}"><b>${esc(m.name)}</b> ${esc(m.msg)}</div>';
  if (source.includes(achievementChat)) {
    source = source.replace(achievementChat, '<div class="chat-msg ${m.achievement?\'achievement-chat\':(m.wordVote?\'word-vote-chat\':\'\')}"><b>${esc(m.name)}</b> ${esc(m.msg)}</div>');
  }
  return source;
}

module.exports = { patchWordVoteServer, patchWordVoteInterface, replaceOnce };
