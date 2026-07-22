function patchServer(source) {
  if (source.includes("require('./word-validator')") || source.includes('require("./word-validator")')) return source;
  const startMarker = '// ✅ Stingra pārbaude: atļauj tikai parastus vārdus (ne īpašvārdus, ne saīsinājumus)';
  const endMarker = 'const inflCache = new Map();';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error('Neizdevās atrast veco vārdu pārbaudes bloku.');
  const replacement = `// Stingra vārdu pārbaude ir nodalīta testējamā modulī.\nconst { createWordValidator } = require("./word-validator");\nconst { verifyWordStrict } = createWordValidator({ httpGet });\napp.get("/api/check-word", async (req,res)=>{\n  const out = await verifyWordStrict(String(req.query.word || req.query.q || ""));\n  res.status(out.serviceUnavailable ? 503 : 200);\n  res.setHeader("Cache-Control", "no-store");\n  res.setHeader("Content-Type", "application/json; charset=utf-8");\n  res.end(JSON.stringify({ ok:!!out.ok, word:out.word, reason:out.reason||"", heading:out.heading||"", lemma:out.lemma||"", tezaursId:out.tezaursId||"" }));\n});\n\n`;
  return source.slice(0, start) + replacement + source.slice(end);
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
