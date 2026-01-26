const express = require("express");
const http = require("http");
const https = require("https");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const MAX_PLAYERS = 4;

const WINS_FILE = path.join(__dirname, "wins.json");
function loadWins(){ try { return JSON.parse(fs.readFileSync(WINS_FILE, "utf8")) || {}; } catch { return {}; } }
function saveWins(obj){ try { fs.writeFileSync(WINS_FILE, JSON.stringify(obj, null, 2)); } catch {} }
let winsByName = loadWins();
function topWins(limit = 10){
  return Object.entries(winsByName)
    .map(([name, wins]) => ({ name, wins: Number(wins) || 0 }))
    .sort((a,b)=>(b.wins-a.wins) || a.name.localeCompare(b.name))
    .slice(0, limit);
}
function emitPublic(toSocketId=null){
  const payload = { leaderboardTop: topWins(10) };
  if(toSocketId) io.to(toSocketId).emit("public", payload);
  else io.emit("public", payload);
}

/** LV Scrabble kauliņi (104) */
const LV_TILES = [
  { ch: "_", count: 2, pts: 0 },
  { ch: "a", count: 11, pts: 1 }, { ch: "i", count: 9, pts: 1 }, { ch: "s", count: 8, pts: 1 },
  { ch: "e", count: 6, pts: 1 },  { ch: "t", count: 6, pts: 1 }, { ch: "r", count: 5, pts: 1 }, { ch: "u", count: 5, pts: 1 },
  { ch: "ā", count: 4, pts: 2 },  { ch: "k", count: 4, pts: 2 }, { ch: "m", count: 4, pts: 2 }, { ch: "n", count: 4, pts: 2 },
  { ch: "l", count: 3, pts: 2 },  { ch: "p", count: 3, pts: 2 },
  { ch: "d", count: 3, pts: 3 },  { ch: "o", count: 3, pts: 3 }, { ch: "v", count: 3, pts: 3 }, { ch: "z", count: 2, pts: 3 },
  { ch: "ē", count: 2, pts: 4 },  { ch: "ī", count: 2, pts: 4 }, { ch: "j", count: 2, pts: 4 },
  { ch: "b", count: 1, pts: 5 },  { ch: "c", count: 1, pts: 5 }, { ch: "g", count: 1, pts: 5 },
  { ch: "ņ", count: 1, pts: 6 },  { ch: "š", count: 1, pts: 6 }, { ch: "ū", count: 1, pts: 6 },
  { ch: "ļ", count: 1, pts: 8 },  { ch: "ž", count: 1, pts: 8 },
  { ch: "č", count: 1, pts: 10 }, { ch: "f", count: 1, pts: 10 }, { ch: "ģ", count: 1, pts: 10 },
  { ch: "h", count: 1, pts: 10 }, { ch: "ķ", count: 1, pts: 10 },
];

const LV_ALPHA = ["a","ā","b","c","č","d","e","ē","f","g","ģ","h","i","ī","j","k","ķ","l","ļ","m","n","ņ","o","p","r","s","š","t","u","ū","v","z","ž"];
const LV_ALPHA_INDEX = new Map(LV_ALPHA.map((ch, i) => [ch, i]));
const alphaRank = (ch) => LV_ALPHA_INDEX.has(String(ch||"").toLowerCase()) ? LV_ALPHA_INDEX.get(String(ch||"").toLowerCase()) : 999;

function buildBag(){ const bag=[]; for(const t of LV_TILES) for(let i=0;i<t.count;i++) bag.push({ch:t.ch,pts:t.pts}); return bag; }

function buildMultipliers(){
  const lm = Array.from({ length: 15 }, () => Array(15).fill(1));
  const wm = Array.from({ length: 15 }, () => Array(15).fill(1));
  const label = Array.from({ length: 15 }, () => Array(15).fill(""));
  const TW = [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]];
  const DW = [[1,1],[2,2],[3,3],[4,4],[7,7],[10,10],[11,11],[12,12],[13,13],[1,13],[2,12],[3,11],[4,10],[10,4],[11,3],[12,2],[13,1]];
  const TL = [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]];
  const DL = [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]];
  for (const [x,y] of TW) { wm[y][x] = 3; label[y][x] = "TW"; }
  for (const [x,y] of DW) { wm[y][x] = 2; label[y][x] = (x===7&&y===7) ? "★" : "DW"; }
  for (const [x,y] of TL) { lm[y][x] = 3; label[y][x] = "TL"; }
  for (const [x,y] of DL) { lm[y][x] = 2; label[y][x] = "DL"; }
  return { lm, wm, label };
}

function makeRoom(){
  return {
    bag: buildBag(),
    nextTileId: 1,
    board: Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => null)),
    mult: buildMultipliers(),
    players: new Map(),
    spectators: new Map(),
    started: false,
    gameStartAt: null,
    turnOrder: [],
    turnIndex: 0,
    turnEndsAt: null,
    turnTimeSec: 0,
    draft: null,
    ready: new Set(),
    turnTimeout: null,
    chat: [],
    lastGameOver: null,
    passStreak: new Map(),
    last3: [],
  };
}

function drawTiles(room,n){
  const tiles=[];
  for(let i=0;i<n;i++){
    if(room.bag.length===0) break;
    const idx=Math.floor(Math.random()*room.bag.length);
    const base=room.bag.splice(idx,1)[0];
    tiles.push({ id:String(room.nextTileId++), ch:base.ch, pts:base.pts, blank:base.ch==="_" });
  }
  return tiles;
}
function returnRackToBag(room, rack){
  for(const t of (rack||[])){
    if(t.blank) room.bag.push({ch:"_", pts:0});
    else room.bag.push({ch:t.ch, pts:t.pts});
  }
}

const inBounds=(x,y)=>x>=0&&x<15&&y>=0&&y<15;
function isBoardEmpty(room){ for(let y=0;y<15;y++) for(let x=0;x<15;x++) if(room.board[y][x]) return false; return true; }
function tileAt(room,x,y,pm){ if(!inBounds(x,y)) return null; return pm.get(`${x},${y}`) ?? room.board[y][x]; }

function buildWord(room,x,y,dx,dy,pm){
  let sx=x, sy=y;
  while(inBounds(sx-dx,sy-dy) && tileAt(room,sx-dx,sy-dy,pm)){ sx-=dx; sy-=dy; }
  let word=""; const cells=[];
  let cx=sx, cy=sy;
  while(inBounds(cx,cy) && tileAt(room,cx,cy,pm)){
    const t=tileAt(room,cx,cy,pm);
    word += t.ch;
    cells.push({x:cx,y:cy,t});
    cx+=dx; cy+=dy;
  }
  return { word, cells };
}

function scoreWord(room, wordCells, newSet){
  let sum=0, wmult=1;
  for(const c of wordCells){
    const k=`${c.x},${c.y}`;
    const isNew=newSet.has(k);
    const lm=isNew?room.mult.lm[c.y][c.x]:1;
    const wm=isNew?room.mult.wm[c.y][c.x]:1;
    sum += (c.t.pts||0)*lm;
    wmult *= wm;
  }
  return sum*wmult;
}

function isAllConnected(room, pm){
  let start=null;
  for(let y=0;y<15 && !start;y++) for(let x=0;x<15 && !start;x++) if(tileAt(room,x,y,pm)) start={x,y};
  if(!start) return true;
  const q=[start]; const seen=new Set([`${start.x},${start.y}`]);
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  while(q.length){
    const cur=q.shift();
    for(const [dx,dy] of dirs){
      const nx=cur.x+dx, ny=cur.y+dy;
      if(!inBounds(nx,ny)) continue;
      if(!tileAt(room,nx,ny,pm)) continue;
      const k=`${nx},${ny}`;
      if(seen.has(k)) continue;
      seen.add(k); q.push({x:nx,y:ny});
    }
  }
  for(let y=0;y<15;y++) for(let x=0;x<15;x++) if(tileAt(room,x,y,pm) && !seen.has(`${x},${y}`)) return false;
  return true;
}

function validateAndScoreMove(room, playerId, placements){
  if(!placements||placements.length===0) return {ok:false, err:"Nav ielikti kauliņi."};
  const player=room.players.get(playerId);
  if(!player) return {ok:false, err:"Spēlētājs nav atrasts."};

  const rackById=new Map(player.rack.map(t=>[t.id,t]));
  const pm=new Map();
  const newSet=new Set();

  for(const p of placements){
    const x=Number(p.x), y=Number(p.y);
    if(!inBounds(x,y)) return {ok:false, err:"Ārpus laukuma."};
    if(room.board[y][x]) return {ok:false, err:`Lauciņš jau aizņemts (${x},${y}).`};

    const t=rackById.get(String(p.tileId));
    if(!t) return {ok:false, err:"Nav tāda kauliņa tavos kauliņos."};

    let ch=t.ch, pts=t.pts, blank=t.blank;
    if(blank){
      const as=String(p.as||"").toLowerCase();
      if(!as||as.length!==1) return {ok:false, err:"Blank kauliņam jāizvēlas burts."};
      ch=as; pts=0; blank=true;
    }

    const k=`${x},${y}`;
    if(pm.has(k)) return {ok:false, err:"Divi kauliņi vienā lauciņā."};
    pm.set(k,{id:t.id,ch,pts,blank});
    newSet.add(k);
  }

  const xs=placements.map(p=>Number(p.x));
  const ys=placements.map(p=>Number(p.y));
  const sameRow=ys.every(v=>v===ys[0]);
  const sameCol=xs.every(v=>v===xs[0]);
  if(!sameRow && !sameCol) return {ok:false, err:"Kauliņi jāliek vienā rindā vai kolonnā."};

  let dx=0, dy=0;
  if(sameRow){ dx=1; dy=0; } else { dx=0; dy=1; }

  const minX=Math.min(...xs), maxX=Math.max(...xs);
  const minY=Math.min(...ys), maxY=Math.max(...ys);

  if(sameRow){
    const y=ys[0];
    for(let x=minX;x<=maxX;x++) if(!tileAt(room,x,y,pm)) return {ok:false, err:"Vārdā ir caurums."};
  }else{
    const x=xs[0];
    for(let y=minY;y<=maxY;y++) if(!tileAt(room,x,y,pm)) return {ok:false, err:"Vārdā ir caurums."};
  }

  const empty=isBoardEmpty(room);
  if(empty){
    if(!pm.has("7,7")) return {ok:false, err:"Pirmajam vārdam jāiet caur centru (★)."};
  }else{
    const touchesExisting = placements.some(p=>{
      const x=Number(p.x), y=Number(p.y);
      const left=tileAt(room,x-1,y,pm), right=tileAt(room,x+1,y,pm), up=tileAt(room,x,y-1,pm), down=tileAt(room,x,y+1,pm);
      return (
        (left  && !pm.has(`${x-1},${y}`)) ||
        (right && !pm.has(`${x+1},${y}`)) ||
        (up    && !pm.has(`${x},${y-1}`)) ||
        (down  && !pm.has(`${x},${y+1}`))
      );
    });
    if(!touchesExisting) return {ok:false, err:"Jaunajam vārdam jābūt saistītam ar esošajiem (jāpieskaras)."};
  }

  if(!isAllConnected(room,pm)) return {ok:false, err:"Neatļauts izvietojums (nav viena savienota struktūra)."};

  const anchor=placements[0];
  if(placements.length===1 && !empty){
    const ax=Number(anchor.x), ay=Number(anchor.y);
    const hasH=!!tileAt(room,ax-1,ay,pm)||!!tileAt(room,ax+1,ay,pm);
    const hasV=!!tileAt(room,ax,ay-1,pm)||!!tileAt(room,ax,ay+1,pm);
    if(hasV && !hasH){ dx=0; dy=1; } else { dx=1; dy=0; }
  }

  const main=buildWord(room,Number(anchor.x),Number(anchor.y),dx,dy,pm);
  const words=[]; let total=0;

  if(main.word.length>1){
    const sc=scoreWord(room,main.cells,newSet);
    words.push({word:main.word, score:sc});
    total+=sc;
  }

  for(const p of placements){
    const x=Number(p.x), y=Number(p.y);
    const cross=buildWord(room,x,y,dy,dx,pm);
    if(cross.word.length>1){
      const sc=scoreWord(room,cross.cells,newSet);
      words.push({word:cross.word, score:sc});
      total+=sc;
    }
  }

  if(words.length===0) return {ok:false, err:"Jāizveido vismaz viens vārds ar 2+ burtiem."};
  if(placements.length===7){ words.push({word:"BONUS", score:50}); total+=50; }

  return {ok:true, total, words, placements, placementsMap:pm};
}

function applyMove(room, playerId, placements, pm){
  const player=room.players.get(playerId);
  const usedIds=new Set(placements.map(p=>String(p.tileId)));
  for(const p of placements){
    const x=Number(p.x), y=Number(p.y);
    const t=pm.get(`${x},${y}`);
    room.board[y][x] = { ch:t.ch, pts:t.pts, blank:t.blank };
  }
  player.rack = player.rack.filter(t=>!usedIds.has(String(t.id)));
  player.rack.push(...drawTiles(room, Math.max(0, 7-player.rack.length)));
}

const currentTurnId=(room)=> (!room.started||room.turnOrder.length===0) ? null : (room.turnOrder[room.turnIndex]||null);
const rooms = new Map();

let onlineCount = 0;
const broadcastOnline = ()=> io.emit("online", onlineCount);

function stopTurnTimer(room){
  if(room.turnTimeout){ clearTimeout(room.turnTimeout); room.turnTimeout=null; }
  room.turnEndsAt=null;
}
function startTurnTimer(roomId){
  const room=rooms.get(roomId);
  if(!room) return;
  stopTurnTimer(room);
  if(!room.started || !room.turnTimeSec || room.turnTimeSec<=0 || room.turnOrder.length===0) return;

  room.turnEndsAt = Date.now() + room.turnTimeSec*1000;
  room.turnTimeout = setTimeout(()=>{
    if(!room.started) return;
    const by=currentTurnId(room);
    const byName=by && room.players.get(by) ? room.players.get(by).name : "?";

    if(by){
      room.passStreak.set(by, (room.passStreak.get(by)||0) + 1);
      checkAllPassedTwice(roomId);
    }

    io.to(roomId).emit("effect",{type:"timeout", by, byName});
    room.draft=null;
    room.turnIndex = (room.turnIndex+1) % room.turnOrder.length;
    startTurnTimer(roomId);
    emitState(roomId);
  }, room.turnTimeSec*1000);
}

function roomsSummary(){
  const arr=[];
  for(const [roomId, room] of rooms.entries()){
    const playersCount = room.players.size;
    const spectatorsCount = room.spectators.size;
    if(playersCount + spectatorsCount === 0) continue;
    arr.push({ roomId, players: playersCount, spectators: spectatorsCount, started: !!room.started });
  }
  arr.sort((a,b)=>(Number(b.started)-Number(a.started)) || a.roomId.localeCompare(b.roomId));
  return arr;
}
function emitRoomsList(toSocketId=null){
  const payload = { rooms: roomsSummary() };
  if(toSocketId) io.to(toSocketId).emit("roomsList", payload);
  else io.emit("roomsList", payload);
}

function emitState(roomId){
  const room=rooms.get(roomId);
  if(!room) return;

  const publicPlayers=[...room.players.entries()].map(([id,p])=>({id,name:p.name,score:p.score,rackCount:p.rack.length}));
  const turnId=currentTurnId(room);
  const turnName=turnId && room.players.get(turnId) ? room.players.get(turnId).name : null;

  const readyIds=[...room.ready.values()];
  const readyNames=readyIds.map(id=>room.players.get(id)?.name).filter(Boolean);

  const draftPublic = room.draft ? { by:room.draft.by, byName:room.draft.byName, cells:room.draft.cells, ts:room.draft.ts } : null;
  const chatPublic = room.chat.slice(-50);
  const last3Public = (room.last3||[]).slice(0,3);

  for(const [viewerId, viewer] of room.players.entries()){
    if(typeof isBotId==='function' && isBotId(viewerId)) continue;
    io.to(viewerId).emit("state",{
      role: "player",
      roomId,
      meId: viewerId,
      started: room.started,
      gameStartAt: room.gameStartAt,
      lastGameOver: room.lastGameOver,
      turnId, turnName, turnTimeSec: room.turnTimeSec, turnEndsAt: room.turnEndsAt,
      bagCount: room.bag.length,
      board: room.board,
      multLabel: room.mult.label,
      players: publicPlayers,
      myRack: viewer.rack,
      readyIds, readyNames,
      draft: draftPublic,
      chat: chatPublic,
      leaderboardTop: topWins(10),
      spectatorsCount: room.spectators.size,
      maxPlayers: MAX_PLAYERS,
      last3: last3Public
    });
  }

  for(const [sid, spec] of room.spectators.entries()){
    io.to(sid).emit("state",{
      role: "spectator",
      roomId,
      meId: sid,
      started: room.started,
      gameStartAt: room.gameStartAt,
      lastGameOver: room.lastGameOver,
      turnId, turnName, turnTimeSec: room.turnTimeSec, turnEndsAt: room.turnEndsAt,
      bagCount: room.bag.length,
      board: room.board,
      multLabel: room.mult.label,
      players: publicPlayers,
      myRack: [],
      readyIds, readyNames,
      draft: draftPublic,
      chat: chatPublic,
      leaderboardTop: topWins(10),
      spectatorsCount: room.spectators.size,
      maxPlayers: MAX_PLAYERS,
      spectatorName: spec?.name || "Skatītājs",
      last3: last3Public
    });
  }
}

function setDraft(room, socketId, placements){
  const player=room.players.get(socketId);
  if(!player) return;
  if(!placements || placements.length===0){ room.draft=null; return; }

  const rackById=new Map(player.rack.map(t=>[String(t.id),t]));
  const usedIds=new Set();
  const usedCells=new Set();
  const cells=[];

  for(const p of placements){
    const x=Number(p.x), y=Number(p.y);
    if(!inBounds(x,y)) continue;
    if(room.board[y][x]) continue;

    const ck=`${x},${y}`;
    if(usedCells.has(ck)) continue;
    usedCells.add(ck);

    const t=rackById.get(String(p.tileId));
    if(!t) continue;
    if(usedIds.has(String(t.id))) continue;
    usedIds.add(String(t.id));

    let ch=t.ch, pts=t.pts, blank=t.blank;
    if(blank){
      const as=String(p.as||"").toLowerCase();
      ch = (as && as.length===1) ? as : "_";
      pts = 0; blank=true;
    }

    const m=room.mult.label?.[y]?.[x] || "";
    cells.push({x,y,ch,pts,blank,m});
  }
  room.draft = { by:socketId, byName:player.name, cells, ts:Date.now() };
}

function computeTurnOrderByLetter(room){
  const ids=[...room.players.keys()];
  const draws=new Map();
  function drawOne(){
    if(room.bag.length===0) return {ch:"_",pts:0};
    const idx=Math.floor(Math.random()*room.bag.length);
    return room.bag.splice(idx,1)[0];
  }
  for(const id of ids) draws.set(id, drawOne());

  while(true){
    const byRank=new Map();
    for(const [id,t] of draws.entries()){
      const r=alphaRank(t.ch);
      if(!byRank.has(r)) byRank.set(r,[]);
      byRank.get(r).push(id);
    }
    const ties=[...byRank.entries()].filter(([,arr])=>arr.length>1);
    if(ties.length===0) break;
    for(const [,arr] of ties){
      for(const id of arr){ const old=draws.get(id); if(old) room.bag.push(old); }
      for(const id of arr) draws.set(id, drawOne());
    }
  }

  const drawPublic={};
  for(const [id,t] of draws.entries()){
    drawPublic[id] = { ch:t.ch, rank: alphaRank(t.ch) };
    room.bag.push(t);
  }
  const order = ids.slice().sort((a,b)=> drawPublic[a].rank - drawPublic[b].rank);
  return { order, drawPublic };
}

function finalizeGame(roomId, reason){
  const room=rooms.get(roomId);
  if(!room) return;

  const durationMs = room.gameStartAt ? (Date.now() - room.gameStartAt) : 0;
  const final=[...room.players.values()].map(p=>({name:p.name, score:p.score})).sort((a,b)=>b.score-a.score);
  const winner = final[0] || {name:"—", score:0};

  if(winner && winner.name && winner.name!=="—"){
    winsByName[winner.name] = (Number(winsByName[winner.name]) || 0) + 1;
    saveWins(winsByName);
    emitPublic();
  }

  room.started=false;
  stopTurnTimer(room);
  room.draft=null;

  room.lastGameOver = { winnerName: winner.name, winnerScore: winner.score, final, at: Date.now(), durationMs, reason };

  io.to(roomId).emit("effect",{ type:"gameOver", winnerName:winner.name, winnerScore:winner.score, final, durationMs, reason });
  emitState(roomId);
  emitRoomsList();
}

function checkAllPassedTwice(roomId){
  const room=rooms.get(roomId);
  if(!room || !room.started) return;
  if(room.players.size < 2) return;
  for(const id of room.players.keys()){
    if((room.passStreak.get(id)||0) < 2) return;
  }
  finalizeGame(roomId, "Visi spēlētāji 2x pēc kārtas izlaida gājienu");
}

function endByEmptyRack(roomId, winnerId){
  const room=rooms.get(roomId);
  if(!room) return;
  const winner=room.players.get(winnerId);
  if(!winner) return;

  let transfer=0;
  for(const [id,p] of room.players.entries()){
    if(id===winnerId) continue;
    transfer += (p.rack||[]).reduce((s,t)=>s+(t.pts||0),0);
  }
  winner.score += transfer;

  const durationMs = room.gameStartAt ? (Date.now() - room.gameStartAt) : 0;

  winsByName[winner.name] = (Number(winsByName[winner.name]) || 0) + 1;
  saveWins(winsByName);
  emitPublic();

  const final=[...room.players.values()].map(p=>({name:p.name, score:p.score})).sort((a,b)=>b.score-a.score);

  room.started=false;
  stopTurnTimer(room);
  room.draft=null;

  room.lastGameOver = { winnerName: winner.name, winnerScore: winner.score, transfer, final, at: Date.now(), durationMs, reason:"Beidzās kauliņi" };

  io.to(roomId).emit("effect",{ type:"gameOver", winnerName:winner.name, winnerScore:winner.score, transfer, final, durationMs, reason:"Beidzās kauliņi" });
  emitState(roomId);
  emitRoomsList();
}

function isParticipant(room, sid){ return room.players.has(sid) || room.spectators.has(sid); }
function getDisplayName(room, sid){
  if(room.players.has(sid)) return room.players.get(sid).name;
  if(room.spectators.has(sid)) return room.spectators.get(sid).name || "Skatītājs";
  return "Skatītājs";
}
function removePlayerFromTurnOrder(room, pid){
  const idx=room.turnOrder.indexOf(pid);
  if(idx!==-1){
    room.turnOrder.splice(idx,1);
    if(room.turnOrder.length===0) return;
    if(room.turnIndex>=room.turnOrder.length) room.turnIndex=0;
    if(idx<room.turnIndex) room.turnIndex=Math.max(0,room.turnIndex-1);
  }
}

/* -------------------- Tezaurs (NEBLOĶĒ gājienu) -------------------- */
function httpGet(url, timeoutMs=2000){
  return new Promise((resolve, reject)=>{
    const lib = url.startsWith("https://") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent":"Burtnieks/1.0" } }, (res)=>{
      let data="";
      res.setEncoding("utf8");
      res.on("data",(c)=>data+=c);
      res.on("end",()=>resolve({status:res.statusCode||0, headers:res.headers||{}, body:data}));
    });
    req.on("error",reject);
    req.setTimeout(timeoutMs, ()=>{ req.destroy(new Error("timeout")); });
  });
}

const wordCache = new Map(); // word -> {ok, tezaursId, lemma, morph, meaning, ts}
function cacheGet(word){
  const v=wordCache.get(word);
  if(!v) return null;
  if(Date.now()-v.ts > 1000*60*60*24*7){ wordCache.delete(word); return null; }
  return v;
}
function pickBestAnalysis(word, arr){
  const w=String(word||"").toLowerCase();
  const candidates = arr.filter(a=>String(a["Šķirkļa cilvēklasāmais ID"]||"").toLowerCase().startsWith(w+":"));
  return (candidates[0] || arr[0] || null);
}
function stripHtmlToText(html){
  let t = String(html||"");
  t = t.replace(/<script[\s\S]*?<\/script>/gi," ");
  t = t.replace(/<style[\s\S]*?<\/style>/gi," ");
  t = t.replace(/<\/(p|div|br|li|h\d)>/gi,"\n");
  t = t.replace(/<[^>]+>/g," ");
  t = t.replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");
  t = t.replace(/\s+\n/g,"\n").replace(/\n\s+/g,"\n").replace(/[ \t]{2,}/g," ").trim();
  return t;
}
function extractMeaningFromTezaursHtml(html){
  const h=String(html||"");
  const og = h.match(/property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if(og && og[1]) return og[1].trim();
  const md = h.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if(md && md[1]) return md[1].trim();

  const text = stripHtmlToText(h);
  const lines = text.split("\n").map(s=>s.trim()).filter(Boolean);
  for(const ln of lines){
    if(ln.length < 15) continue;
    return ln.slice(0,220);
  }
  return "";
}

// ✅ NEBLOĶĒ: ja Tezaurs neatpazīst (īpašvārds/saīsinājums) – vienalga ok:true
async function infoFromTezaurs(word){
  const w = String(word||"").toLowerCase();
  if(!w || w==="bonus") return { ok:true, word:w, ts:Date.now() };

  const cached = cacheGet(w);
  if(cached) return cached;

  let morph = {
    word: w,
    tezaursId: (w + ":1"),
    lemma: w,
    "Vārdšķira": "",
    "Skaitlis": "",
    "Locījums": "",
    "Dzimte": "",
    "Deklinācija": "",
    "Lietojums": "",
    "FreeText": ""
  };

  // mēģinam /analyze (ja ir — parādām morfoloģiju)
  try{
    const res = await httpGet("http://api.tezaurs.lv:8182/analyze/" + encodeURIComponent(w), 1800);
    let arr=null;
    try{ arr = JSON.parse(res.body); }catch{ arr=null; }
    if(Array.isArray(arr) && arr.length){
      const best = pickBestAnalysis(w, arr);
      const tezaursId = String(best?.["Šķirkļa cilvēklasāmais ID"] || "").trim();
      const lemma = String(best?.["Pamatforma"] || w).trim().toLowerCase();
      morph = {
        word: w,
        tezaursId: tezaursId || (w + ":1"),
        lemma,
        "Vārdšķira": best?.["Vārdšķira"] || "",
        "Skaitlis": best?.["Skaitlis"] || "",
        "Locījums": best?.["Locījums"] || "",
        "Dzimte": best?.["Dzimte"] || "",
        "Deklinācija": best?.["Deklinācija"] || "",
        "Lietojums": best?.["Lietojums"] || "",
        "FreeText": best?.["FreeText"] || ""
      };
    }
  }catch{}

  // mēģinam skaidrojumu no tezaurs.lv (ja nav, tas arī ok)
  let meaning = "";
  try{
    const tUrl = "https://tezaurs.lv/" + encodeURIComponent(morph.tezaursId);
    const page = await httpGet(tUrl, 2200);
    meaning = extractMeaningFromTezaursHtml(page.body || "");
  }catch{
    meaning = "";
  }

  const summaryParts = [morph["Vārdšķira"], morph["Skaitlis"], morph["Locījums"], morph["Dzimte"]].filter(Boolean);
  const out = { ok:true, word:w, tezaursId:morph.tezaursId, lemma:morph.lemma, morph, meaning, summary: summaryParts.join(" · "), ts:Date.now() };
  wordCache.set(w,out);
  return out;
}


// ✅ Stingra pārbaude: atļauj tikai parastus vārdus (ne īpašvārdus, ne saīsinājumus)
const strictCache = new Map(); // word -> {ok, reason, morph, ts}

function looksLikeProperOrAbbrev(analysis){
  const vals = Object.values(analysis || {}).map(v => String(v || "").toLowerCase());
  const blob = vals.join(" | ");

  const isAbbrev =
    blob.includes("saīsin") ||
    blob.includes("abrevi") ||
    blob.includes("akron") ||
    blob.includes("iniciāl") ||
    blob.includes("saīs.");

  const isProper =
    blob.includes("īpašvār") ||
    blob.includes("topon") ||          // vietvārds
    blob.includes("hidron") ||         // upes u.c.
    blob.includes("apdzīv") ||         // apdzīvota vieta
    blob.includes("pilsēt") ||
    blob.includes("upe") ||
    blob.includes("ezers") ||
    blob.includes("uzvār") ||
    blob.includes("personvār") ||
    blob.includes("organiz") ||
    blob.includes("nosaukums");

  return { isAbbrev, isProper };
}

async function verifyWordStrict(word){
  const w = String(word || "").toLowerCase().trim();
  if(!w || w === "bonus") return { ok:true, word:w };

  const cached = strictCache.get(w);
  if(cached && (Date.now() - cached.ts) < 1000*60*60*24*7) return cached;

  let arr = null;
  try{
    const res = await httpGet("http://api.tezaurs.lv:8182/analyze/" + encodeURIComponent(w), 1800);
    arr = JSON.parse(res.body);
  }catch{
    const out = { ok:false, word:w, reason:"Tezaurs nav sasniedzams", ts:Date.now() };
    strictCache.set(w, out);
    return out;
  }

  if(!Array.isArray(arr) || arr.length === 0){
    const out = { ok:false, word:w, reason:"Nav vārdnīcā", ts:Date.now() };
    strictCache.set(w, out);
    return out;
  }

  let allowed = null;
  for(const a of arr){
    const { isAbbrev, isProper } = looksLikeProperOrAbbrev(a);
    if(!isAbbrev && !isProper){
      allowed = a;
      break;
    }
  }

  if(!allowed){
    const out = { ok:false, word:w, reason:"Īpašvārds/saīsinājums nav atļauts", ts:Date.now() };
    strictCache.set(w, out);
    return out;
  }

  const tezaursId = String(allowed["Šķirkļa cilvēklasāmais ID"] || (w + ":1")).trim();
  const lemma = String(allowed["Pamatforma"] || w).trim().toLowerCase();

  const out = {
    ok:true,
    word:w,
    tezaursId,
    lemma,
    morph: {
      word: w,
      tezaursId,
      lemma,
      "Vārdšķira": allowed["Vārdšķira"] || "",
      "Skaitlis": allowed["Skaitlis"] || "",
      "Locījums": allowed["Locījums"] || "",
      "Dzimte": allowed["Dzimte"] || "",
      "Deklinācija": allowed["Deklinācija"] || "",
      "Lietojums": allowed["Lietojums"] || "",
      "FreeText": allowed["FreeText"] || ""
    },
    ts: Date.now()
  };

  strictCache.set(w, out);
  return out;
}

const inflCache = new Map();
function inflCacheGet(lemma){
  const v=inflCache.get(lemma);
  if(!v) return null;
  if(Date.now()-v.ts > 1000*60*60*24*7){ inflCache.delete(lemma); return null; }
  return v;
}
async function getInflections(lemma){
  const l = String(lemma||"").toLowerCase().trim();
  if(!l) return { ok:false, err:"Nav lemma" };
  const cached = inflCacheGet(l);
  if(cached) return { ok:true, lemma:l, paradigm:cached.paradigm, data:cached.data };

  let sp;
  try{ sp = await httpGet("http://api.tezaurs.lv:8182/suitable_paradigm/" + encodeURIComponent(l), 2500); }
  catch{ return { ok:false, err:"Tezaurs serviss nav pieejams (suitable_paradigm)." }; }

  let paradigm = "";
  try{
    const j = JSON.parse(sp.body);
    if(Array.isArray(j) && j.length){
      const first = j[0];
      paradigm = (typeof first==="string") ? first : (first?.paradigm || first?.name || "");
    }
  }catch{}
  if(!paradigm){
    const m = String(sp.body||"").match(/[a-z]+-\d+[a-z]?/i);
    if(m) paradigm = m[0];
  }
  if(!paradigm) return { ok:false, err:"Neizdevās noteikt paradigmu." };

  let inf;
  try{
    inf = await httpGet("http://api.tezaurs.lv:8182/v1/inflections/" + encodeURIComponent(l) + "?paradigm=" + encodeURIComponent(paradigm), 3000);
  }catch{
    return { ok:false, err:"Tezaurs serviss nav pieejams (inflections)." };
  }

  let data=null;
  try{ data = JSON.parse(inf.body); } catch { data = inf.body; }
  inflCache.set(l, { paradigm, data, ts:Date.now() });
  return { ok:true, lemma:l, paradigm, data };
}
app.get("/api/inflections", async (req,res)=>{
  const lemma = String(req.query.lemma||"").toLowerCase().trim();
  const out = await getInflections(lemma);
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.end(JSON.stringify(out));
});
/* ------------------------------------------------------------- */


/* ==================== BOT (virtuālais spēlētājs) ==================== */
function makeBotId(roomId){ return "__BOT__" + String(roomId||""); }
function isBotId(id){ return String(id||"").startsWith("__BOT__"); }

function ensureBot(roomId){
  const room = rooms.get(roomId);
  if(!room) return null;
  const botId = makeBotId(roomId);
  if(room.players.has(botId)) return botId;

  room.players.set(botId, { name:"Dators", rack: [], score: 0, isBot:true });
  room.passStreak.set(botId, 0);
  return botId;
}

function removeBot(roomId){
  const room = rooms.get(roomId);
  if(!room) return;
  const botId = makeBotId(roomId);
  if(room.players.has(botId)){
    const p = room.players.get(botId);
    returnRackToBag(room, p?.rack || []);
    room.players.delete(botId);
    room.ready.delete(botId);
    room.passStreak.delete(botId);
    removePlayerFromTurnOrder(room, botId);
  }
}

// ģenerē kandidāt-vārdus no bot rack (2..6), limitēti (lai neizkūp)
function genCandidateWordsFromRack(rack, limit=240){
  const letters = rack.map(t=>String(t.ch||"").toLowerCase());
  // blanks "_" atļaujam – bet vārdu ģenerācijā tās neliekam kā "_" (apstrādāsim vēlāk)
  const fixed = letters.filter(ch => ch !== "_");
  const hasBlank = letters.includes("_");

  const uniq = new Set();
  function randPick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  // random sajaukšana + prefiksu veidošana
  for(let i=0;i<limit*3 && uniq.size<limit;i++){
    // izvēlamies garumu
    const L = 2 + Math.floor(Math.random()*5); // 2..6
    const pool = fixed.slice();
    // ja nav burtu, nav ko darīt
    if(pool.length===0 && !hasBlank) break;

    let w = "";
    // random salikums bez atkārtojumiem no pieejamajiem (vienkārši)
    for(let k=0;k<L;k++){
      if(pool.length>0){
        const idx = Math.floor(Math.random()*pool.length);
        w += pool.splice(idx,1)[0];
      }else if(hasBlank){
        // blank vietā liekam random LV burtu
        w += randPick(LV_ALPHA);
      }else{
        break;
      }
    }
    if(w.length>=2) uniq.add(w);
  }
  return [...uniq];
}

// atgriež vai botam pietiek kauliņu, lai uzliktu "need" (string), ņemot vērā esošos burtus uz laukuma
function pickTilesForNeededWord(botRack, needLetters){
  // needLetters: array of {ch, x,y, mustPlace:boolean} kur mustPlace true => jāliek no rack (tukšs lauciņš)
  const rack = botRack.map(t=>({ ...t, ch:String(t.ch||"").toLowerCase() }));
  const used = new Set();
  const placements = [];

  for(const n of needLetters){
    if(!n.mustPlace) continue;

    // mēģinam tieši burtu
    let found = null;
    for(const t of rack){
      if(used.has(String(t.id))) continue;
      if(!t.blank && t.ch === n.ch){ found = t; break; }
    }
    // ja nav, mēģinam blank
    if(!found){
      for(const t of rack){
        if(used.has(String(t.id))) continue;
        if(t.blank){ found = t; break; }
      }
    }
    if(!found) return null;

    used.add(String(found.id));
    if(found.blank){
      placements.push({ x:n.x, y:n.y, tileId:String(found.id), as:n.ch });
    }else{
      placements.push({ x:n.x, y:n.y, tileId:String(found.id) });
    }
  }
  return placements;
}

function tryPlaceWordAt(room, botId, word, startX, startY, dx, dy){
  // izveido needLetters ar esošo burtu izmantošanu
  const need = [];
  for(let i=0;i<word.length;i++){
    const x = startX + dx*i;
    const y = startY + dy*i;
    if(!inBounds(x,y)) return null;

    const fixed = room.board[y][x];
    const ch = word[i];
    if(fixed){
      if(String(fixed.ch||"").toLowerCase() !== ch) return null; // konflikts
      need.push({ch, x, y, mustPlace:false});
    }else{
      need.push({ch, x, y, mustPlace:true});
    }
  }

  const bot = room.players.get(botId);
  const placements = pickTilesForNeededWord(bot.rack, need);
  if(!placements || placements.length===0) return null;

  const res = validateAndScoreMove(room, botId, placements);
  if(!res.ok) return null;
  return { placements, score: res.total, words: res.words };
}

async function botTakeTurn(roomId){
  const room = rooms.get(roomId);
  if(!room || !room.started) return;

  const botId = makeBotId(roomId);
  if(!room.players.has(botId)) return;

  if(currentTurnId(room) !== botId) return;

  const bot = room.players.get(botId);
  if(!bot) return;

  // ja nav rack — pievelkam
  if(!bot.rack || bot.rack.length<7) bot.rack = (bot.rack||[]).concat(drawTiles(room, Math.max(0,7-(bot.rack||[]).length)));

  // kandidāti
  const candidates = genCandidateWordsFromRack(bot.rack, 220);

  // filtrējam ar verifyWordStrict (stingri)
  const okWords = [];
  for(const w of candidates){
    const check = await verifyWordStrict(w);
    if(check.ok) okWords.push(w);
    if(okWords.length>=60) break;
  }

  let best = null;

  const empty = isBoardEmpty(room);

  if(empty){
    // pirmais vārds caur centru horizontāli
    for(const w of okWords){
      // lai iet caur (7,7): izvēlamies startX tā, lai kāds burts iekrīt centrā
      for(let i=0;i<w.length;i++){
        const startX = 7 - i;
        const startY = 7;
        const move = tryPlaceWordAt(room, botId, w, startX, startY, 1, 0);
        if(move && (!best || move.score > best.score)) best = { ...move, word:w };
      }
    }
  }else{
    // meklējam krustošanu ar esošajiem burtiem: pārskrienam pa laukumu un mēģinam krustot
    for(let y=0;y<15;y++){
      for(let x=0;x<15;x++){
        const fixed = room.board[y][x];
        if(!fixed) continue;
        const fixedCh = String(fixed.ch||"").toLowerCase();

        for(const w of okWords){
          for(let i=0;i<w.length;i++){
            if(w[i] !== fixedCh) continue;

            // horizontāli (krustojot)
            let startX = x - i, startY = y;
            let mv1 = tryPlaceWordAt(room, botId, w, startX, startY, 1, 0);
            if(mv1 && (!best || mv1.score > best.score)) best = { ...mv1, word:w };

            // vertikāli
            startX = x; startY = y - i;
            let mv2 = tryPlaceWordAt(room, botId, w, startX, startY, 0, 1);
            if(mv2 && (!best || mv2.score > best.score)) best = { ...mv2, word:w };
          }
        }
      }
    }
  }

  if(!best){
    // ja nevar – mēģinam samainīt, ja ir ko mainīt, citādi izlaist
    if((room.bag?.length||0) >= 7){
      returnRackToBag(room, bot.rack);
      bot.rack = drawTiles(room, 7);
      io.to(roomId).emit("effect",{type:"exchanged", by:botId, byName:bot.name});
      room.passStreak.set(botId, 0);
    }else{
      room.passStreak.set(botId, (room.passStreak.get(botId)||0)+1);
      io.to(roomId).emit("effect",{type:"passed", by:botId, byName:bot.name});
    }

    room.draft=null;
    room.turnIndex=(room.turnIndex+1)%room.turnOrder.length;
    startTurnTimer(roomId);
    emitState(roomId);
    checkAllPassedTwice(roomId);
    return;
  }

  // pielietojam labāko gājienu
  stopTurnTimer(room);

  // punktus + applyMove
  bot.score += best.score;

  // “accepted” efekts (lai redz animāciju)
  io.to(roomId).emit("effect",{type:"accepted", by:botId, byName:bot.name, total:best.score, words:best.words, hits:[]});

  // validateAndScoreMove jau pārbaudīja, tagad jāpielieto placements
  // lai nav dubulta parse, uztaisām placementsMap atkārtoti, izmantojot validateAndScoreMove vēlreiz (droši)
  const res2 = validateAndScoreMove(room, botId, best.placements);
  if(res2.ok){
    applyMove(room, botId, res2.placements, res2.placementsMap);
  }

  bot.rack = bot.rack || [];
  room.passStreak.set(botId, 0);
  room.draft=null;

  if((bot.rack?.length||0)===0){
    return endByEmptyRack(roomId, botId);
  }

  room.turnIndex=(room.turnIndex+1)%room.turnOrder.length;
  startTurnTimer(roomId);
  emitState(roomId);
}
/* ================================================================ */


io.on("connection",(socket)=>{
  onlineCount++; broadcastOnline();
  emitPublic(socket.id);
  emitRoomsList(socket.id);

  socket.on("join",({roomId,name})=>{
    roomId=(roomId||"").trim().toLowerCase();
    name=(name||"Spēlētājs").trim().slice(0,24);
    if(!roomId) return;

    if(!rooms.has(roomId)) rooms.set(roomId, makeRoom());
    const room=rooms.get(roomId);

    room.players.delete(socket.id);
    room.spectators.delete(socket.id);
    room.ready.delete(socket.id);
    room.passStreak.delete(socket.id);
    if(room.draft?.by===socket.id) room.draft=null;

    const mustSpectate = room.started || room.players.size >= MAX_PLAYERS;

    socket.join(roomId);

    if(!mustSpectate){
      const nKey=name.toLowerCase();
      for(const p of room.players.values()){
        if(p.name.toLowerCase()===nKey){
          io.to(socket.id).emit("toast","Šāds vārds jau ir istabā. Izvēlies citu.");
          emitState(roomId); emitRoomsList();
          return;
        }
      }
      room.players.set(socket.id,{name,rack:[],score:0});
      room.passStreak.set(socket.id, 0);
      emitState(roomId); emitRoomsList();
      return;
    }

    room.spectators.set(socket.id,{name});
    io.to(socket.id).emit("toast", room.started
      ? "Spēle jau sākta — pieslēdzies kā skatītājs."
      : `Istabā jau ir ${MAX_PLAYERS} spēlētāji — pieslēdzies kā skatītājs.`
    );
    emitState(roomId); emitRoomsList();
  });

  socket.on("reorderRack", ({roomId, order}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    if (!Array.isArray(order)) return;

    const curIds = p.rack.map(t => String(t.id));
    const newIds = order.map(x => String(x));
    if (curIds.length !== newIds.length) return;

    const s1 = new Set(curIds);
    const s2 = new Set(newIds);
    if (s1.size !== s2.size) return;
    for (const id of s1) if (!s2.has(id)) return;

    const byId = new Map(p.rack.map(t => [String(t.id), t]));
    p.rack = newIds.map(id => byId.get(id)).filter(Boolean);
    emitState(roomId);
  });

  
  socket.on("addBot",({roomId})=>{
    const room=rooms.get(roomId);
    if(!room || room.started) return;
    if(!room.players.has(socket.id)) return;

    // tikai, ja šobrīd ir 1 spēlētājs (tu) un nav bot
    const botId = ensureBot(roomId);
    if(!botId) return;

    io.to(roomId).emit("toast","Pievienots datoru spēlētājs: Dators");
    emitState(roomId);
    emitRoomsList();
  });

socket.on("setTurnTime",({roomId,sec})=>{
    const room=rooms.get(roomId); if(!room||room.started) return;
    if(!room.players.has(socket.id)) return;
    let n=Number(sec);
    if(!Number.isFinite(n)||n<0) n=0;
    n=Math.floor(Math.min(3600,n));
    room.turnTimeSec=n;
    emitState(roomId); emitRoomsList();
  });

  socket.on("readyStart",({roomId})=>{
    const room=rooms.get(roomId);
    if(!room||room.started||!room.players.has(socket.id)) return;

    room.ready.add(socket.id);
    // BOT vienmēr gatavs
    if(room.players.has(makeBotId(roomId))) room.ready.add(makeBotId(roomId));
    emitState(roomId);

    if(room.players.size>=2 && room.ready.size===room.players.size){
      room.started=true;
      room.gameStartAt=Date.now();
      room.lastGameOver=null;
      room.draft=null;
      room.last3 = [];

      const {order, drawPublic} = computeTurnOrderByLetter(room);
      room.turnOrder=order;
      room.turnIndex=0;

      room.passStreak.clear();
      for(const id of room.players.keys()) room.passStreak.set(id, 0);

      for(const [,p] of room.players.entries()) p.rack = drawTiles(room,7);

      io.to(roomId).emit("effect",{type:"letterDraw", draws:drawPublic, order:order.map(id=>({id,name:room.players.get(id)?.name||"?"}))});
      room.ready.clear();
      startTurnTimer(roomId);
      emitState(roomId); emitRoomsList();
    }
  });

  socket.on("draftUpdate",({roomId,placements})=>{
    const room=rooms.get(roomId);
    if(!room||!room.started) return;
    if(!room.players.has(socket.id)) return;
    if(currentTurnId(room)!==socket.id) return;
    setDraft(room,socket.id,placements||[]);
    emitState(roomId);
  });

  socket.on("draftClear",({roomId})=>{
    const room=rooms.get(roomId);
    if(!room) return;
    if(room.draft?.by===socket.id){ room.draft=null; emitState(roomId); }
  });

  socket.on("chatSend",({roomId,msg})=>{
    const room=rooms.get(roomId); if(!room) return;
    if(!isParticipant(room, socket.id)) return;
    msg=String(msg||"").trim(); if(!msg) return;
    if(msg.length>300) msg=msg.slice(0,300);
    room.chat.push({name:getDisplayName(room, socket.id), msg, ts:Date.now()});
    if(room.chat.length>50) room.chat=room.chat.slice(-50);
    emitState(roomId);
  });

  socket.on("passTurn",({roomId})=>{
    const room=rooms.get(roomId);
    if(!room||!room.started) return;
    if(!room.players.has(socket.id)) return;
    if(currentTurnId(room)!==socket.id) return;

    room.passStreak.set(socket.id, (room.passStreak.get(socket.id)||0) + 1);

    const byName=room.players.get(socket.id)?.name||"?";
    io.to(roomId).emit("effect",{type:"passed", by:socket.id, byName});
    room.draft=null;
    room.turnIndex=(room.turnIndex+1)%room.turnOrder.length;
    startTurnTimer(roomId);
    emitState(roomId);

    checkAllPassedTwice(roomId);
  });

  socket.on("exchangeAll",({roomId})=>{
    const room=rooms.get(roomId);
    if(!room||!room.started) return;
    const pid=socket.id;
    if(!room.players.has(pid)) return;
    if(currentTurnId(room)!==pid) return;

    const p=room.players.get(pid);
    if(!p) return;

    room.passStreak.set(pid, 0);

    returnRackToBag(room, p.rack);
    p.rack = drawTiles(room, 7);

    room.draft=null;
    io.to(roomId).emit("effect",{type:"exchanged", by:pid, byName:p.name});

    room.turnIndex=(room.turnIndex+1)%room.turnOrder.length;
    startTurnTimer(roomId);
    emitState(roomId);
  });

  socket.on("swapBlank",({roomId,x,y,rackTileId})=>{
    const room=rooms.get(roomId);
    if(!room||!room.started) return;
    const pid=socket.id;
    if(!room.players.has(pid)) return;
    if(currentTurnId(room)!==pid) return;

    x=Number(x); y=Number(y);
    if(!inBounds(x,y)) return;
    const cell = room.board?.[y]?.[x];
    if(!cell || !cell.blank) return;
    const needed = String(cell.ch||"").toLowerCase();
    if(!needed || needed.length!==1) return;

    const p=room.players.get(pid);
    const t = (p.rack||[]).find(z => String(z.id)===String(rackTileId));
    if(!t || t.blank) return;
    if(String(t.ch||"").toLowerCase() !== needed) return;

    room.board[y][x] = { ch: needed, pts: t.pts, blank: false };
    p.rack = p.rack.filter(z => String(z.id)!==String(rackTileId));
    p.rack.push({ id:String(room.nextTileId++), ch:"_", pts:0, blank:true });

    io.to(roomId).emit("effect",{type:"blankSwapped", by:pid, byName:p.name, x, y, ch:needed});
    emitState(roomId);
  });

  socket.on("leaveGame",({roomId})=>{
    const room=rooms.get(roomId);
    if(!room) return;
    const pid=socket.id;
    if(!room.players.has(pid)) return;

    const p=room.players.get(pid);
    returnRackToBag(room, p.rack);
    if(room.draft?.by===pid) room.draft=null;

    room.players.delete(pid);
    room.ready.delete(pid);
    room.passStreak.delete(pid);

    if(room.started){
      removePlayerFromTurnOrder(room, pid);
      if(room.turnOrder.length===0) stopTurnTimer(room);
      else startTurnTimer(roomId);
    }

    room.spectators.set(pid, {name:p.name});
    io.to(roomId).emit("effect",{type:"leftGame", by:pid, byName:p.name});
    emitState(roomId);
    emitRoomsList();

    if(room.started && room.players.size < 2){
      finalizeGame(roomId, "Spēlē palika mazāk par 2 spēlētājiem");
    }
  });

  // ✅ Tagad gājiens tiek PIEŅEMTS uzreiz (vairs nav apstiprināšanas)
  socket.on("commitMove", async ({roomId,placements})=>{
    const room=rooms.get(roomId);
    if(!room) return;
    if(!room.players.has(socket.id)) return io.to(socket.id).emit("toast","Tu esi skatītājs — nevar veikt gājienus.");
    if(!room.started) return io.to(socket.id).emit("toast","Lai sāktu spēli, visiem jānospiež “Gatavs ✅” (lobijā).");
    if(currentTurnId(room)!==socket.id) return io.to(socket.id).emit("toast","Tagad nav tavs gājiens.");

    const res=validateAndScoreMove(room,socket.id,placements);
    if(!res.ok){
      io.to(socket.id).emit("toast",res.err);
      emitState(roomId);
      return;
    }

    // ✅ Stingri pārbaudām visus izveidotos vārdus (bez BONUS)
    const madeStrict = [...new Set((res.words||[])
      .map(w=>String(w.word||"").toLowerCase())
      .filter(w=>w && w!=="bonus")
    )];

    for(const w of madeStrict){
      const check = await verifyWordStrict(w);
      if(!check.ok){
        io.to(socket.id).emit("toast", `Nederīgs vārds: ${w.toUpperCase()} — ${check.reason}`);
        emitState(roomId);
        return;
      }
    }


    const player=room.players.get(socket.id);
    stopTurnTimer(room);

    // punktu efekti (kam trāpīja)
    const cells = res.placements.map(p=>{
      const x=Number(p.x), y=Number(p.y);
      const t=res.placementsMap.get(`${x},${y}`);
      const m=room.mult.label?.[y]?.[x]||"";
      return {x,y,ch:t.ch,pts:t.pts,blank:t.blank,m};
    });
    const hits=[...new Set(cells.map(c=>c.m).filter(Boolean))];

    // pielieto gājienu
    player.score += res.total;
    applyMove(room, socket.id, res.placements, res.placementsMap);
    room.passStreak.set(socket.id, 0);
    room.draft=null;

    // last3 (neblokē, pat ja nav atpazīts)
    const made = [...new Set((res.words||[]).map(w=>String(w.word||"").toLowerCase()).filter(w=>w && w!=="bonus"))];
    for(const w of made){
      const strict = await verifyWordStrict(w);
      const info = await infoFromTezaurs(w);
      const m = (strict.morph || info.morph || {});
      room.last3.unshift({
        word: w,
        tezaursId: (strict.tezaursId || info.tezaursId || (w+":1")),
        lemma: (strict.lemma || info.lemma || w),
        meaning: info.meaning || "",
        morph: m,
        summary: info.summary || "",
        byName: player.name,
        ts: Date.now()
      });
    }
    room.last3 = room.last3.slice(0,3);

    io.to(roomId).emit("effect",{type:"accepted", by:socket.id, byName:player.name, total:res.total, words:res.words, hits});

    if((player.rack?.length||0)===0) return endByEmptyRack(roomId, socket.id);

    room.turnIndex=(room.turnIndex+1)%room.turnOrder.length;
    startTurnTimer(roomId);
    emitState(roomId);
  });

  socket.on("disconnect",()=>{
    onlineCount = Math.max(0, onlineCount-1);
    broadcastOnline();

    for(const [roomId,room] of rooms){
      let changed=false;

      if(room.players.has(socket.id)){
        if(room.draft?.by===socket.id) room.draft=null;

        room.players.delete(socket.id);
        room.ready.delete(socket.id);
        room.passStreak.delete(socket.id);
        changed=true;

        if(room.started){
          removePlayerFromTurnOrder(room, socket.id);
          if(room.turnOrder.length===0) stopTurnTimer(room);
          else startTurnTimer(roomId);
        }
      }

      if(room.spectators.has(socket.id)){
        room.spectators.delete(socket.id);
        changed=true;
      }

      if(room.players.size===0 && room.spectators.size===0){
        rooms.delete(roomId);
        continue;
      }

      if(changed) emitState(roomId);
    }
    emitRoomsList();
  });
});

server.listen(3000,()=>console.log("http://localhost:3000"));
