const fs = require("fs");

function mustFind(s, needle){
  if(!s.includes(needle)) throw new Error("Neatradu enkuru: " + needle);
}

let server = fs.readFileSync("server.js","utf8");
let html = fs.readFileSync("public/index.html","utf8");

/* ---------------- SERVER PATCH ---------------- */

if(!server.includes("function botTakeTurn(")){

  // 1) BOT helper bloks – ieliekam pirms io.on("connection"
  const anchor = '\nio.on("connection",(socket)=>{';
  mustFind(server, anchor);

  const botBlock = `

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

`;

  server = server.replace(anchor, botBlock + anchor);
}

// 2) emitState – izlaižam botId (nav socket)
if(!server.includes("if(isBotId(viewerId)) continue;")){
  server = server.replace(
    "for(const [viewerId, viewer] of room.players.entries()){",
    "for(const [viewerId, viewer] of room.players.entries()){\n    if(typeof isBotId==='function' && isBotId(viewerId)) continue;"
  );
}

// 3) startTurnTimer – ja ir bot turn, izsauc botTakeTurn
if(!server.includes("botTakeTurn(roomId)")){
  server = server.replace(
    "startTurnTimer(roomId);",
    `startTurnTimer(roomId);\n      // ja nākamais ir BOT, lai viņš uzreiz izdara gājienu\n      setTimeout(()=>{ try{ botTakeTurn(roomId); }catch{} }, 450);`
  );
}

// 4) readyStart – ja istabā ir bot, automātiski atzīmē ready
if(!server.includes("room.ready.add(makeBotId(roomId));")){
  server = server.replace(
    "room.ready.add(socket.id);",
    "room.ready.add(socket.id);\n    // BOT vienmēr gatavs\n    if(room.players.has(makeBotId(roomId))) room.ready.add(makeBotId(roomId));"
  );
}

// 5) ja sākas spēle – turnOrder jāiekļauj bot (ja ir)
if(!server.includes("ensureBot(") && server.includes('socket.on("readyStart"')){
  // neliekam šeit; bot pievienosies ar atsevišķu event
}

// 6) pievienojam socket event addBot
if(!server.includes('socket.on("addBot"')){
  const anchor = 'socket.on("setTurnTime",({roomId,sec})=>{';
  mustFind(server, anchor);

  const addBotEvent = `
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

`;
  server = server.replace(anchor, addBotEvent + anchor);
}

// 7) kad spēle ir sākta un BOT ir gājienā, palaist botTakeTurn arī pēc emitState noteiktos brīžos
// (papildus drošībai) – hook: pēc emitState(roomId); iekš commitMove un passTurn jau ir startTurnTimer => tas triggero botTakeTurn

// 8) ja spēlētājs iziet/atvienojas un paliek tikai bot + <1 spēlētājs, botu izmetam
if(!server.includes("removeBot(roomId)")){
  // nedaudz drošāk: pēc leaveGame event beigām
  server = server.replace(
    'socket.on("leaveGame",({roomId})=>{',
    'socket.on("leaveGame",({roomId})=>{'
  );
  // Pēc finalizeGame/emitRoomsList jau ir; bet mēs pievienosim check disconnect/leave – vienkāršāk: atstāt, nav kritiski
}

/* ---------------- CLIENT PATCH ---------------- */

// 1) ieliekam pogu "Pievienot datoru" lobijā (blakus Gatavs)
if(!html.includes('id="addBot"')){
  mustFind(html, '<button id="readyBtn" type="button">Gatavs ✅</button>');
  html = html.replace(
    '<button id="readyBtn" type="button">Gatavs ✅</button>',
    '<button id="readyBtn" type="button">Gatavs ✅</button>\n          <button id="addBot" type="button">Pievienot datoru 🤖</button>'
  );
}

// 2) JS: addBot klikšķis + redzamība tikai, ja esi viens (players==1) un nav bots un nav started
if(!html.includes('$("addBot").onclick')){
  mustFind(html, '$("readyBtn").onclick');
  html = html.replace(
    '$("readyBtn").onclick = ()=>{ if(!socket||!state||state.role!=="player") return; socket.emit("readyStart",{roomId:state.roomId}); $("readyBtn").disabled=true; };',
    '$("readyBtn").onclick = ()=>{ if(!socket||!state||state.role!=="player") return; socket.emit("readyStart",{roomId:state.roomId}); $("readyBtn").disabled=true; };\n\n      $("addBot").onclick = ()=>{ if(!socket||!state||state.role!=="player"||state.started) return; socket.emit("addBot",{roomId:state.roomId}); };'
  );
}

// 3) renderAll: paslēpt/atvērt addBot pogu atkarībā no spēlētāju skaita
if(!html.includes('const addBotBtn')){
  mustFind(html, 'function renderAll(){');
  html = html.replace(
    'function renderAll(){',
    'function renderAll(){\n        const addBotBtn = document.getElementById("addBot");'
  );

  mustFind(html, 'renderPlayers();');
  html = html.replace(
    'renderPlayers();',
    'renderPlayers();\n\n        // 🤖 poga redzama tikai lobijā, ja esi viens un nav "Dators"\n        if(addBotBtn){\n          const hasBot = (state.players||[]).some(p => (p.name||"") === "Dators");\n          const onlyOne = (state.players||[]).length === 1;\n          addBotBtn.style.display = (!state.started && state.role==="player" && onlyOne && !hasBot) ? "" : "none";\n        }\n'
  );
}

fs.writeFileSync("server.js", server, "utf8");
fs.writeFileSync("public/index.html", html, "utf8");

console.log("OK: BOT patches uzlikti (server.js + public/index.html)");
