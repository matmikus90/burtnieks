const STRICT_CACHE_MS = 1000 * 60 * 60 * 24 * 7;
const LATVIAN_WORD_RE = /^[aābcčdeēfgģhiījkķlļmnņoprsštuūvzž]+$/u;

function normalizeWord(value) {
  return String(value || '').normalize('NFC').toLowerCase().trim();
}

function collectText(value, out = []) {
  if (value == null) return out;
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectText(item, out);
  }
  return out;
}

function classifyDictionaryEntry(entry) {
  const heading = String(entry?.heading || '').trim();
  const blob = collectText(entry).join(' | ').toLowerCase();

  const isAbbrev = /saīsināj|abreviatūr|akronīm|iniciāļ|burtsalik|saīs\./u.test(blob)
    || /^[A-ZĀČĒĢĪĶĻŅŠŪŽ]{2,}$/u.test(heading);

  const startsUppercase = /^[A-ZĀČĒĢĪĶĻŅŠŪŽ]/u.test(heading);
  const hasProperMarker = /īpašvār|vietvār|toponīm|hidronīm|personvār|priekšvār|uzvār|apdzīvota vieta|ģeogrāfisks nosaukums|organizācijas nosaukums/u.test(blob);

  return { isAbbrev, isProper: startsUppercase || hasProperMarker };
}

function createWordValidator({ httpGet, apiBase = 'https://api.tezaurs.lv' }) {
  if (typeof httpGet !== 'function') throw new TypeError('createWordValidator nepieciešama httpGet funkcija');
  const cache = new Map();

  async function getJson(pathname, timeoutMs = 4500) {
    const res = await httpGet(apiBase + pathname, timeoutMs);
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(res.body);
  }

  async function verifyWordStrict(word) {
    const w = normalizeWord(word);
    if (w === 'bonus') return { ok: true, word: w, ts: Date.now() };
    if (w.length < 2) return { ok: false, word: w, reason: 'Vārdam jābūt vismaz 2 burtiem', ts: Date.now() };
    if (!LATVIAN_WORD_RE.test(w)) return { ok: false, word: w, reason: 'Atļauti tikai latviešu alfabēta burti', ts: Date.now() };

    const cached = cache.get(w);
    if (cached && Date.now() - cached.ts < STRICT_CACHE_MS) return cached;

    let searchData;
    try {
      searchData = await getJson(`/api/v2/searchinfl?q=${encodeURIComponent(w)}&limit=8`);
    } catch {
      const out = { ok: false, word: w, reason: 'Tēzaurs pašlaik nav sasniedzams', serviceUnavailable: true, ts: Date.now() };
      cache.set(w, out);
      return out;
    }

    const results = Array.isArray(searchData?.results) ? searchData.results.slice(0, 8) : [];
    if (!results.length) {
      const out = { ok: false, word: w, reason: 'Vārds nav atrasts Tēzaurā', ts: Date.now() };
      cache.set(w, out);
      return out;
    }

    const candidates = await Promise.all(results.map(async (hit) => {
      const id = Number(hit?.id);
      let entry = { ...hit };
      if (Number.isFinite(id) && id > 0) {
        try { entry = await getJson(`/api/v2/entries/${encodeURIComponent(String(id))}`); }
        catch { entry = { ...hit }; }
      }
      const flags = classifyDictionaryEntry(entry);
      const heading = String(entry?.heading || hit?.heading || w).trim();
      const primary = entry?.lexemes?.find?.((lexeme) => lexeme?.isPrimary) || entry?.lexemes?.[0];
      const lemma = String(primary?.lemma || heading || w).trim().toLowerCase();
      const homonymNo = Number(entry?.homonym_no || 1);
      return {
        heading,
        lemma,
        tezaursId: heading ? `${heading}:${Number.isFinite(homonymNo) ? homonymNo : 1}` : `${w}:1`,
        ...flags,
      };
    }));

    const allowed = candidates.find((candidate) => !candidate.isAbbrev && !candidate.isProper);
    if (allowed) {
      const out = {
        ok: true,
        word: w,
        heading: allowed.heading,
        tezaursId: allowed.tezaursId,
        lemma: allowed.lemma,
        morph: {
          word: w,
          tezaursId: allowed.tezaursId,
          lemma: allowed.lemma,
          'Vārdšķira': '', 'Skaitlis': '', 'Locījums': '', 'Dzimte': '',
          'Deklinācija': '', 'Lietojums': '', 'FreeText': '',
        },
        ts: Date.now(),
      };
      cache.set(w, out);
      return out;
    }

    const reason = candidates.some((candidate) => candidate.isAbbrev)
      ? 'Saīsinājumi un akronīmi nav atļauti'
      : candidates.some((candidate) => candidate.isProper)
        ? 'Īpašvārdi nav atļauti'
        : 'Nav atļauts kā parasts latviešu vārds';
    const out = { ok: false, word: w, reason, ts: Date.now() };
    cache.set(w, out);
    return out;
  }

  return { verifyWordStrict };
}

module.exports = { createWordValidator, normalizeWord, classifyDictionaryEntry, LATVIAN_WORD_RE };
