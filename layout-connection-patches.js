function replaceOnce(source, marker, replacement, errorMessage) {
  if (!source.includes(marker)) throw new Error(errorMessage);
  return source.replace(marker, replacement);
}

function patchLayoutConnectionServer(source) {
  if (source.includes('app.get("/healthz"')) return source;
  const marker = 'app.use(express.static("public"));';
  const replacement = `app.get("/healthz",(req,res)=>{\n  res.setHeader("Cache-Control","no-store");\n  res.json({ok:true,uptimeSec:Math.round(process.uptime()),socketPath:"/socket.io/"});\n});\n\n${marker}`;
  return replaceOnce(source, marker, replacement, 'Neizdevās pievienot servera veselības pārbaudi.');
}

function patchLayoutConnectionInterface(source) {
  const socketMarker = "const socket=io({reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:500,reconnectionDelayMax:4000});";
  if (source.includes(socketMarker)) {
    source = source.replace(socketMarker, `const socket=io({\n    path:'/socket.io',\n    transports:['websocket','polling'],\n    tryAllTransports:true,\n    upgrade:true,\n    rememberUpgrade:true,\n    timeout:15000,\n    reconnection:true,\n    reconnectionAttempts:Infinity,\n    reconnectionDelay:500,\n    reconnectionDelayMax:4000\n  });`);
  } else if (!source.includes("transports:['websocket','polling']")) {
    throw new Error('Neizdevās atrast Socket.IO klienta inicializāciju.');
  }

  if (!source.includes('Pārbaudi Burtnieks servisu vai Nginx')) {
    const start = source.indexOf("  socket.on('connect_error'");
    const end = source.indexOf("\n  socket.on('online'", start);
    if (start === -1 || end === -1) throw new Error('Neizdevās atrast savienojuma kļūdas apstrādi.');
    const replacement = `  socket.on('connect_error',err=>{\n    $('connection').textContent='Nav savienojuma';\n    const raw=String(err?.message||'Savienojuma kļūda');\n    const transportError=/xhr poll error|websocket error|transport error/i.test(raw);\n    toast(transportError\n      ? 'Serveris nav sasniedzams. Pārbaudi Burtnieks servisu vai Nginx /socket.io/ pāradresāciju.'\n      : \`Nav savienojuma ar serveri: \${raw}\`);\n  });`;
    source = source.slice(0, start) + replacement + source.slice(end);
  }

  if (!source.includes('/layout-connection.css')) {
    source = source.replace('</head>', '<link rel="stylesheet" href="/layout-connection.css">\n</head>');
  }
  if (!source.includes('/layout-connection.js')) {
    source = source.replace('</body>', '<script src="/layout-connection.js"></script>\n</body>');
  }
  return source;
}

module.exports = { patchLayoutConnectionServer, patchLayoutConnectionInterface, replaceOnce };
