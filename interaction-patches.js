function replaceOnce(source, marker, replacement, errorMessage) {
  if (!source.includes(marker)) throw new Error(errorMessage);
  return source.replace(marker, replacement);
}

function patchTouchTileInterface(source) {
  if (!source.includes('tapSelectedTileId=null')) {
    const patchedState = 'window.__burtnieksSocket=socket; let state=null, temp=new Map(), rackOrder=[], chatMin=true, toastTimer=null;';
    const originalState = 'let state=null, temp=new Map(), rackOrder=[], chatMin=true, toastTimer=null;';
    if (source.includes(patchedState)) {
      source = source.replace(patchedState, 'window.__burtnieksSocket=socket; let state=null, temp=new Map(), rackOrder=[], chatMin=true, toastTimer=null, tapSelectedTileId=null;');
    } else if (source.includes(originalState)) {
      source = source.replace(originalState, 'let state=null, temp=new Map(), rackOrder=[], chatMin=true, toastTimer=null, tapSelectedTileId=null;');
    } else {
      throw new Error('Neizdevās pievienot izvēlētā kauliņa stāvokli.');
    }
  }

  const tileStart = source.indexOf('function tileEl(');
  const tileEnd = source.indexOf('function renderBoard(){', tileStart);
  if (tileStart === -1 || tileEnd === -1) throw new Error('Neizdevās atrast kauliņa renderēšanu pieskārienu vadībai.');

  const tileReplacement = `function refreshTapPlacement(){
    renderBoard();
    renderRack();
  }
  function toggleTapTile(id){
    if(!canMove()){
      toast('Kauliņu var nolikt tikai savā gājienā.');
      return;
    }
    const normalized=String(id);
    tapSelectedTileId=tapSelectedTileId===normalized?null:normalized;
    refreshTapPlacement();
  }
  function tileEl(t,source,id,xy){
    const el=document.createElement('div');
    const selected=source==='rack'&&tapSelectedTileId===String(id);
    el.className=\`tile\${t.blank?' blank':''}\${source==='ghost'?' ghost':''}\${selected?' tap-selected':''}\`;
    el.innerHTML=\`\${esc((t.ch||'_').toUpperCase())}<span class="pts">\${t.pts??0}</span>\`;
    el.draggable=source==='rack'||source==='temp';
    el.dataset.source=source;
    if(id!=null)el.dataset.id=id;
    if(xy){el.dataset.x=xy.x;el.dataset.y=xy.y}
    if(source==='rack'||source==='temp'){
      el.tabIndex=0;
      el.setAttribute('role','button');
      el.setAttribute('aria-label',source==='rack'?'Izvēlēties kauliņu':'Paņemt kauliņu no laukuma');
      if(source==='rack')el.setAttribute('aria-pressed',String(selected));
      const activate=ev=>{
        ev.preventDefault();
        ev.stopPropagation();
        if(source==='rack'){
          toggleTapTile(id);
          return;
        }
        if(source==='temp'&&xy&&canMove()){
          temp.delete(key(xy.x,xy.y));
          tapSelectedTileId=String(id);
          refreshTapPlacement();
          emitDraft();
        }
      };
      el.addEventListener('click',activate);
      el.addEventListener('keydown',ev=>{
        if(ev.key==='Enter'||ev.key===' '){activate(ev)}
      });
    }
    el.addEventListener('dragstart',ev=>{
      tapSelectedTileId=null;
      el.classList.remove('tap-selected');
      ev.dataTransfer.setData('text/plain',JSON.stringify({source,id,x:xy?.x,y:xy?.y}));
    });
    return el;
  }
  `;
  source = source.slice(0, tileStart) + tileReplacement + source.slice(tileEnd);

  const boardStart = source.indexOf('function renderBoard(){');
  const boardEnd = source.indexOf('function renderRack(){', boardStart);
  if (boardStart === -1 || boardEnd === -1) throw new Error('Neizdevās atrast laukuma renderēšanu pieskārienu vadībai.');

  const boardReplacement = `function renderBoard(){
    const board=$('board');
    board.innerHTML='';
    const draft=new Map((state.draft?.cells||[]).map(c=>[key(c.x,c.y),c]));
    for(let y=0;y<15;y++)for(let x=0;x<15;x++){
      const c=document.createElement('div');
      const m=state.multLabel?.[y]?.[x]||'';
      const fixed=state.board?.[y]?.[x];
      const tmp=temp.get(key(x,y));
      const dr=draft.get(key(x,y));
      c.className='cell';
      c.dataset.m=m;
      c.ondragover=e=>e.preventDefault();
      c.ondrop=e=>{
        e.preventDefault();
        if(!canMove()||fixed||temp.has(key(x,y)))return;
        let d=null;
        try{d=JSON.parse(e.dataTransfer.getData('text/plain'))}catch{return}
        if(d.source==='temp')temp.delete(key(d.x,d.y));
        tapSelectedTileId=null;
        temp.set(key(x,y),{tileId:String(d.id)});
        render();
        emitDraft();
      };
      if(!fixed&&!tmp&&!dr&&tapSelectedTileId&&canMove()){
        c.classList.add('tap-target');
        c.setAttribute('role','button');
        c.tabIndex=0;
        c.setAttribute('aria-label','Nolikt izvēlēto kauliņu šajā lauciņā');
        const placeSelected=ev=>{
          ev.preventDefault();
          if(!tapSelectedTileId||!canMove())return;
          const tile=(state.myRack||[]).find(item=>String(item.id)===String(tapSelectedTileId));
          if(!tile){tapSelectedTileId=null;refreshTapPlacement();return}
          temp.set(key(x,y),{tileId:String(tile.id)});
          tapSelectedTileId=null;
          render();
          emitDraft();
        };
        c.addEventListener('click',placeSelected);
        c.addEventListener('keydown',ev=>{
          if(ev.key==='Enter'||ev.key===' '){placeSelected(ev)}
        });
      }
      if(fixed)c.appendChild(tileEl(fixed,'fixed'));
      else if(tmp){
        const t=(state.myRack||[]).find(z=>String(z.id)===String(tmp.tileId));
        if(t)c.appendChild(tileEl({...t,ch:t.blank?(tmp.as||'_'):t.ch},'temp',t.id,{x,y}));
      }else if(dr&&state.draft?.by!==state.meId)c.appendChild(tileEl(dr,'ghost'));
      else if(m)c.innerHTML=\`<span class="mult">\${m}</span>\`;
      board.appendChild(c);
    }
  }
  `;
  source = source.slice(0, boardStart) + boardReplacement + source.slice(boardEnd);

  source = source.replace(
    "socket.on('returnedLobby',({name})=>{state=null;temp.clear();",
    "socket.on('returnedLobby',({name})=>{state=null;temp.clear();tapSelectedTileId=null;"
  );
  source = source.replace(
    "socket.on('state',s=>{state=s;window.__burtnieksState=s;",
    "socket.on('state',s=>{state=s;if(tapSelectedTileId&&!s.myRack?.some(tile=>String(tile.id)===String(tapSelectedTileId)))tapSelectedTileId=null;window.__burtnieksState=s;"
  );
  source = source.replace(
    "$('clear').onclick=()=>{temp.clear();render();emitDraft()}",
    "$('clear').onclick=()=>{tapSelectedTileId=null;temp.clear();render();emitDraft()}"
  );

  return source;
}

function patchTouchChatInterface(source) {
  source = patchTouchTileInterface(source);
  if (!source.includes('/touch-chat.css')) {
    source = source.replace('</head>', '<link rel="stylesheet" href="/touch-chat.css">\n</head>');
  }
  if (!source.includes('/touch-chat.js')) {
    source = source.replace('</body>', '<script src="/touch-chat.js"></script>\n</body>');
  }
  return source;
}

module.exports = { patchTouchTileInterface, patchTouchChatInterface, replaceOnce };
