const fs = require("fs");

const file = "server.js";
let s = fs.readFileSync(file, "utf8");

if (s.includes("async function verifyWordStrict(")) {
  console.log("Patch jau ir uzlikts (verifyWordStrict atrasts).");
  process.exit(0);
}

/* 1) Ieliek stingro pārbaudi pirms const inflCache */
const anchor1 = "\nconst inflCache";
if (!s.includes(anchor1)) {
  console.error("Neatradu enkuru 'const inflCache'. Patch nevar pielikt automātiski.");
  process.exit(1);
}

const strictBlock = `

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
`;

s = s.replace(anchor1, strictBlock + anchor1);

/* 2) CommitMove: ieliek stingro vārdu validāciju pirms player.score/aplikācijas */
const anchor2 = "\n    const player=room.players.get(socket.id);\n";
if (!s.includes(anchor2)) {
  console.error("Neatradu enkuru 'const player=room.players.get(socket.id);' commitMove blokā.");
  process.exit(1);
}

const validateSnippet = `
    // ✅ Stingri pārbaudām visus izveidotos vārdus (bez BONUS)
    const madeStrict = [...new Set((res.words||[])
      .map(w=>String(w.word||"").toLowerCase())
      .filter(w=>w && w!=="bonus")
    )];

    for(const w of madeStrict){
      const check = await verifyWordStrict(w);
      if(!check.ok){
        io.to(socket.id).emit("toast", \`Nederīgs vārds: \${w.toUpperCase()} — \${check.reason}\`);
        emitState(roomId);
        return;
      }
    }

`;

if (!s.includes("const madeStrict =")) {
  s = s.replace(anchor2, validateSnippet + anchor2);
}

/* 3) last3: izmanto “stingro” analīzi (lai, piem., “lāde” ņem parasto, nevis vietvārdu) */
s = s.replace(
  /const info = await infoFromTezaurs\(w\);\n\s*const m = info\.morph \|\| \{\};/g,
  `const strict = await verifyWordStrict(w);\n      const info = await infoFromTezaurs(w);\n      const m = (strict.morph || info.morph || {});`
);

s = s.replace(
  /tezaursId: info\.tezaursId \|\| \(w\+":1"\),\n\s*lemma: info\.lemma \|\| w,/g,
  `tezaursId: (strict.tezaursId || info.tezaursId || (w+":1")),\n        lemma: (strict.lemma || info.lemma || w),`
);

fs.writeFileSync(file, s, "utf8");
console.log("OK: Patch uzlikts server.js");
