#!/usr/bin/env node
/**
 * Copyright Diario AI — recolector de noticias REALES.
 *
 * Regla de oro de este pipeline:
 *   La IA NUNCA es la fuente de los hechos. Solo traduce y resume texto que ya
 *   venía de una nota publicada y verificada. Cada tarjeta del sitio apunta a su
 *   artículo original.
 *
 * Flujo:
 *   1. Descarga feeds RSS/Atom de medios reales de la industria + búsquedas de Google News.
 *   2. Filtra por ventana de días y por relevancia (copyright / IA / música / legal).
 *   3. Deduplica por URL y por similitud de titular.
 *   4. VERIFICA que cada liga responda de verdad (HTTP < 400). Si no responde, se cae.
 *   5. Traduce/resume ES+EN con Groq, prohibido inventar datos. Si Groq falla,
 *      publica el titular y el extracto originales (sigue siendo real).
 *   6. Escribe noticias/data.json + snapshot en noticias/archivo/YYYY-MM-DD.json.
 *
 * Sin dependencias npm: solo Node >= 20 (fetch nativo).
 */

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────

const ROOT = path.join(__dirname, '..', '..');
const NOTICIAS_DIR = path.join(ROOT, 'noticias');
const DATA_FILE = path.join(NOTICIAS_DIR, 'data.json');
const ARCHIVE_DIR = path.join(NOTICIAS_DIR, 'archivo');
const ARCHIVE_INDEX = path.join(ARCHIVE_DIR, 'index.json');
const TIPS_FILE = path.join(NOTICIAS_DIR, 'tips.json');

const CONFIG = {
  maxAgeDays: 10,        // ventana de frescura
  maxItems: 12,          // tarjetas publicadas
  maxPerSource: 3,       // diversidad de medios
  minScore: 9,           // corte de relevancia (abajo de esto es ruido)
  minItems: 4,           // abajo de esto NO se sobrescribe data.json
  archiveKeep: 90,       // días de archivo en el índice
  requestTimeoutMs: 15000,
  verifyConcurrency: 6,
  userAgent: 'Mozilla/5.0 (compatible; MusicKnobsNewsBot/2.0; +https://jgmansur.github.io/musicknobs/noticias/)'
};

/** Feeds curados de medios reales de la industria musical y legal. */
const FEEDS = [
  { url: 'https://www.musicbusinessworldwide.com/feed/', source: 'Music Business Worldwide', lang: 'en' },
  { url: 'https://www.digitalmusicnews.com/feed/', source: 'Digital Music News', lang: 'en' },
  { url: 'https://musically.com/feed/', source: 'Music Ally', lang: 'en' },
  { url: 'https://completemusicupdate.com/feed/', source: 'Complete Music Update', lang: 'en' },
  { url: 'https://variety.com/v/music/feed/', source: 'Variety', lang: 'en' },
  { url: 'https://www.rollingstone.com/music/music-news/feed/', source: 'Rolling Stone', lang: 'en' },
  { url: 'https://www.riaa.com/feed/', source: 'RIAA', lang: 'en' },
  { url: 'https://industriamusical.com/feed/', source: 'Industria Musical', lang: 'es' },
  { url: 'https://torrentfreak.com/feed/', source: 'TorrentFreak', lang: 'en' },
  { url: 'https://www.copyright.gov/rss/newsnet.xml', source: 'U.S. Copyright Office', lang: 'en' },
  { url: 'https://feeds.arstechnica.com/arstechnica/tech-policy', source: 'Ars Technica', lang: 'en' },
  { url: 'https://www.billboard.com/feed/', source: 'Billboard', lang: 'en' }
];

/** Búsquedas de Google News (RSS público, sin API key). Amplían cobertura y traen prensa en español. */
const GOOGLE_NEWS_QUERIES = [
  { q: '"derechos de autor" música inteligencia artificial', hl: 'es-419', gl: 'MX', ceid: 'MX:es-419' },
  { q: 'música generada con IA demanda derechos autor', hl: 'es-419', gl: 'MX', ceid: 'MX:es-419' },
  { q: 'regalías música streaming derechos autor', hl: 'es-419', gl: 'MX', ceid: 'MX:es-419' },
  { q: 'music copyright AI lawsuit', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: 'Suno OR Udio OR "AI music" copyright ruling', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: 'music licensing royalties court decision', hl: 'en-US', gl: 'US', ceid: 'US:en' }
];

/**
 * Términos que hacen relevante una nota.
 *
 * Notación:
 *   'palabra'     → coincide con la palabra o cualquiera que empiece igual
 *                   ('royalt' → royalties, 'demand' → demanda/demandó).
 *   '=palabra'    → coincidencia EXACTA de palabra. Obligatorio en siglas y
 *                   palabras cortas: buscar 'ley' o 'sue' como subcadena traía
 *                   basura ("Bentley", "issue") y llenó la página de ruido.
 *   'dos palabras'→ frase literal.
 */
const KEYWORDS = {
  copyright: ['copyright', 'derechos de autor', 'propiedad intelectual', 'intellectual property',
    'infring', 'infracción', 'plagio', 'plagiarism', 'public domain', 'dominio público',
    'fair use', 'uso justo', '=dmca', 'takedown', '=indautor', '=sacm', '=ascap', '=bmi', '=sesac',
    'performing rights', 'derechos conexos', 'sampling', 'sample clearance', 'registro de obra',
    'derecho de autor', 'obra protegida', 'titularidad'],
  ai: ['=ai', '=a.i.', 'artificial intelligence', 'inteligencia artificial', '=ia', 'ia generativa',
    'generative', 'generativa', 'generativo', 'machine learning', 'deepfake', 'voice clone',
    'clonación de voz', 'voz clonada', '=suno', '=udio', 'stable audio', 'elevenlabs', '=llm',
    'training data', 'datos de entrenamiento', 'modelo de lenguaje'],
  // OJO: aquí solo van términos que de verdad significan "esto es de música".
  // Palabras de plataforma como "streaming" o "youtube" se salieron a propósito:
  // colaban notas de piratería de anime y de series que no le sirven a nadie aquí.
  music: ['music', 'música', 'musical', '=song', '=songs', 'canción', 'cancion', 'canciones',
    'álbum', '=album', '=albums', 'artist', 'artista', 'sello discográfico', 'disquera',
    '=spotify', 'apple music', '=soundcloud', '=bandcamp', '=tidal', '=deezer',
    'producer', 'productor', 'composer', 'compositor', 'songwriter', 'letrista',
    'publishing', 'editorial musical', 'royalt', 'regalía', 'regalias', 'regalías',
    'catálogo musical', '=umg', 'universal music', 'sony music', 'warner music', '=bmg',
    '=riaa', '=grammy', '=sacm', '=ascap', '=bmi', '=suno', '=udio', 'discográfic',
    'sello musical', '=track', '=tracks', 'banda sonora'],
  legal: ['lawsuit', 'demand', 'court', '=corte', 'tribunal', '=judge', '=juez', 'ruling', '=fallo',
    'sentencia', 'settlement', '=acuerdo', 'legislation', 'legislación', '=bill', '=ley', '=leyes',
    'regulation', 'regulación', '=senate', '=senado', 'congress', 'congreso', 'appeal', 'apelación',
    'licens', 'licenc', 'contract', 'contrato', '=sue', '=sued', '=sues', '=suing', 'juicio',
    'jurisprudencia', '=juzgado']
};

/** Etiquetas temáticas (se calculan en código, no las inventa la IA). */
const TAG_RULES = [
  { tag: 'lawsuit', terms: ['lawsuit', 'demand', 'court', '=corte', 'tribunal', '=sue', '=sued', '=sues', 'ruling', '=fallo', 'sentencia', '=judge', '=juez', 'settlement', 'juicio'] },
  { tag: 'ai', terms: ['=ai', 'artificial intelligence', 'inteligencia artificial', '=ia', '=suno', '=udio', 'generative', 'generativa', 'deepfake', 'voice clone', 'voz clonada'] },
  { tag: 'royalties', terms: ['royalt', 'regalía', 'regalias', 'regalías', 'payout', 'pago a artistas'] },
  { tag: 'licensing', terms: ['licens', 'licenc', '=deal', '=acuerdo', 'contract', 'contrato', 'clearance'] },
  { tag: 'legislation', terms: ['=bill', '=ley', '=leyes', 'legislation', 'legislación', 'regulation', 'regulación', '=senate', '=senado', 'congress', 'congreso'] },
  { tag: 'streaming', terms: ['=spotify', 'streaming', 'apple music', 'youtube music', '=tidal', '=deezer'] }
];

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

const log = (...args) => console.log('[news]', ...args);
const warn = (...args) => console.warn('[news][warn]', ...args);

function decodeEntities(str = '') {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
    mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', eacute: 'é'
  };
  return str
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => (name.toLowerCase() in named ? named[name.toLowerCase()] : m));
}

function stripHtml(str = '') {
  // Decodificar ANTES de limpiar: varios feeds (Google News) mandan el HTML
  // escapado como &lt;a href…&gt;, y si no se decodifica primero las etiquetas
  // terminan visibles en la tarjeta.
  const decoded = decodeEntities(str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
  return decodeEntities(
    decoded
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function escapeRegex(str = '') {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tagContent(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

function tagAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

async function httpGet(url, { method = 'GET', headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    redirect: 'follow',
    headers: {
      'User-Agent': CONFIG.userAgent,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
      'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
      ...headers
    },
    signal: AbortSignal.timeout(CONFIG.requestTimeoutMs)
  });
  return res;
}

/** Corre tareas async con concurrencia limitada. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { error: err };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

// ─────────────────────────────────────────────────────────────
// 1. Parseo de feeds
// ─────────────────────────────────────────────────────────────

function parseFeed(xml, fallbackSource) {
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)
  ];

  return blocks.map(([, block]) => {
    let title = stripHtml(tagContent(block, 'title'));

    let link = stripHtml(tagContent(block, 'link'));
    if (!link || !/^https?:/i.test(link)) {
      link = tagAttr(block, 'link', 'href') || stripHtml(tagContent(block, 'guid'));
    }

    let description = stripHtml(
      tagContent(block, 'description') ||
      tagContent(block, 'summary') ||
      tagContent(block, 'content:encoded') ||
      tagContent(block, 'content')
    );

    const dateRaw =
      stripHtml(tagContent(block, 'pubDate')) ||
      stripHtml(tagContent(block, 'published')) ||
      stripHtml(tagContent(block, 'updated')) ||
      stripHtml(tagContent(block, 'dc:date'));

    // Google News mete el medio real en <source>
    const feedSource = stripHtml(tagContent(block, 'source')) || fallbackSource;

    const published = dateRaw ? new Date(dateRaw) : null;
    const url = (link || '').trim();
    const isAggregator = /(^|\.)news\.google\.com$/i.test(hostOf(url));

    if (isAggregator) {
      // Google News repite el nombre del medio al final del titular y manda una
      // descripción que es puro <a href> hacia sí mismo: no aporta nada al resumen.
      if (feedSource) {
        title = title.replace(new RegExp(`\\s*[-–—]\\s*${escapeRegex(feedSource)}\\s*$`, 'i'), '').trim();
      }
      description = '';
    }

    return {
      title,
      url,
      description,
      source: feedSource,
      isAggregator,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null
    };
  });
}

async function collectCandidates() {
  const feedTargets = [
    ...FEEDS,
    ...GOOGLE_NEWS_QUERIES.map(({ q, hl, gl, ceid }) => ({
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`,
      source: 'Google News',
      lang: hl.startsWith('es') ? 'es' : 'en'
    }))
  ];

  const results = await pool(feedTargets, 5, async (feed) => {
    const res = await httpGet(feed.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseFeed(xml, feed.source).map((item) => ({ ...item, feedLang: feed.lang }));
    log(`feed ok: ${feed.source} (${items.length} items)`);
    return items;
  });

  const candidates = [];
  results.forEach((r, i) => {
    if (r && r.error) {
      warn(`feed falló: ${feedTargets[i].source} → ${r.error.message}`);
      return;
    }
    if (Array.isArray(r)) candidates.push(...r);
  });

  return candidates;
}

// ─────────────────────────────────────────────────────────────
// 2. Relevancia y filtrado
// ─────────────────────────────────────────────────────────────

/** Texto listo para comparar: minúsculas, sin acentos, palabras separadas por espacio. */
function searchable(text) {
  return ` ${text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}.]+/gu, ' ').trim()} `;
}

function stripAccents(term) {
  return term.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * Cuenta términos distintos presentes en el texto, respetando límites de palabra.
 * Se cuentan términos únicos, no repeticiones: una nota que repite "music" diez
 * veces no es más relevante que una que lo dice una vez.
 */
function countHits(hay, terms) {
  let hits = 0;
  for (const rawTerm of terms) {
    const exact = rawTerm.startsWith('=');
    const term = stripAccents(exact ? rawTerm.slice(1) : rawTerm);
    if (!term) continue;

    // exacto: la palabra completa. prefijo: cualquier palabra que empiece así.
    if (exact ? hay.includes(` ${term} `) : hay.includes(` ${term}`)) hits++;
  }
  return hits;
}

function scoreItem(item) {
  const hay = searchable(`${item.title} ${item.description}`);
  const copyright = countHits(hay, KEYWORDS.copyright);
  const ai = countHits(hay, KEYWORDS.ai);
  const music = countHits(hay, KEYWORDS.music);
  const legal = countHits(hay, KEYWORDS.legal);

  // Puerta de entrada: tiene que ser DE MÚSICA y además tener ángulo de
  // copyright, o de IA con contexto legal o claramente musical.
  if (music === 0) return 0;
  const passesAngle = copyright > 0 || (ai > 0 && (legal > 0 || music >= 2));
  if (!passesAngle) return 0;

  let score = copyright * 3 + ai * 2 + legal * 2 + music;

  // El combo estrella: música + IA + copyright
  if (copyright > 0 && ai > 0) score += 6;
  if (copyright > 0 && legal > 0) score += 3;

  // Frescura: hasta +8 por ser de hoy
  if (item.publishedAt) {
    const ageDays = (Date.now() - new Date(item.publishedAt).getTime()) / 86400000;
    score += Math.max(0, 8 - ageDays);
  }

  // Notas sin nada de texto valen menos (no hay qué resumir)
  if (item.description.length < 80) score -= 2;

  // Preferimos la liga directa al medio por encima del redirect de Google News,
  // pero sin bloquearlo: es lo que nos trae la prensa en español.
  if (item.isAggregator) score -= 1.5;

  return score;
}

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // quita acentos sin romper la palabra
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'sobre', 'para', 'como', 'esta', 'este', 'their', 'about', 'after', 'with', 'from', 'that',
  'says', 'said', 'over', 'into', 'more', 'than', 'will', 'have', 'been', 'they', 'tras',
  'ante', 'entre', 'segun', 'según', 'dice', 'dijo', 'nueva', 'nuevo', 'anos', 'años'
]);

function significantTokens(title) {
  return new Set(
    normalizeTitle(title)
      .split(' ')
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  );
}

/**
 * Dos titulares distintos pueden ser LA MISMA historia contada por medios
 * distintos (pasó con Round Hill vs. Suno: salió cuatro veces). Se considera
 * duplicado si comparten buena parte del vocabulario o si coinciden en varios
 * nombres propios/entidades.
 */
function isDuplicate(a, b) {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (!ta.size || !tb.size) return false;

  let inter = 0;
  ta.forEach((w) => { if (tb.has(w)) inter++; });

  const ratio = inter / Math.min(ta.size, tb.size);
  return ratio >= 0.5 || inter >= 5;
}

function detectTags(item) {
  const hay = searchable(`${item.title} ${item.description}`);
  return TAG_RULES.filter((r) => countHits(hay, r.terms) > 0).map((r) => r.tag).slice(0, 3);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function selectItems(candidates) {
  const cutoff = Date.now() - CONFIG.maxAgeDays * 86400000;

  const scored = candidates
    .filter((c) => c.title && c.url && /^https?:\/\//i.test(c.url))
    .filter((c) => !c.publishedAt || new Date(c.publishedAt).getTime() >= cutoff)
    .map((c) => ({ ...c, score: scoreItem(c) }))
    .filter((c) => c.score >= CONFIG.minScore)
    .sort((a, b) => b.score - a.score);

  const picked = [];
  const seenUrls = new Set();
  const perSource = new Map();

  for (const item of scored) {
    const cleanUrl = item.url.split('#')[0];
    if (seenUrls.has(cleanUrl)) continue;
    if (picked.some((p) => isDuplicate(p.title, item.title))) continue;

    const sourceKey = (item.source || hostOf(item.url) || 'desconocido').toLowerCase();
    const used = perSource.get(sourceKey) || 0;
    if (used >= CONFIG.maxPerSource) continue;

    seenUrls.add(cleanUrl);
    perSource.set(sourceKey, used + 1);
    picked.push({ ...item, url: cleanUrl, tags: detectTags(item) });

    // Traemos de más para sobrevivir a las bajas de la verificación
    if (picked.length >= CONFIG.maxItems * 2) break;
  }

  return picked;
}

// ─────────────────────────────────────────────────────────────
// 3. Verificación de ligas (esto es lo que sostiene la palabra "verificado")
// ─────────────────────────────────────────────────────────────

async function verifyItems(items) {
  const checked = await pool(items, CONFIG.verifyConcurrency, async (item) => {
    try {
      const res = await httpGet(item.url);
      if (res.status >= 400) {
        warn(`liga muerta (${res.status}): ${item.url}`);
        return null;
      }
      return { ...item, url: res.url || item.url, verifiedAt: new Date().toISOString() };
    } catch (err) {
      warn(`liga no verificable: ${item.url} → ${err.message}`);
      return null;
    }
  });

  return checked.filter((r) => r && !r.error);
}

// ─────────────────────────────────────────────────────────────
// 4. Traducción / resumen con Groq (IA como traductor, NUNCA como fuente)
// ─────────────────────────────────────────────────────────────

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const MODEL_PREFERENCE = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant'
];

/**
 * Elige un modelo que EXISTA hoy en la cuenta. Así no se vuelve a romper el día
 * que Groq deprecie el modelo de turno (que fue exactamente lo que pasó).
 */
async function pickModel(apiKey) {
  const res = await fetch(`${GROQ_BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(CONFIG.requestTimeoutMs)
  });
  if (!res.ok) throw new Error(`No se pudo listar modelos de Groq: HTTP ${res.status}`);

  const body = await res.json();
  const available = (body.data || []).map((m) => m.id);
  const chosen =
    MODEL_PREFERENCE.find((m) => available.includes(m)) ||
    available.find((m) => /llama|gpt-oss|qwen|kimi/i.test(m) && !/whisper|guard|tts/i.test(m));

  if (!chosen) throw new Error('Groq no ofrece ningún modelo de texto usable');
  log(`modelo Groq: ${chosen}`);
  return chosen;
}

function fallbackLocalization(item) {
  // Sin extracto no hay nada que resumir. Antes se repetía el titular como
  // resumen y la tarjeta se veía duplicada; mejor dejarlo vacío.
  const summary = item.description
    ? item.description.slice(0, 320).trim() + (item.description.length > 320 ? '…' : '')
    : '';
  return {
    es: { title: item.title, summary },
    en: { title: item.title, summary }
  };
}

async function localizeItems(items, apiKey) {
  if (!apiKey) {
    warn('sin GROQ_API_KEY: se publican titulares y extractos originales, sin traducir');
    return items.map((it) => ({ ...it, localized: fallbackLocalization(it), aiProcessed: false }));
  }

  let model;
  try {
    model = await pickModel(apiKey);
  } catch (err) {
    warn(`Groq no disponible (${err.message}); se publica el texto original`);
    return items.map((it) => ({ ...it, localized: fallbackLocalization(it), aiProcessed: false }));
  }

  const payload = items.map((it, i) => ({
    i,
    source: it.source,
    title: it.title,
    excerpt: it.description.slice(0, 700)
  }));

  const system =
    'Eres un traductor y redactor editorial. Trabajas ÚNICAMENTE con el texto que te entregan. ' +
    'PROHIBIDO agregar hechos, cifras, fechas, nombres, fallos judiciales o conclusiones que no estén ' +
    'literalmente en el texto recibido. Si el extracto es pobre, resume solo lo que dice el titular. ' +
    'Nunca especules ni completes con conocimiento propio. Devuelves SOLO JSON válido, sin markdown.';

  const user =
    'Para cada nota devuelve título y resumen en español (es) y en inglés (en).\n' +
    'Reglas: resumen de 30 a 45 palabras, tono informativo y claro para músicos y productores, ' +
    'sin adjetivos sensacionalistas, sin "según el artículo", sin inventar nada.\n' +
    'Formato exacto de salida:\n' +
    '{"items":[{"i":0,"es":{"title":"...","summary":"..."},"en":{"title":"...","summary":"..."}}]}\n\n' +
    'Notas:\n' + JSON.stringify(payload, null, 1);

  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 6000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      }),
      signal: AbortSignal.timeout(90000)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);

    const body = await res.json();
    const raw = body.choices?.[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const byIndex = new Map((parsed.items || []).map((x) => [Number(x.i), x]));

    return items.map((it, i) => {
      const t = byIndex.get(i);
      const ok =
        t && t.es?.title && t.es?.summary && t.en?.title && t.en?.summary &&
        String(t.es.summary).length > 40 && String(t.en.summary).length > 40;

      if (!ok) {
        warn(`traducción incompleta para "${it.title.slice(0, 60)}" → se usa el original`);
        return { ...it, localized: fallbackLocalization(it), aiProcessed: false };
      }

      return {
        ...it,
        aiProcessed: true,
        localized: {
          es: { title: String(t.es.title).trim(), summary: String(t.es.summary).trim() },
          en: { title: String(t.en.title).trim(), summary: String(t.en.summary).trim() }
        }
      };
    });
  } catch (err) {
    warn(`falló la traducción con Groq (${err.message}); se publica el texto original`);
    return items.map((it) => ({ ...it, localized: fallbackLocalization(it), aiProcessed: false }));
  }
}

// ─────────────────────────────────────────────────────────────
// 5. Tip del día (curado a mano, NO generado por IA)
// ─────────────────────────────────────────────────────────────

function pickTip() {
  try {
    const tips = JSON.parse(fs.readFileSync(TIPS_FILE, 'utf8'));
    if (!Array.isArray(tips) || !tips.length) return null;
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getUTCFullYear(), 0, 0)) / 86400000);
    return tips[dayOfYear % tips.length];
  } catch (err) {
    warn(`no se pudo leer tips.json: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 6. Salida
// ─────────────────────────────────────────────────────────────

function buildData(items) {
  const now = new Date().toISOString();
  const tip = pickTip();

  const toLang = (lang) => ({
    title: lang === 'es'
      ? 'Noticias de Copyright e Inteligencia Artificial'
      : 'Copyright & Artificial Intelligence News',
    subtitle: lang === 'es'
      ? 'Notas publicadas por medios reales de la industria, con liga al artículo original. Sin noticias inventadas.'
      : 'Stories published by real industry outlets, each linked to its original article. No invented news.',
    items: items.map((it, i) => ({
      id: `noticia-${i + 1}`,
      title: it.localized[lang].title,
      summary: it.localized[lang].summary,
      url: it.url,
      source: it.source || hostOf(it.url),
      domain: hostOf(it.url),
      publishedAt: it.publishedAt,
      tags: it.tags,
      translated: it.aiProcessed,
      via: it.isAggregator ? 'Google News' : null
    })),
    tip: tip ? tip[lang] : null
  });

  return {
    lastUpdated: now,
    meta: {
      method: 'rss-retrieval + link-verification + ai-translation',
      itemCount: items.length,
      sources: [...new Set(items.map((i) => i.source || hostOf(i.url)))].sort(),
      verifiedLinks: items.length,
      aiTranslated: items.filter((i) => i.aiProcessed).length,
      note: 'Los hechos provienen de los artículos originales enlazados. La IA solo traduce y resume; no genera noticias.'
    },
    es: toLang('es'),
    en: toLang('en')
  };
}

function writeArchive(data) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const day = data.lastUpdated.slice(0, 10);
  fs.writeFileSync(path.join(ARCHIVE_DIR, `${day}.json`), JSON.stringify(data, null, 2), 'utf8');

  let index = [];
  try {
    index = JSON.parse(fs.readFileSync(ARCHIVE_INDEX, 'utf8'));
    if (!Array.isArray(index)) index = [];
  } catch { /* primera vez */ }

  index = index.filter((e) => e.date !== day);
  index.unshift({ date: day, items: data.meta.itemCount, updatedAt: data.lastUpdated });
  index = index.slice(0, CONFIG.archiveKeep);

  fs.writeFileSync(ARCHIVE_INDEX, JSON.stringify(index, null, 2), 'utf8');
  log(`archivo actualizado: ${day} (${index.length} ediciones en el índice)`);
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  log('recolectando feeds…');
  const candidates = await collectCandidates();
  log(`candidatos crudos: ${candidates.length}`);

  if (!candidates.length) throw new Error('Ningún feed respondió. No se toca data.json.');

  const selected = selectItems(candidates);
  log(`relevantes tras filtro y dedupe: ${selected.length}`);

  const verified = (await verifyItems(selected)).slice(0, CONFIG.maxItems);
  log(`con liga verificada: ${verified.length}`);

  if (verified.length < CONFIG.minItems) {
    throw new Error(
      `Solo ${verified.length} notas verificadas (mínimo ${CONFIG.minItems}). ` +
      'Se conserva la edición anterior en vez de publicar una página pobre.'
    );
  }

  const localized = await localizeItems(verified, process.env.GROQ_API_KEY);
  const data = buildData(localized);

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  writeArchive(data);

  log(`✅ listo: ${data.meta.itemCount} notas · ${data.meta.sources.length} medios · ` +
    `${data.meta.aiTranslated} traducidas por IA`);
}

main().catch((err) => {
  console.error('========================');
  console.error('🚨 FALLÓ LA ACTUALIZACIÓN DE NOTICIAS');
  console.error('========================');
  console.error(err.message);
  if (err.stack) console.error(err.stack);
  console.error('La edición anterior sigue publicada; no se sobrescribió nada.');
  process.exit(1);
});
