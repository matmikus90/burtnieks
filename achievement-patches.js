function replaceOnce(source, marker, replacement, errorMessage) {
  if (!source.includes(marker)) throw new Error(errorMessage);
  return source.replace(marker, replacement);
}

function patchAchievementServer(source) {
  if (source.includes('name:"🧙 Sasniegums"') && source.includes('unlockMoveAchievements')) return source;

  const validatorMarker = 'const { verifyWordStrict } = createWordValidator({ httpGet });';
  const helper = `${validatorMarker}\nconst { unlockMoveAchievements } = require("./achievements");\nfunction appendMoveAchievementsToChat(room,playerId,playerName,payload){\n  const items=unlockMoveAchievements({room,playerId,playerName,...payload});\n  if(!items.length) return;\n  const msg=items.length===1\n    ? String(playerName)+': “'+items[0].title+'” — '+items[0].description\n    : String(playerName)+': '+items.length+' sasniegumi — '+items.map(item=>'“'+item.title+'”').join(', ')+'.';\n  if(!Array.isArray(room.chat)) room.chat=[];\n  room.chat.push({name:"🧙 Sasniegums",msg,ts:Date.now(),system:true,achievement:true});\n  if(room.chat.length>50) room.chat=room.chat.slice(-50);\n}`;
  source = replaceOnce(source, validatorMarker, helper, 'Neizdevās pieslēgt sasniegumu moduli vārdu pārbaudei.');

  const roomMarker = '    rematchVotes: new Set(),';
  source = replaceOnce(
    source,
    roomMarker,
    `${roomMarker}\n    achievementUnlocked: new Map(),`,
    'Neizdevās pievienot istabas sasniegumu stāvokli.'
  );

  const humanMarker = '    room.lastMove = { by:socket.id, byName:player.name, total:res.total, words:res.words, hits, at:Date.now() };\n    io.to(roomId).emit("effect",{type:"accepted", by:socket.id, byName:player.name, total:res.total, words:res.words, hits});';
  const humanReplacement = `${humanMarker}\n    appendMoveAchievementsToChat(room,socket.id,player.name,{total:res.total,words:res.words,placements:res.placements,placementsMap:res.placementsMap});`;
  source = replaceOnce(source, humanMarker, humanReplacement, 'Neizdevās pieslēgt sasniegumus cilvēka gājienam.');

  const botMarker = '    current.lastMove={by:botId,byName:bot.name,total:result.total,words:result.words,at:Date.now()};\n    for(const item of result.words.filter(item=>item.word!=="BONUS")){';
  const botReplacement = '    const botHits=[...new Set(result.placements.map(p=>current.mult.label?.[Number(p.y)]?.[Number(p.x)]||"").filter(Boolean))];\n    current.lastMove={by:botId,byName:bot.name,total:result.total,words:result.words,hits:botHits,at:Date.now()};\n    for(const item of result.words.filter(item=>item.word!=="BONUS")){';
  source = replaceOnce(source, botMarker, botReplacement, 'Neizdevās sagatavot datora sasniegumu bonusus.');

  const botAcceptedMarker = '    io.to(roomId).emit("effect",{type:"accepted",by:botId,byName:bot.name,total:result.total,words:result.words,hits:[]});';
  const botAcceptedReplacement = '    io.to(roomId).emit("effect",{type:"accepted",by:botId,byName:bot.name,total:result.total,words:result.words,hits:botHits});\n    appendMoveAchievementsToChat(current,botId,bot.name,{total:result.total,words:result.words,placements:result.placements,placementsMap:result.placementsMap});';
  source = replaceOnce(source, botAcceptedMarker, botAcceptedReplacement, 'Neizdevās pieslēgt sasniegumus datora gājienam.');

  return source;
}

function patchAchievementInterface(source) {
  source = source
    .replaceAll('<link rel="stylesheet" href="/achievements.css">\n', '')
    .replaceAll('<script src="/achievements-ui.js"></script>\n', '');

  if (!source.includes('achievement-chat')) {
    const chatMarker = '<div class="chat-msg"><b>${esc(m.name)}</b> ${esc(m.msg)}</div>';
    const chatReplacement = '<div class="chat-msg ${m.achievement?\'achievement-chat\':\'\'}"><b>${esc(m.name)}</b> ${esc(m.msg)}</div>';
    source = replaceOnce(source, chatMarker, chatReplacement, 'Neizdevās pievienot sasniegumu noformējumu čatam.');
  }
  return source;
}

module.exports = { patchAchievementServer, patchAchievementInterface, replaceOnce };
