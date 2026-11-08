const MAX_CONCH = 6;
const CONCH_LIST = ["卡爾", "逮蝦", "螺神", "螺寶", "啵塞咚", "礦工", "爆螺", "拖拉機", "船長"];
const EMOTIONS = ["呆", "黑", "怒", "墨", "笑"];
const WIN_KEYS = ["贏的螺", "赢的螺", "winner", "Winner", "WINNER"];
const WINNER_ALIAS = { "螺保": "螺寶" };
const EXCEL_HEADER = CONCH_LIST.concat(["赢的螺"]);
const EXTRA_KEY = "conchExtraRecords_v1";
const BASE_KEY = "conchBaseRecords_v1";
const BASE_NAME_KEY = "conchBaseName_v1";
const LANG_KEY = "conchLang_v1";
const NAMES_KEY = "conchNames_v1";
const PICK_KEY = "conchPick_v1";
const MOOD_ICONS_KEY = "conchMoodIcons_v1";
const MOOD_SIG = 14;
const MOOD_MATCH_MIN = 0.9;
const MOOD_MATCH_MARGIN = 0.04;
const MOOD_MAX_TEMPLATES = 10;

const state = {
  selected: new Set(),
  emotions: {},
  results: null,
  compact: false,
  uncertain: new Set()
};

const el = (id) => document.getElementById(id);

/* ---------- Language & conch-name settings ---------- */

function loadLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  } catch (e) { /* ignore */ }
  const nav = (navigator.language || "").toLowerCase();
  if (nav.startsWith("en")) return "en";
  if (nav.includes("hans") || nav === "zh-cn" || nav === "zh-sg") return "zh-Hans";
  return "zh-Hant";
}

let lang = loadLang();

function t(key, vars) {
  const table = I18N[lang] || I18N["zh-Hant"];
  let text = table[key] != null ? table[key] : (I18N["zh-Hant"][key] != null ? I18N["zh-Hant"][key] : key);
  if (vars) {
    Object.keys(vars).forEach((name) => {
      text = text.split("{" + name + "}").join(String(vars[name]));
    });
  }
  return text;
}

function loadConchNames() {
  try {
    const raw = localStorage.getItem(NAMES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch (e) { /* ignore */ }
  return {};
}

let conchNamesStored = loadConchNames();
let aliasIndexCache = null;

function defaultConchNames(canon) {
  return CONCH_DEFAULT_NAMES[canon] || { en: "", "zh-Hant": canon, "zh-Hans": canon };
}

function conchNameSet(canon) {
  const defaults = defaultConchNames(canon);
  const saved = conchNamesStored[canon] || {};
  const out = {};
  ["en", "zh-Hant", "zh-Hans"].forEach((code) => {
    const value = typeof saved[code] === "string" ? saved[code].trim() : "";
    out[code] = value || defaults[code] || "";
  });
  return out;
}

function conchLabel(canon, useLang) {
  const names = conchNameSet(canon);
  return names[useLang || lang] || names["zh-Hant"] || canon;
}

function conchNameValues(canon) {
  const names = conchNameSet(canon);
  const set = new Set([canon, names.en, names["zh-Hant"], names["zh-Hans"]]);
  return [...set].filter(Boolean);
}

function emotionLabel(emotion) {
  const labels = EMOTION_LABELS[emotion];
  return (labels && (labels[lang] || labels["zh-Hant"])) || emotion;
}

function escHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function normName(value) {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u00a0\u3000]+/g, "")
    .replace(/[·・.,，。!！?？:：;；'"“”‘’`()（）\[\]【】{}<>《》_\-—–~～\/\\|@#$%^&*+=]/g, "");
}

function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function nameScore(text, alias) {
  if (!text || !alias) return 0;
  if (text === alias) return 1;
  if (alias.length >= 2 && text.includes(alias)) return 1;
  if (text.length >= 4 && alias.length > text.length && alias.includes(text)) return 0.85;
  if (/[\u3400-\u9fff]/.test(alias)) {
    const chars = [...alias];
    const hit = chars.filter((ch) => text.includes(ch)).length;
    const ratio = hit / chars.length;
    return ratio >= 0.5 ? Math.min(0.97, 0.5 + ratio * 0.47) : 0;
  }
  if (alias.length < 2) return 0;
  const ratio = 1 - editDistance(text, alias) / Math.max(text.length, alias.length);
  return ratio >= 0.7 ? Math.min(0.95, ratio) : 0;
}

function conchAliasIndex() {
  if (aliasIndexCache) return aliasIndexCache;
  const list = [];
  CONCH_LIST.forEach((canon) => {
    conchNameValues(canon).forEach((name) => {
      const norm = normName(name);
      if (norm) list.push({ canon, norm, raw: name });
    });
  });
  list.sort((a, b) => b.norm.length - a.norm.length);
  aliasIndexCache = list;
  return list;
}

function canonicalAliasExact(value) {
  const norm = normName(value);
  if (!norm) return null;
  for (const canon of CONCH_LIST) {
    if (normName(canon) === norm) return canon;
  }
  for (const alias of conchAliasIndex()) {
    if (alias.norm === norm) return alias.canon;
  }
  return null;
}

function applyStaticI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((node) => {
    node.innerHTML = t(node.dataset.i18nHtml);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder));
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((node) => {
    node.setAttribute("alt", t(node.dataset.i18nAlt));
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAria));
  });
  const page = document.body.dataset.page || "index";
  const titleKey = page === "records" ? "app.recordsTitle" : (page === "settings" ? "app.settingsTitle" : "app.indexTitle");
  document.title = t(titleKey);
  document.querySelectorAll("[data-lang]").forEach((btn) => {
    const active = btn.dataset.lang === lang;
    btn.classList.toggle("on", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function initI18n() {
  applyStaticI18n();
  document.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => setLanguage(btn.dataset.lang));
  });
}

function applyTableHeaders() {
  document.querySelectorAll("[data-conch-head]").forEach((th) => {
    th.textContent = conchLabel(th.dataset.conchHead);
  });
}

function refreshPageText() {
  const page = document.body.dataset.page || "index";
  if (page === "records") {
    applyTableHeaders();
    renderDataTable();
    updateCounts();
    noteDataset();
    return;
  }
  if (page === "settings") {
    document.querySelectorAll("[data-name-label]").forEach((node) => {
      node.textContent = "🐚 " + conchLabel(node.dataset.nameLabel);
    });
    return;
  }
  const prevResults = state.results;
  renderGrid();
  state.results = prevResults;
  updateCounter();
  updateCounts();
  if (prevResults) renderResults({ scroll: false });
  noteDataset();
}

function setLanguage(next) {
  if (!SUPPORTED_LANGS.includes(next)) return;
  lang = next;
  try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignore */ }
  applyStaticI18n();
  refreshPageText();
}

function savePickState() {
  try {
    if (!state.selected.size) {
      localStorage.removeItem(PICK_KEY);
      return;
    }
    localStorage.setItem(PICK_KEY, JSON.stringify({
      selected: [...state.selected],
      emotions: { ...state.emotions },
      uncertain: [...state.uncertain].filter((name) => state.selected.has(name)),
      missWinner: state.selected.has(missWinner) ? missWinner : "",
      compact: state.compact,
      lineupExpanded
    }));
  } catch (e) { /* ignore */ }
}

function restorePickState() {
  try {
    const raw = localStorage.getItem(PICK_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return;
    const selected = Array.isArray(saved.selected)
      ? saved.selected.filter((name, i, list) => CONCH_LIST.includes(name) && list.indexOf(name) === i).slice(0, MAX_CONCH)
      : [];
    if (!selected.length) return;
    state.selected = new Set(selected);
    state.emotions = {};
    const emotions = saved.emotions && typeof saved.emotions === "object" ? saved.emotions : {};
    state.selected.forEach((name) => {
      if (EMOTIONS.includes(emotions[name])) state.emotions[name] = emotions[name];
    });
    const uncertain = Array.isArray(saved.uncertain) ? saved.uncertain : [];
    state.uncertain = new Set(uncertain.filter((name) => state.selected.has(name)));
    missWinner = state.selected.has(saved.missWinner) ? saved.missWinner : "";
    state.compact = !!saved.compact && state.selected.size > 0;
    lineupExpanded = !!saved.lineupExpanded && state.selected.size === MAX_CONCH;
  } catch (e) { /* ignore */ }
}

function loadStoredRecords(key) {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((r) => r && r.conch && typeof r.conch === "object" && r.winner);
  } catch (e) {
    return [];
  }
}

function saveExtra() {
  try { localStorage.setItem(EXTRA_KEY, JSON.stringify(extraRecords)); } catch (e) { /* ignore */ }
}

function loadBaseName() {
  try { return localStorage.getItem(BASE_NAME_KEY) || ""; } catch (e) { return ""; }
}

function saveBase() {
  try {
    localStorage.setItem(BASE_KEY, JSON.stringify(baseRecords));
    localStorage.setItem(BASE_NAME_KEY, baseName || "");
  } catch (e) { /* ignore */ }
}

let baseRecords = loadStoredRecords(BASE_KEY);
let baseName = loadBaseName();
let extraRecords = loadStoredRecords(EXTRA_KEY);

const RETIRED_DEFAULT = "賭螺紀錄261013-2.xlsx";
const RETIRED_FLAG = "conchDropDefault_v1";

function dropRetiredDefault() {
  let already = "";
  try { already = localStorage.getItem(RETIRED_FLAG) || ""; } catch (e) { return; }
  if (already) return;
  try { localStorage.setItem(RETIRED_FLAG, "1"); } catch (e) { /* still drop this session */ }
  if (baseName !== RETIRED_DEFAULT) return;
  baseRecords = [];
  baseName = "";
  saveBase();
}

dropRetiredDefault();

function allRecords() { return baseRecords.concat(extraRecords); }

function updateCounts() {
  const total = allRecords().length;
  const set = (id, text) => { const node = el(id); if (node) node.textContent = text; };
  set("recordCount", String(total));
  set("footCount", String(total));
  set("dataCount", String(total));
  const extraCount = el("extraCount");
  if (extraCount) extraCount.textContent = t("results.count", { n: extraRecords.length });
  const summary = el("extraSummaryCount");
  if (summary) summary.textContent = String(extraRecords.length);
  const wrap = el("extraWrap");
  if (wrap) wrap.classList.toggle("hidden", extraRecords.length === 0);
  updateSourceLabel();
  updateUnsaved();
}

function updateUnsaved() {
  const n = extraRecords.length;
  const text = t("unsaved.text", { n });
  document.querySelectorAll("[data-unsaved-text]").forEach((node) => {
    node.textContent = text;
  });
  document.querySelectorAll("[data-unsaved]").forEach((node) => {
    node.classList.toggle("hidden", n === 0);
  });
}

function updateSourceLabel() {
  const name = baseName || (baseRecords.length ? t("source.browser") : "");
  const pill = el("fileName");
  const foot = el("footSource");
  if (pill) pill.textContent = name || t("source.notLoaded");
  if (foot) foot.textContent = name || t("source.notLoadedExcel");
}

function init() {
  initI18n();
  restorePickState();
  setOcrStatus(t("ocr.ready"), 0);
  updateCounts();
  renderGrid();
  updateCounter();
  el("submitBtn").addEventListener("click", runMatch);
  const resetBtn = el("resetBtn");
  if (resetBtn) resetBtn.addEventListener("click", reset);
  el("clearPickBtn").addEventListener("click", reset);
  const showAll = el("showAllBtn");
  if (showAll) showAll.addEventListener("click", () => {
    state.compact = false;
    lineupExpanded = true;
    renderGrid();
  });
  el("missSaveBtn").addEventListener("click", saveMissRecord);
  const missDl = el("missDownloadBtn");
  if (missDl) missDl.addEventListener("click", downloadExcel);
  const unsavedDl = el("unsavedDownloadBtn");
  if (unsavedDl) unsavedDl.addEventListener("click", downloadExcel);
  setupShot();
  setupManage();
  noteDataset();
}

let ocrWorker = null;
let ocrBusy = false;

function setupShot() {
  const input = el("shotInput");
  el("shotBtn").addEventListener("click", () => input.click());
  el("clearShotBtn").addEventListener("click", clearShot);
  input.addEventListener("change", () => {
    if (input.files && input.files[0]) handleImageFile(input.files[0]);
  });

  const dz = el("dropzone");
  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragging"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragging"); })
  );
  dz.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleImageFile(file);
  });

  document.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { handleImageFile(file); e.preventDefault(); }
        break;
      }
    }
  });
}

function setOcrStatus(text, pct) {
  el("ocrStatus").textContent = text;
  if (typeof pct === "number") el("ocrProgress").style.width = `${Math.round(pct * 100)}%`;
}

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  const base = new URL("vendor/tesseract/", location.href).href;
  setOcrStatus(t("ocr.engine"), 0);
  ocrWorker = await Tesseract.createWorker("chi_tra+chi_sim+eng", 1, {
    workerPath: base + "worker.min.js",
    langPath: base + "tessdata",
    corePath: base,
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === "loading tesseract core") setOcrStatus(t("ocr.core"), m.progress);
      else if (m.status === "loading language traineddata") setOcrStatus(t("ocr.lang"), m.progress);
      else if (m.status === "initializing api") setOcrStatus(t("ocr.init"), m.progress);
      else if (m.status === "recognizing text") setOcrStatus(t("ocr.recognizing"), m.progress);
    }
  });
  return ocrWorker;
}

function loadImageEl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { resolve({ img: im, url }); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    im.src = url;
  });
}

let cvPromise = null;
function loadOpenCV() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    const done = () => { if (window.cv && window.cv.Mat) resolve({ cv: window.cv }); };
    const kick = () => {
      if (!window.cv) return;
      if (window.cv.Mat) return done();
      try { window.cv.then(() => done()); } catch (e) { /* ignore */ }
    };
    setTimeout(kick, 1500);
    const t0 = Date.now();
    (function poll() {
      if (window.cv && window.cv.Mat) return done();
      if (Date.now() - t0 > 180000) return reject(new Error("OpenCV 載入逾時"));
      setTimeout(poll, 200);
    })();
  });
  return cvPromise;
}

function detectBoxes(cv, cvsrc) {
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const dil = new cv.Mat();
  cv.cvtColor(cvsrc, gray, cv.COLOR_RGBA2GRAY);
  cv.Canny(gray, edges, 30, 100);
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(edges, dil, kernel);
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(dil, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  const W = cvsrc.cols, H = cvsrc.rows, WH = W * H;
  const cand = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const r = cv.boundingRect(c);
    c.delete();
    const area = r.width * r.height;
    const ar = r.width / r.height;
    if (area > WH * 0.03 && area < WH * 0.30 && ar > 0.7 && ar < 1.9) {
      cand.push({ x: r.x, y: r.y, w: r.width, h: r.height, area });
    }
  }
  cand.sort((a, b) => b.area - a.area);

  const picked = [];
  for (const b of cand) {
    let ov = false;
    for (const p of picked) {
      const ix = Math.max(0, Math.min(b.x + b.w, p.x + p.w) - Math.max(b.x, p.x));
      const iy = Math.max(0, Math.min(b.y + b.h, p.y + p.h) - Math.max(b.y, p.y));
      if (ix * iy > 0.4 * Math.min(b.w * b.h, p.w * p.h)) { ov = true; break; }
    }
    if (!ov) picked.push(b);
  }
  const max = picked.length ? picked[0].area : 0;
  const final = picked.filter((b) => b.area >= max * 0.5).slice(0, MAX_CONCH);
  final.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  gray.delete(); edges.delete(); dil.delete(); kernel.delete();
  contours.delete(); hier.delete();
  return final;
}

function cropRegion(img, b, y0, y1, scale) {
  const sy = img.naturalHeight;
  const ch = b.h * (y1 - y0);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(b.w * scale));
  c.height = Math.max(1, Math.round(ch * scale));
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, b.x, b.y + b.h * y0, b.w, ch, 0, 0, c.width, c.height);
  return { canvas: c, sy };
}

function bestConch(text) {
  const norm = normName(text);
  let best = null;
  const perConch = {};
  for (const alias of conchAliasIndex()) {
    const match = {
      score: nameScore(norm, alias.norm),
      exact: alias.norm === norm,
      length: alias.norm.length
    };
    if (betterAliasMatch(match, perConch[alias.canon])) perConch[alias.canon] = match;
  }
  let bestMatch = null;
  for (const canon of CONCH_LIST) {
    const match = perConch[canon];
    if (match && betterAliasMatch(match, bestMatch)) {
      best = canon;
      bestMatch = match;
    }
  }
  return { name: bestMatch && bestMatch.score >= 0.5 ? best : null, score: bestMatch ? bestMatch.score : 0 };
}

function betterAliasMatch(a, b) {
  if (!b) return true;
  if (a.score !== b.score) return a.score > b.score;
  if (a.exact !== b.exact) return a.exact;
  return a.length > b.length;
}

function bestEmotion(text) {
  const norm = normName(text);
  let best = null, bestN = 0;
  for (const em of EMOTIONS) {
    let n = 0;
    (EMOTION_ALIASES[em] || [em]).forEach((alias) => {
      const a = normName(alias);
      if (!a) return;
      if (/[\u3400-\u9fff]/.test(a)) n += norm.split(a).length - 1;
      else if (a.length >= 3 && norm.includes(a)) n += 1;
    });
    if (n > bestN) { bestN = n; best = em; }
  }
  return { emotion: best, count: bestN };
}

/* ---------- Mood icon templates ---------- */

function loadMoodIcons() {
  const size = MOOD_SIG * MOOD_SIG;
  const out = {};
  EMOTIONS.forEach((em) => { out[em] = []; });
  try {
    const raw = localStorage.getItem(MOOD_ICONS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
    EMOTIONS.forEach((em) => {
      const list = Array.isArray(parsed[em]) ? parsed[em] : [];
      out[em] = list
        .filter((sig) => Array.isArray(sig) && sig.length === size && sig.every((v) => typeof v === "number" && isFinite(v)))
        .slice(-MOOD_MAX_TEMPLATES);
    });
  } catch (e) { /* ignore */ }
  return out;
}

let moodIcons = loadMoodIcons();
let moodPending = {};

function saveMoodIcons() {
  try { localStorage.setItem(MOOD_ICONS_KEY, JSON.stringify(moodIcons)); } catch (e) { /* ignore */ }
}

function cosineSimilarity(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function moodIconScores(sig) {
  const scores = {};
  EMOTIONS.forEach((em) => {
    let best = -Infinity;
    (moodIcons[em] || []).forEach((tpl) => {
      const score = cosineSimilarity(sig, tpl);
      if (score > best) best = score;
    });
    if (best > -Infinity) scores[em] = best;
  });
  return scores;
}

function matchMoodIcon(sig) {
  if (!Array.isArray(sig) || sig.length !== MOOD_SIG * MOOD_SIG) return null;
  const scores = moodIconScores(sig);
  const ranked = Object.keys(scores).map((em) => [em, scores[em]]).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const emotion = ranked[0][0];
  const score = ranked[0][1];
  const runnerUp = ranked.length > 1 ? ranked[1][1] : -1;
  if (score < MOOD_MATCH_MIN) return null;
  if (runnerUp > -1 && score - runnerUp < MOOD_MATCH_MARGIN) return null;
  return { emotion, score };
}

function learnMoodIcon(emotion, sig) {
  if (!EMOTIONS.includes(emotion)) return false;
  if (!Array.isArray(sig) || sig.length !== MOOD_SIG * MOOD_SIG) return false;
  let changed = false;
  EMOTIONS.forEach((em) => {
    if (em === emotion) return;
    const existing = moodIcons[em] || [];
    const kept = existing.filter((tpl) => cosineSimilarity(tpl, sig) < MOOD_MATCH_MIN);
    if (kept.length !== existing.length) { moodIcons[em] = kept; changed = true; }
  });
  const list = moodIcons[emotion] || (moodIcons[emotion] = []);
  if (!list.some((tpl) => cosineSimilarity(tpl, sig) >= 0.995)) {
    list.push(sig);
    if (list.length > MOOD_MAX_TEMPLATES) list.splice(0, list.length - MOOD_MAX_TEMPLATES);
    changed = true;
  }
  if (changed) saveMoodIcons();
  return true;
}

function iconInk(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  const value = mx / 255;
  return (sat > 0.35 && value > 0.25) || value < 0.42;
}

function iconSignature(img, box) {
  try {
    const iw = img.naturalWidth || img.width || 0;
    const ih = img.naturalHeight || img.height || 0;
    if (!iw || !ih) return null;
    const rx0 = Math.max(0, Math.round(box.x + box.w * 0.02));
    const rx1 = Math.min(iw, Math.round(box.x + box.w * 0.5));
    const ry0 = Math.max(0, Math.round(box.y + box.h * 0.05));
    const ry1 = Math.min(ih, Math.round(box.y + box.h * 0.5));
    const w = rx1 - rx0;
    const h = ry1 - ry0;
    if (w < 24 || h < 24) return null;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, rx0, ry0, w, h, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        mask[y * w + x] = iconInk(data[i], data[i + 1], data[i + 2]) ? 1 : 0;
      }
    }

    const seen = new Uint8Array(w * h);
    let icon = null;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const start = y * w + x;
        if (!mask[start] || seen[start]) continue;
        const stack = [start];
        seen[start] = 1;
        let x0 = x, x1 = x, y0 = y, y1 = y, count = 0;
        while (stack.length) {
          const p = stack.pop();
          count++;
          const px = p % w;
          const py = (p - px) / w;
          if (px < x0) x0 = px;
          if (px > x1) x1 = px;
          if (py < y0) y0 = py;
          if (py > y1) y1 = py;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = px + dx;
              const ny = py + dy;
              if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
              const ni = ny * w + nx;
              if (mask[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
            }
          }
        }
        const cw = x1 - x0 + 1;
        const ch = y1 - y0 + 1;
        const ar = cw / ch;
        if (count < 120 || cw < 18 || ch < 18 || cw > 130 || ch > 130) continue;
        if (ar < 0.55 || ar > 1.8) continue;
        if (!icon || count > icon.count) icon = { x: x0, y: y0, w: cw, h: ch, count };
      }
    }
    if (!icon) return null;

    const pad = Math.max(1, Math.round(Math.max(icon.w, icon.h) * 0.04));
    const sx0 = Math.max(0, icon.x - pad);
    const sy0 = Math.max(0, icon.y - pad);
    const sx1 = Math.min(w, icon.x + icon.w + pad);
    const sy1 = Math.min(h, icon.y + icon.h + pad);
    if (sx1 - sx0 < 4 || sy1 - sy0 < 4) return null;

    const values = [];
    for (let gy = 0; gy < MOOD_SIG; gy++) {
      for (let gx = 0; gx < MOOD_SIG; gx++) {
        const xa = Math.floor(sx0 + ((sx1 - sx0) * gx) / MOOD_SIG);
        const xb = Math.max(xa + 1, Math.floor(sx0 + ((sx1 - sx0) * (gx + 1)) / MOOD_SIG));
        const ya = Math.floor(sy0 + ((sy1 - sy0) * gy) / MOOD_SIG);
        const yb = Math.max(ya + 1, Math.floor(sy0 + ((sy1 - sy0) * (gy + 1)) / MOOD_SIG));
        let sum = 0, n = 0;
        for (let y = ya; y < Math.min(yb, h); y++) {
          for (let x = xa; x < Math.min(xb, w); x++) {
            const i = (y * w + x) * 4;
            sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            n++;
          }
        }
        values.push(n ? sum / n : 0);
      }
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const centered = values.map((v) => v - mean);
    const norm = Math.sqrt(centered.reduce((a, v) => a + v * v, 0)) || 1;
    return centered.map((v) => v / norm);
  } catch (e) {
    return null;
  }
}

function drawOverlay(boxes) {
  const wrap = el("shotPreviewWrap");
  let ov = el("shotOverlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "shotOverlay";
    ov.className = "shot-overlay";
    wrap.appendChild(ov);
  }
  const img = el("shotPreview");
  const W = img.naturalWidth || 1, H = img.naturalHeight || 1;
  ov.innerHTML = boxes.map((b, i) =>
    `<div class="shot-box" style="left:${(b.x / W) * 100}%;top:${(b.y / H) * 100}%;width:${(b.w / W) * 100}%;height:${(b.h / H) * 100}%"><span>${i + 1}</span></div>`
  ).join("");
}

async function handleImageFile(file) {
  if (ocrBusy) return;
  ocrBusy = true;
  el("ocrBar").classList.remove("hidden");
  el("clearShotBtn").classList.remove("hidden");
  el("ocrTextWrap").classList.add("hidden");
  el("ocrText").textContent = "";
  setOcrStatus(t("ocr.reading"), 0);

  let img;
  try {
    const loaded = await loadImageEl(file);
    img = loaded.img;
    const oldOverlay = el("shotOverlay");
    if (oldOverlay) oldOverlay.remove();
    el("shotPreview").src = loaded.url;
    el("shotPreviewWrap").classList.remove("hidden");
  } catch (e) {
    setOcrStatus(t("ocr.readFail"), 1);
    ocrBusy = false;
    return;
  }

  try {
    setOcrStatus(t("ocr.detectBoxes"), 0.05);
    const cv = (await loadOpenCV()).cv;
    const src = cv.imread(img);
    const boxes = detectBoxes(cv, src);
    src.delete();
    drawOverlay(boxes);

    if (!boxes.length) {
      setOcrStatus(t("ocr.noBoxes"), 1);
      ocrBusy = false;
      return;
    }
    setOcrStatus(t("ocr.boxesFound", { n: boxes.length }), 0.15);

    const worker = await getOcrWorker();
    const pairs = [];
    const logLines = [];
    let pendingUnmatched = 0;
    moodPending = {};

    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];

      const nameCanvas = cropRegion(img, b, 0.0, 0.5, 3).canvas;
      const nd = await worker.recognize(nameCanvas);
      const nameText = (nd.data.text || "").trim();
      const name = bestConch(nameText);

      const sig = iconSignature(img, b);
      let em = { emotion: null, count: 0 };
      let emText = "";
      let emFromIcon = false;
      if (sig) {
        const iconMatch = matchMoodIcon(sig);
        if (iconMatch) {
          em = { emotion: iconMatch.emotion, count: 1 };
          emFromIcon = true;
        }
      }
      if (!em.emotion) {
        const emCanvas = cropRegion(img, b, 0.5, 1.0, 3).canvas;
        const ed = await worker.recognize(emCanvas);
        emText = (ed.data.text || "").trim();
        em = bestEmotion(emText);
      }

      if (name.name) {
        if (sig) moodPending[name.name] = sig;
        if (sig && !em.emotion) pendingUnmatched++;
      }

      logLines.push(t("ocr.logLine", {
        i: i + 1,
        nameText: nameText.replace(/\s+/g, ""),
        name: name.name ? conchLabel(name.name) : "?",
        score: Math.round((name.score || 0) * 100),
        emText: emFromIcon ? t("ocr.iconTag") : emText.replace(/\s+/g, ""),
        emotion: em.emotion ? emotionLabel(em.emotion) : "?"
      }));
      if (name.name) {
        pairs.push({
          conch: name.name,
          emotion: em.emotion || "",
          uncertain: !em.emotion || (name.score || 0) < 1,
          box: i + 1
        });
      }

      setOcrStatus(t("ocr.boxStatus", {
        i: i + 1,
        total: boxes.length,
        name: name.name ? conchLabel(name.name) : "?",
        emotion: em.emotion ? emotionLabel(em.emotion) : "?"
      }), 0.15 + 0.85 * ((i + 1) / boxes.length));
    }

    if (pendingUnmatched) logLines.push("", t("ocr.moodLearnHint"));

    el("ocrText").textContent = logLines.join("\n");
    el("ocrTextWrap").classList.remove("hidden");

    const withEmotion = pairs.filter((p) => p.emotion);
    if (pairs.length) applyDetected(pairs);
    setOcrStatus(t("ocr.done", { boxes: boxes.length, names: pairs.length, emotions: withEmotion.length }), 1);
  } catch (err) {
    console.error(err);
    setOcrStatus(t("ocr.failed", { msg: err && err.message ? err.message : err }), 1);
  } finally {
    ocrBusy = false;
  }
}

function collectWords(data) {
  const words = [];
  (data.blocks || []).forEach((b) => (b.paragraphs || []).forEach((p) =>
    (p.lines || []).forEach((l) => (l.words || []).forEach((w) => {
      const t = (w.text || "").replace(/\s/g, "");
      if (t && w.bbox) words.push({ text: t, bbox: w.bbox, conf: w.confidence });
    }))
  ));
  return words;
}

function matchConch(text) {
  const norm = normName(text);
  if (!norm) return null;
  for (const alias of conchAliasIndex()) {
    if (norm.includes(alias.norm)) return alias.canon;
  }
  return null;
}

function emotionTokens(word) {
  const tokens = [];
  const chars = [...word.text];
  const b = word.bbox;
  const w = (b.x1 - b.x0) / Math.max(chars.length, 1);
  chars.forEach((ch, i) => {
    if (EMOTIONS.includes(ch)) {
      tokens.push({ em: ch, cx: b.x0 + w * (i + 0.5), cy: (b.y0 + b.y1) / 2, conf: word.conf });
    }
  });
  const norm = normName(word.text);
  EMOTIONS.forEach((em) => {
    (EMOTION_ALIASES[em] || []).forEach((alias) => {
      const a = normName(alias);
      if (a.length >= 3 && !/[\u3400-\u9fff]/.test(a) && norm.includes(a)) {
        tokens.push({ em, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, conf: word.conf });
      }
    });
  });
  return tokens;
}

function parseConchFromOCR(data) {
  const words = collectWords(data);
  const text = (data.text || "").replace(/\n{3,}/g, "\n\n").trim();

  const conchHits = [];
  const emotes = [];
  words.forEach((w) => {
    const c = matchConch(w.text);
    if (c) {
      conchHits.push({ name: c, cx: (w.bbox.x0 + w.bbox.x1) / 2, cy: (w.bbox.y0 + w.bbox.y1) / 2 });
    }
    emotes.push(...emotionTokens(w));
  });

  const used = new Set();
  const pairs = [];
  conchHits.forEach((ch) => {
    let best = null;
    let bestD = Infinity;
    emotes.forEach((e, i) => {
      if (used.has(i)) return;
      const d = Math.hypot(e.cx - ch.cx, e.cy - ch.cy);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best !== null) {
      used.add(best);
      pairs.push({ conch: ch.name, emotion: emotes[best].em });
    }
  });

  const seen = new Set();
  const unique = pairs.filter((p) => {
    if (seen.has(p.conch)) return false;
    seen.add(p.conch);
    return true;
  });

  return { pairs: unique.slice(0, MAX_CONCH), text };
}

function applyDetected(pairs) {
  state.selected.clear();
  state.emotions = {};
  state.uncertain = new Set();
  pairs.slice(0, MAX_CONCH).forEach((p) => {
    if (!p.conch || !CONCH_LIST.includes(p.conch)) return;
    state.selected.add(p.conch);
    if (EMOTIONS.includes(p.emotion)) state.emotions[p.conch] = p.emotion;
    if (p.uncertain || !EMOTIONS.includes(p.emotion)) state.uncertain.add(p.conch);
  });
  state.compact = state.selected.size > 0;
  lineupExpanded = false;
  state.results = null;
  const results = el("results");
  if (results) results.classList.add("hidden");
  const dz = el("dropzone");
  if (dz) dz.classList.add("collapsed");
  renderGrid();
  updateCounter();
  const submit = el("submitBtn");
  if (submit && submit.scrollIntoView) submit.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearShot() {
  el("shotPreview").removeAttribute("src");
  el("shotPreviewWrap").classList.add("hidden");
  el("ocrBar").classList.add("hidden");
  el("ocrTextWrap").classList.add("hidden");
  el("clearShotBtn").classList.add("hidden");
  el("shotInput").value = "";
  const dz = el("dropzone");
  if (dz) dz.classList.remove("collapsed");
  state.compact = false;
  lineupExpanded = false;
  state.uncertain.clear();
  moodPending = {};
  if (el("conchGrid")) renderGrid();
}

const addState = { selected: new Set(), emotions: {}, winner: "" };
let addFromMatch = false;

function setupManage() {
  if (el("addForm")) renderAddForm();
  renderExtra();
  const addBtn = el("addRecordBtn");
  if (addBtn) addBtn.addEventListener("click", () => addRecord());
  const save = el("saveExcelBtn");
  if (save) save.addEventListener("click", downloadExcel);
  const file = el("excelFile");
  if (file) file.addEventListener("change", (e) => {
    const picked = e.target.files && e.target.files[0];
    if (picked) readExcelFile(picked);
    e.target.value = "";
  });
  setupExcelDrop();
}

function renderAddForm() {
  const wrap = el("addForm");
  wrap.innerHTML = "";
  CONCH_LIST.forEach((name) => {
    const card = document.createElement("div");
    card.className = "add-card";
    if (addState.selected.has(name)) card.classList.add("on");

    const label = document.createElement("label");
    label.className = "add-name";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = addState.selected.has(name);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (addState.selected.size >= MAX_CONCH) {
          cb.checked = false;
          flashAdd(t("add.maxFlash", { n: MAX_CONCH }));
          return;
        }
        addState.selected.add(name);
      } else {
        addState.selected.delete(name);
        delete addState.emotions[name];
        if (addState.winner === name) addState.winner = "";
      }
      renderAddForm();
    });
    label.appendChild(cb);
    label.insertAdjacentHTML("beforeend", `<span>🐚 ${escHtml(conchLabel(name))}</span>`);
    card.appendChild(label);

    const sel = document.createElement("select");
    sel.className = "emotion-select";
    sel.innerHTML = `<option value="">${t("records.choose")}…</option>` +
      EMOTIONS.map((e) => `<option value="${e}">${emotionLabel(e)}</option>`).join("");
    sel.value = addState.emotions[name] || "";
    sel.disabled = !addState.selected.has(name);
    sel.addEventListener("change", () => { addState.emotions[name] = sel.value; updateAddHint(); });
    card.appendChild(sel);

    wrap.appendChild(card);
  });

  const win = document.createElement("div");
  win.className = "add-winner";
  win.innerHTML = `<span>${t("records.colWinner")}</span>`;
  const ws = document.createElement("select");
  ws.innerHTML = `<option value="">${t("records.choose")}…</option>` +
    [...addState.selected].map((n) => `<option value="${n}">${escHtml(conchLabel(n))}</option>`).join("");
  ws.value = addState.winner || "";
  ws.disabled = addState.selected.size === 0;
  ws.addEventListener("change", () => { addState.winner = ws.value; updateAddHint(); });
  win.appendChild(ws);
  wrap.appendChild(win);

  updateAddHint();
}

function updateAddHint() {
  const n = addState.selected.size;
  const missing = [...addState.selected].filter((c) => !addState.emotions[c]);
  el("addRecordBtn").disabled = !(n === MAX_CONCH && !missing.length && addState.winner);
  const hint = el("addHint");
  if (n < MAX_CONCH) hint.textContent = t("add.need", { n, max: MAX_CONCH, left: MAX_CONCH - n });
  else if (missing.length) hint.textContent = t("add.setMood", { names: missing.map((c) => conchLabel(c)).join(lang === "en" ? ", " : "、") });
  else if (!addState.winner) hint.textContent = addFromMatch
    ? t("add.chooseWinnerMatch")
    : t("add.chooseWinner");
  else hint.textContent = t("add.ok");
  hint.style.color = addFromMatch && !addState.winner ? "var(--gold)" : "";
}

function flashAdd(msg) {
  const hint = el("addHint");
  hint.textContent = msg;
  hint.style.color = "var(--gold)";
  setTimeout(() => { hint.style.color = ""; }, 1600);
}

function addRecord(record) {
  let rec = record;
  if (!rec) {
    const conch = {};
    [...addState.selected].forEach((n) => (conch[n] = addState.emotions[n]));
    rec = { conch, winner: addState.winner };
  }
  extraRecords.push(rec);
  saveExtra();
  if (record) setDataHint(t("hint.addedOne", { winner: rec.winner ? conchLabel(rec.winner) : "-" }));
  if (!record) {
    addFromMatch = false;
    addState.selected.clear();
    addState.emotions = {};
    addState.winner = "";
    const panel = document.querySelector(".manage-panel");
    if (panel) panel.classList.remove("prefilled");
    renderAddForm();
    flashAdd(t("hint.addedFlash"));
  }
  renderExtra();
  updateCounts();
  refreshResults();
}

function renderExtra() {
  const list = el("extraList");
  if (!list) return;
  if (!extraRecords.length) { list.innerHTML = ""; return; }
  list.innerHTML = "";
  extraRecords.forEach((rec, i) => {
    const card = document.createElement("div");
    card.className = "record";
    const tags = Object.entries(rec.conch).map(([name, em]) => {
      let cls = "conch-tag";
      if (rec.winner === name) cls += " win";
      return `<span class="${cls}">${escHtml(conchLabel(name))}<span class="em">${escHtml(emotionLabel(em))}</span></span>`;
    }).join("");
    card.innerHTML = `
      <div class="record-top">
        <span class="record-index">${t("extra.addedIndex", { n: i + 1 })}</span>
        <span class="winner-badge">${escHtml(t("results.winnerLabel", { name: rec.winner ? conchLabel(rec.winner) : "-" }))}</span>
        <button class="record-del" type="button">${t("records.delete")}</button>
      </div>
      <div class="conch-tags">${tags}</div>`;
    card.querySelector(".record-del").addEventListener("click", () => {
      extraRecords.splice(i, 1);
      saveExtra();
      renderExtra();
      updateCounts();
      refreshResults();
    });
    list.appendChild(card);
  });
}

function setDataHint(msg) {
  const hint = el("dataHint");
  if (hint) hint.textContent = msg;
}

function normCell(v) {
  return String(v == null ? "" : v).replace(/\u00a0/g, " ").trim();
}

function parseWorkbook(data) {
  if (typeof XLSX === "undefined") throw new Error(t("hint.xlsxMissing"));
  let bytes = data;
  let type = "array";
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(data)) type = "buffer";
  const wb = XLSX.read(bytes, { type });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error(t("hint.sheetMissing"));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: "" });

  const isWinHeader = (cell) => {
    const norm = normName(cell);
    return WIN_KEYS.some((key) => normName(key) === norm);
  };

  let headerIdx = -1;
  let cols = null;
  const scan = Math.min(rows.length, 20);
  for (let i = 0; i < scan; i++) {
    const cells = (rows[i] || []).map(normCell);
    const hits = new Set(cells.map(canonicalAliasExact).filter(Boolean)).size;
    const hasWin = cells.some(isWinHeader);
    if (hits >= 3 || hasWin) { headerIdx = i; cols = cells; break; }
  }

  const conchCol = {};
  let winIdx = -1;
  let start = 0;
  if (cols) {
    CONCH_LIST.forEach((name) => {
      const idx = cols.findIndex((cell) => canonicalAliasExact(cell) === name);
      if (idx >= 0) conchCol[name] = idx;
    });
    winIdx = cols.findIndex(isWinHeader);
    start = headerIdx + 1;
  } else {
    CONCH_LIST.forEach((name, i) => { conchCol[name] = i; });
    winIdx = CONCH_LIST.length;
  }

  const records = [];
  let skipped = 0;
  let normalized = 0;
  for (let r = start; r < rows.length; r++) {
    const cells = (rows[r] || []).map(normCell);
    if (!cells.some((c) => c !== "")) continue;
    const conch = {};
    CONCH_LIST.forEach((name) => {
      const idx = conchCol[name];
      if (idx == null) return;
      const v = cells[idx] || "";
      if (EMOTIONS.includes(v)) conch[name] = v;
    });
    let winnerRaw = winIdx >= 0 ? (cells[winIdx] || "") : "";
    if (WINNER_ALIAS[winnerRaw]) { winnerRaw = WINNER_ALIAS[winnerRaw]; normalized++; }
    const winner = canonicalAliasExact(winnerRaw) || winnerRaw;
    if (Object.keys(conch).length && CONCH_LIST.includes(winner)) records.push({ conch, winner });
    else skipped++;
  }
  return { records, skipped, normalized };
}

function applyLoadedRecords(parsed, filename) {
  const { records, skipped, normalized } = parsed;
  if (!records.length) {
    setDataHint(t("hint.excelNoGames"));
    return;
  }
  const clearBox = el("clearExtrasOnOpen");
  if (clearBox && clearBox.checked && extraRecords.length) {
    extraRecords = [];
    saveExtra();
    renderExtra();
  }
  baseRecords = records;
  baseName = filename || baseName;
  saveBase();
  updateCounts();
  refreshResults();
  if (el("dataBody")) renderDataTable();
  const bits = [t("hint.excelLoaded", { file: baseName, n: records.length })];
  if (skipped) bits.push(t("hint.excelSkipped", { n: skipped }));
  if (normalized) bits.push(t("hint.excelNormalized", { n: normalized }));
  if (extraRecords.length) bits.push(t("hint.excelExtras", { n: extraRecords.length }));
  else bits.push(t("hint.excelDownloadTip"));
  setDataHint(bits.join(""));
}

function readExcelFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try { applyLoadedRecords(parseWorkbook(reader.result), file.name); }
    catch (err) { setDataHint(t("hint.excelReadFail", { msg: err && err.message ? err.message : err })); }
  };
  reader.onerror = () => setDataHint(t("hint.fileReadFail"));
  reader.readAsArrayBuffer(file);
}

function setupExcelDrop() {
  const panel = el("dataPanel");
  if (!panel) return;
  ["dragenter", "dragover"].forEach((ev) =>
    panel.addEventListener(ev, (e) => {
      const types = e.dataTransfer && e.dataTransfer.types;
      if (!types || ![...types].includes("Files")) return;
      e.preventDefault();
      panel.classList.add("dragging");
    })
  );
  panel.addEventListener("dragleave", (e) => {
    if (e.relatedTarget && panel.contains(e.relatedTarget)) return;
    panel.classList.remove("dragging");
  });
  panel.addEventListener("drop", (e) => {
    e.preventDefault();
    panel.classList.remove("dragging");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.xlsx?$/i.test(file.name)) { setDataHint(t("hint.xlsxOnly")); return; }
    readExcelFile(file);
  });
}

function workbookFromRecords(records) {
  const aoa = [EXCEL_HEADER.slice()];
  records.forEach((r) => {
    const row = CONCH_LIST.map((c) => (r.conch && r.conch[c]) || "");
    row.push(r.winner || "");
    aoa.push(row);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = EXCEL_HEADER.map((h) => ({ wch: Math.max(8, h.length * 2 + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "工作表1");
  return wb;
}

function excelDownloadName() {
  const raw = (baseName || t("records.defaultFileName")).replace(/[\\/:*?"<>|]/g, "_");
  if (/\.xlsx$/i.test(raw)) return raw;
  return raw.replace(/\.xls$/i, "") + ".xlsx";
}

function downloadExcel() {
  const records = allRecords();
  if (!records.length) { setDataHint(t("hint.noRecordsWrite")); return; }
  if (typeof XLSX === "undefined") { setDataHint(t("hint.xlsxMissing")); return; }
  const name = excelDownloadName();
  const folded = extraRecords.length;
  try {
    XLSX.writeFile(workbookFromRecords(records), name);
  } catch (e) {
    setDataHint(t("hint.downloadFail", { msg: e && e.message ? e.message : e }));
    return;
  }
  if (folded) {
    baseRecords = baseRecords.concat(extraRecords);
    extraRecords = [];
    saveBase();
    saveExtra();
    renderExtra();
    if (el("dataBody")) renderDataTable();
  }
  updateCounts();
  setDataHint(folded
    ? t("hint.downloadedFolded", { name, n: records.length, folded })
    : t("hint.downloaded", { name, n: records.length }));
}

function noteDataset() {
  if (!allRecords().length) {
    setDataHint(document.body.dataset.page === "records"
      ? t("hint.noneRecords")
      : t("hint.nonePredict"));
    return;
  }
  const name = baseName ? ` (${baseName})` : "";
  if (document.body.dataset.page === "records") {
    setDataHint(t("hint.loadedRecords", { n: allRecords().length, filePart: name }));
  } else {
    setDataHint(t("hint.loadedPredict", { n: allRecords().length, filePart: name }));
  }
}

function renderGrid() {
  const grid = el("conchGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (state.selected.size < MAX_CONCH) lineupExpanded = false;
  grid.classList.toggle("only-selected", state.compact && state.selected.size > 0);
  grid.classList.toggle("lineup-full", state.selected.size === MAX_CONCH && !lineupExpanded && !state.compact);
  CONCH_LIST.forEach((name) => {
    const card = document.createElement("div");
    card.className = "conch-card";
    card.dataset.conch = name;

    const top = document.createElement("div");
    top.className = "conch-top";
    const unsure = state.uncertain.has(name) ? `<span class="uncertain-tag">${t("pick.uncertain")}</span>` : "";
    top.innerHTML = `<span class="conch-name">🐚 ${escHtml(conchLabel(name))}${unsure}</span><span class="conch-toggle">✓</span>`;
    top.addEventListener("click", () => toggleConch(name));
    card.appendChild(top);

    if (state.selected.has(name)) {
      card.classList.add("selected");
      if (state.emotions[name]) card.classList.add("picked");
      if (state.uncertain.has(name)) card.classList.add("uncertain");
    }

    const row = document.createElement("div");
    row.className = "emotion-row";
    EMOTIONS.forEach((em) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emotion-btn";
      btn.dataset.em = em;
      btn.textContent = emotionLabel(em);
      btn.title = em;
      if (state.emotions[name] === em) btn.classList.add("active");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!state.selected.has(name)) toggleConch(name, true);
        const previous = state.emotions[name];
        state.emotions[name] = em;
        state.uncertain.delete(name);
        let learned = false;
        const sig = moodPending[name];
        if (sig && previous !== em) {
          const iconMatch = matchMoodIcon(sig);
          if (!iconMatch || iconMatch.emotion !== em) learned = learnMoodIcon(em, sig);
        }
        renderGrid();
        updateCounter();
        refreshResults();
        if (learned) flashHint(t("pick.moodLearned", { emotion: emotionLabel(em) }));
      });
      row.appendChild(btn);
    });
    card.appendChild(row);

    grid.appendChild(card);
  });
  const showAll = el("showAllBtn");
  if (showAll) showAll.classList.toggle("hidden", !(state.compact && state.selected.size > 0));
  refreshResults();
  savePickState();
}

function toggleConch(name, forceSelect) {
  if (state.selected.has(name) && !forceSelect) {
    state.selected.delete(name);
    delete state.emotions[name];
    state.uncertain.delete(name);
  } else if (!state.selected.has(name)) {
    if (state.selected.size >= MAX_CONCH) {
      flashHint(t("pick.maxFlash", { n: MAX_CONCH }));
      return;
    }
    state.selected.add(name);
  }
  renderGrid();
  updateCounter();
}

function updateCounter() {
  const n = state.selected.size;
  el("counter").innerHTML = t("pick.counter", { n });

  const ready = n === MAX_CONCH && CONCH_LIST.every((c) => !state.selected.has(c) || state.emotions[c]);
  el("submitBtn").disabled = !ready;

  if (n < MAX_CONCH) {
    el("hint").textContent = t("pick.needMore", { n: MAX_CONCH - n });
  } else if (!ready) {
    const missing = [...state.selected].filter((c) => !state.emotions[c]).map((c) => conchLabel(c));
    el("hint").textContent = t("pick.missing", { names: missing.join(lang === "en" ? ", " : "、") });
  } else {
    el("hint").textContent = t("pick.ready");
  }
}

function flashHint(msg) {
  const hint = el("hint");
  hint.textContent = msg;
  hint.style.color = "var(--gold)";
  setTimeout(() => { hint.style.color = ""; }, 1600);
}

function scoreRecord(record) {
  let matched = 0;
  let shared = 0;
  for (const [name, em] of Object.entries(record.conch)) {
    if (state.selected.has(name)) {
      shared++;
      if (state.emotions[name] === em) matched++;
    }
  }
  return { matched, shared };
}

function runMatch() {
  const input = {};
  state.selected.forEach((c) => (input[c] = state.emotions[c]));

  const scored = allRecords().map((r, i) => {
    const s = scoreRecord(r);
    return { index: i, record: r, ...s };
  });

  const exact = scored.filter((x) => x.matched === MAX_CONCH && x.shared === MAX_CONCH);
  const best = scored.reduce((m, x) => Math.max(m, x.matched * 100 + x.shared), 0);

  const closestGroup = scored.filter((x) => x.matched * 100 + x.shared === best);
  const group = exact.length ? exact : closestGroup;

  const winners = {};
  group.forEach((g) => {
    const w = g.record.winner;
    if (w) winners[w] = (winners[w] || 0) + 1;
  });
  const ranked = Object.entries(winners).sort((a, b) => b[1] - a[1]);

  const closest = [...scored]
    .filter((x) => !(exact.length && x.matched === MAX_CONCH && x.shared === MAX_CONCH))
    .sort((a, b) => (b.matched - a.matched) || (b.shared - a.shared))
    .slice(0, 8);

  state.results = { input, exact, closest, ranked, best, groupSize: group.length };
  renderResults();
}

function renderResults(options) {
  if (!state.results) return;
  const opts = options || {};
  el("results").classList.remove("hidden");
  const { input, exact, closest, ranked, best, groupSize } = state.results;

  const banner = el("matchBanner");
  if (exact.length) {
    banner.className = "match-banner exact";
    banner.textContent = t("results.bannerExact", { n: exact.length });
  } else {
    banner.className = "match-banner none";
    const pct = Math.round((Math.floor(best / 100) / MAX_CONCH) * 100);
    banner.textContent = t("results.bannerNone", { pct });
  }

  const pred = el("predictionCard");
  if (ranked.length) {
    pred.classList.remove("hidden");
    const [winner, count] = ranked[0];
    const label = exact.length ? t("results.predExactLabel") : t("results.predCloseLabel");
    const chips = ranked.map(([w, c]) => {
      const pct = Math.round((c / groupSize) * 100);
      return `<span class="dist-chip">${escHtml(conchLabel(w))} <strong>${c}</strong> · ${pct}%</span>`;
    }).join("");
    pred.innerHTML = `<h3>${escHtml(label)}</h3><div class="prediction-main"><span class="prediction-winner">${escHtml(t("results.predMain", { name: conchLabel(winner), total: groupSize, count }))}</span></div><div class="distribution">${chips}</div>`;
  } else {
    pred.classList.add("hidden");
  }

  el("exactCount").textContent = t("results.count", { n: exact.length });
  el("closeCount").textContent = t("results.count", { n: closest.length });
  renderList(el("exactList"), exact, input, true);
  renderList(el("closeList"), closest, input, false);
  renderMissSave(exact.length === 0);
  if (exact.length === 0 && el("addForm")) prefillAddFromPick();
  const scrollTarget = pred && !pred.classList.contains("hidden") ? pred : el("results");
  if (opts.scroll !== false && scrollTarget && scrollTarget.scrollIntoView) {
    scrollTarget.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function prefillAddFromPick() {
  if (!el("addForm") || state.selected.size !== MAX_CONCH) return;
  addFromMatch = true;
  addState.selected = new Set(state.selected);
  addState.emotions = {};
  state.selected.forEach((name) => { addState.emotions[name] = state.emotions[name]; });
  if (!addState.selected.has(addState.winner)) addState.winner = "";
  renderAddForm();
  const panel = document.querySelector(".manage-panel");
  if (panel) panel.classList.add("prefilled");
  const sel = el("addForm").querySelector(".add-winner select");
  if (sel && !addState.winner) sel.focus();
}

let missWinner = "";
let lineupExpanded = false;

function currentPickRecord(winner) {
  const conch = {};
  CONCH_LIST.forEach((name) => {
    if (state.selected.has(name)) conch[name] = state.emotions[name];
  });
  return { conch, winner };
}

function sameRecord(a, b) {
  if (!a || !b || a.winner !== b.winner) return false;
  const keys = Object.keys(a.conch || {});
  const other = b.conch || {};
  if (keys.length !== Object.keys(other).length) return false;
  return keys.every((k) => a.conch[k] === other[k]);
}

function renderMissSave(show) {
  const box = el("missSave");
  if (!show) {
    box.classList.add("hidden");
    return;
  }
  if (!state.selected.has(missWinner)) missWinner = "";
  box.classList.remove("hidden");
  const picks = el("missPicks");
  picks.innerHTML = "";
  CONCH_LIST.forEach((name) => {
    if (!state.selected.has(name)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "miss-pick" + (missWinner === name ? " on" : "");
    btn.innerHTML = `<span>${escHtml(conchLabel(name))}</span><span class="em">${state.emotions[name] ? escHtml(emotionLabel(state.emotions[name])) : ""}</span>`;
    btn.addEventListener("click", () => {
      missWinner = name;
      renderMissSave(true);
    });
    picks.appendChild(btn);
  });
  el("missSaveBtn").disabled = !missWinner;
  el("missHint").textContent = missWinner
    ? t("miss.hintWillWin", { name: conchLabel(missWinner) })
    : t("miss.hintPick");
  savePickState();
}

function saveMissRecord() {
  if (!missWinner || state.selected.size !== MAX_CONCH) return;
  if ([...state.selected].some((name) => !state.emotions[name])) return;
  const rec = currentPickRecord(missWinner);
  if (allRecords().some((r) => sameRecord(r, rec))) {
    el("missHint").textContent = t("miss.alreadyExists");
    return;
  }
  addRecord(rec);
  runMatch();
}

function renderList(container, items, input, isExact) {
  if (!items.length) {
    container.innerHTML = `<div class="empty">${isExact ? t("results.emptyExact") : t("results.emptyClose")}</div>`;
    return;
  }
  container.innerHTML = items.map((item) => recordCard(item, input)).join("");
}

function recordCard(item, input) {
  const { record, matched, shared, index } = item;
  const isExtra = index >= baseRecords.length;
  const pct = Math.round((matched / MAX_CONCH) * 100);

  const tags = Object.entries(record.conch).map(([name, em]) => {
    let cls = "conch-tag";
    if (input[name] === em) cls += " hit";
    else if (input[name]) cls += " miss";
    if (record.winner === name) cls += " win";
    return `<span class="${cls}">${escHtml(conchLabel(name))}<span class="em">${escHtml(emotionLabel(em))}</span></span>`;
  }).join("");

  return `
    <div class="record">
      <div class="record-top">
        <span class="record-index">#${index + 1}${isExtra ? ` <span class="added-badge">${t("results.addedBadge")}</span>` : ""}</span>
        <span class="sim-label">${t("results.matchLabel", { matched, pct })}</span>
        <div class="simbar"><span style="width:${pct}%"></span></div>
        <span class="winner-badge">${escHtml(t("results.winnerLabel", { name: record.winner ? conchLabel(record.winner) : "-" }))}</span>
      </div>
      <div class="conch-tags">${tags}</div>
    </div>`;
}

function refreshResults() {
  if (!state.results) return;
  state.results = null;
  const box = el("results");
  if (box) box.classList.add("hidden");
}

let tableEdit = null;
let tableQuery = "";

function rowSearchText(rec) {
  const conch = rec && rec.conch || {};
  const parts = [];
  CONCH_LIST.forEach((name) => {
    const em = conch[name];
    if (!em) return;
    parts.push(conchNameValues(name).join(" "), em, emotionLabel(em), (EMOTION_ALIASES[em] || []).join(" "));
  });
  if (rec && rec.winner) parts.push(conchNameValues(rec.winner).join(" "), rec.winner);
  return parts.join(" ");
}

function fillSelect(sel, values, current, blankLabel, labelFn) {
  if (blankLabel != null) {
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = blankLabel;
    sel.appendChild(blank);
  }
  values.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = labelFn ? labelFn(value) : value;
    sel.appendChild(opt);
  });
  sel.value = values.includes(current) ? current : "";
}

function readDraft(tr) {
  const conch = {};
  CONCH_LIST.forEach((name) => {
    const sel = tr.querySelector(`select[data-conch="${name}"]`);
    const value = sel ? sel.value : "";
    if (EMOTIONS.includes(value)) conch[name] = value;
  });
  const winnerSel = tr.querySelector('select[data-field="winner"]');
  return { conch, winner: winnerSel ? winnerSel.value : "" };
}

function writeRecordAt(index, rec) {
  if (index < baseRecords.length) {
    baseRecords[index] = rec;
    saveBase();
  } else {
    extraRecords[index - baseRecords.length] = rec;
    saveExtra();
  }
}

function removeRecordAt(index) {
  if (index < baseRecords.length) {
    baseRecords.splice(index, 1);
    saveBase();
  } else {
    extraRecords.splice(index - baseRecords.length, 1);
    saveExtra();
  }
}

function renderDataTable() {
  const body = el("dataBody");
  if (!body) return;
  if (tableEdit && tableEdit.isNew) {
    const live = body.querySelector('tr[data-index="new"]');
    if (live) tableEdit.draft = readDraft(live);
  }
  const records = allRecords();
  const q = tableQuery.trim().toLowerCase();
  body.innerHTML = "";
  let shown = 0;

  const paint = (index, rec, isNew) => {
    const tr = document.createElement("tr");
    tr.dataset.index = isNew ? "new" : String(index);
    if (isNew) tr.classList.add("editing");
    if (!isNew && index >= baseRecords.length) tr.classList.add("extra-row");

    const num = document.createElement("td");
    num.textContent = isNew ? t("records.newRow") : String(index + 1);
    tr.appendChild(num);

    const meta = { index, isNew };
    const addCell = (sel) => {
      sel.className = "cell-select";
      sel.dataset.prev = sel.value;
      sel.addEventListener("change", () => onTableCellChange(tr, meta, sel));
      const td = document.createElement("td");
      td.appendChild(sel);
      tr.appendChild(td);
    };

    CONCH_LIST.forEach((name) => {
      const sel = document.createElement("select");
      sel.dataset.conch = name;
      fillSelect(sel, EMOTIONS, (rec.conch && rec.conch[name]) || "", "—", (value) => emotionLabel(value));
      addCell(sel);
    });

    const wsel = document.createElement("select");
    wsel.dataset.field = "winner";
    fillSelect(wsel, CONCH_LIST, rec.winner || "", t("records.choose"), (value) => conchLabel(value));
    addCell(wsel);

    const actions = document.createElement("td");
    actions.className = "row-actions";
    actions.appendChild(actionBtn(t("records.delete"), "record-del", () => {
      if (tr.dataset.index === "new") discardNewRow();
      else deleteTableRow(Number(tr.dataset.index));
    }));
    tr.appendChild(actions);
    body.appendChild(tr);
    shown++;
  };

  records.forEach((rec, index) => {
    if (q && !rowSearchText(rec).toLowerCase().includes(q)) return;
    paint(index, rec, false);
  });
  if (tableEdit && tableEdit.isNew) {
    paint(records.length, tableEdit.draft || { conch: {}, winner: "" }, true);
  }

  const empty = el("dataEmpty");
  if (empty) {
    empty.textContent = records.length ? t("records.emptyFiltered") : t("records.emptyNone");
    empty.classList.toggle("hidden", shown > 0);
  }
  const shownCount = el("dataShown");
  if (shownCount) shownCount.textContent = q ? `${shown} / ${records.length}` : String(records.length);
}

function onTableCellChange(tr, meta, sel) {
  const rec = readDraft(tr);
  const valid = Object.keys(rec.conch).length > 0 && CONCH_LIST.includes(rec.winner);
  if (meta.isNew) {
    if (tableEdit) tableEdit.draft = rec;
    if (!valid) {
      setDataHint(t("hint.invalidNewRow"));
      return;
    }
    extraRecords.push(rec);
    saveExtra();
    meta.isNew = false;
    meta.index = allRecords().length - 1;
    tableEdit = null;
    tr.classList.remove("editing");
    tr.classList.add("extra-row");
    tr.dataset.index = String(meta.index);
    if (tr.firstChild) tr.firstChild.textContent = String(meta.index + 1);
    tr.querySelectorAll("select").forEach((node) => { node.dataset.prev = node.value; });
    updateCounts();
    const shownCount = el("dataShown");
    if (shownCount && !tableQuery) shownCount.textContent = String(allRecords().length);
    setDataHint(t("hint.addedRow", { n: meta.index + 1 }));
    tr.scrollIntoView({ block: "nearest" });
    return;
  }
  if (!valid) {
    sel.value = sel.dataset.prev || "";
    setDataHint(t("hint.invalidRow"));
    return;
  }
  writeRecordAt(meta.index, rec);
  tr.querySelectorAll("select").forEach((node) => { node.dataset.prev = node.value; });
  updateCounts();
  setDataHint(t("hint.savedRow", { n: meta.index + 1 }));
}

function discardNewRow() {
  const row = el("dataBody") && el("dataBody").querySelector('tr[data-index="new"]');
  const draft = row ? readDraft(row) : (tableEdit && tableEdit.draft) || { conch: {}, winner: "" };
  const had = Object.keys(draft.conch).length > 0 || !!draft.winner;
  tableEdit = null;
  renderDataTable();
  setDataHint(t("hint.cancelled"));
  if (had) {
    showUndo(t("hint.cancelled"), () => {
      tableEdit = { isNew: true, draft };
      const filter = el("dataFilter");
      if (filter) filter.value = "";
      tableQuery = "";
      renderDataTable();
      const restored = el("dataBody") && el("dataBody").querySelector('tr[data-index="new"]');
      if (restored) restored.scrollIntoView({ block: "nearest" });
    });
  }
}

function actionBtn(label, className, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function deleteTableRow(index) {
  const rec = allRecords()[index];
  if (!rec) return;
  const rowNo = index + 1;
  const winnerLabel = rec.winner ? conchLabel(rec.winner) : "-";
  if (!window.confirm(t("hint.deleteConfirm", { n: rowNo, winner: winnerLabel }))) return;
  const snapshot = JSON.parse(JSON.stringify(rec));
  const wasExtra = index >= baseRecords.length;
  const localIndex = wasExtra ? index - baseRecords.length : index;
  removeRecordAt(index);
  updateCounts();
  renderDataTable();
  setDataHint(t("hint.deletedRow", { n: rowNo }));
  showUndo(t("hint.deletedRow", { n: rowNo }), () => {
    if (wasExtra) {
      extraRecords.splice(Math.min(localIndex, extraRecords.length), 0, snapshot);
      saveExtra();
    } else {
      baseRecords.splice(Math.min(localIndex, baseRecords.length), 0, snapshot);
      saveBase();
    }
    updateCounts();
    renderDataTable();
    const globalIndex = wasExtra ? baseRecords.length + localIndex : localIndex;
    const row = el("dataBody") && el("dataBody").querySelector(`tr[data-index="${globalIndex}"]`);
    if (row) row.scrollIntoView({ block: "nearest" });
    setDataHint(t("hint.restoredRow", { n: rowNo }));
  });
}

function beginAddRow() {
  if (tableEdit && tableEdit.isNew) {
    const row = el("dataBody") && el("dataBody").querySelector('tr[data-index="new"]');
    if (row) row.scrollIntoView({ block: "nearest" });
    return;
  }
  tableEdit = { isNew: true, draft: { conch: {}, winner: "" } };
  const filter = el("dataFilter");
  if (filter) filter.value = "";
  tableQuery = "";
  renderDataTable();
  const row = el("dataBody") && el("dataBody").querySelector('tr[data-index="new"]');
  if (row) {
    row.scrollIntoView({ block: "nearest" });
    const sel = row.querySelector("select");
    if (sel) sel.focus();
  }
}

function initRecords() {
  initI18n();
  applyTableHeaders();
  updateCounts();
  renderDataTable();
  el("addRowBtn").addEventListener("click", beginAddRow);
  el("saveExcelBtn").addEventListener("click", downloadExcel);
  el("excelFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) readExcelFile(file);
    e.target.value = "";
  });
  el("dataFilter").addEventListener("input", () => {
    tableQuery = el("dataFilter").value.trim();
    renderDataTable();
  });
  setupExcelDrop();
  noteDataset();
}

let undoTimer = null;

function hideUndo() {
  const toast = el("undoToast");
  if (toast) toast.classList.remove("show");
  clearTimeout(undoTimer);
}

function showUndo(message, onUndo) {
  let toast = el("undoToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "undoToast";
    toast.className = "undo-toast";
    document.body.appendChild(toast);
  }
  toast.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = message;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ghost-btn tiny";
  btn.textContent = t("hint.undo");
  btn.addEventListener("click", () => {
    hideUndo();
    onUndo();
  });
  toast.appendChild(span);
  toast.appendChild(btn);
  toast.classList.add("show");
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 6000);
}

function snapshotPick() {
  return {
    selected: [...state.selected],
    emotions: { ...state.emotions },
    missWinner,
    compact: state.compact,
    uncertain: [...state.uncertain],
    lineupExpanded
  };
}

function restorePick(snap) {
  state.selected = new Set(snap.selected);
  state.emotions = { ...snap.emotions };
  missWinner = snap.missWinner || "";
  state.compact = !!snap.compact;
  lineupExpanded = !!snap.lineupExpanded;
  state.uncertain = new Set(snap.uncertain || []);
  state.results = null;
  const box = el("results");
  if (box) box.classList.add("hidden");
  renderGrid();
  updateCounter();
  const hint = el("hint");
  if (hint) {
    hint.textContent = t("pick.restored");
    hint.style.color = "";
  }
}

function reset() {
  const prev = snapshotPick();
  const had = prev.selected.length > 0;
  state.selected.clear();
  state.emotions = {};
  state.results = null;
  state.compact = false;
  lineupExpanded = false;
  state.uncertain.clear();
  missWinner = "";
  const box = el("results");
  if (box) box.classList.add("hidden");
  renderGrid();
  updateCounter();
  const hint = el("hint");
  if (hint) {
    hint.textContent = t("pick.cleared");
    hint.style.color = "";
  }
  if (had) showUndo(t("pick.cleared"), () => restorePick(prev));
}

/* ---------- Name settings page ---------- */

function renderNameSettings() {
  const body = el("nameBody");
  if (!body) return;
  body.innerHTML = "";
  CONCH_LIST.forEach((canon) => {
    const names = conchNameSet(canon);
    const tr = document.createElement("tr");
    tr.dataset.conch = canon;

    const label = document.createElement("td");
    label.className = "name-canon";
    label.dataset.nameLabel = canon;
    label.textContent = "🐚 " + conchLabel(canon);
    tr.appendChild(label);

    ["en", "zh-Hant", "zh-Hans"].forEach((code) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.className = "name-input";
      input.dataset.nameLang = code;
      input.value = names[code] || "";
      input.setAttribute("aria-label", `${conchLabel(canon)} — ${code}`);
      input.addEventListener("input", () => {
        if (code !== "zh-Hant" && code !== "zh-Hans") return;
        if (code === lang) label.textContent = "🐚 " + (input.value.trim() || canon);
      });
      td.appendChild(input);
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });
}

function saveNameSettings() {
  const body = el("nameBody");
  if (!body) return;
  const config = {};
  body.querySelectorAll("tr[data-conch]").forEach((tr) => {
    const canon = tr.dataset.conch;
    const names = {};
    tr.querySelectorAll("input[data-name-lang]").forEach((input) => {
      names[input.dataset.nameLang] = input.value.trim();
    });
    config[canon] = names;
  });
  conchNamesStored = config;
  aliasIndexCache = null;
  try { localStorage.setItem(NAMES_KEY, JSON.stringify(config)); } catch (e) { /* ignore */ }
  renderNameSettings();
  const hint = el("namesHint");
  if (hint) hint.textContent = t("settings.saved");
}

function resetNameSettings() {
  conchNamesStored = {};
  aliasIndexCache = null;
  try { localStorage.removeItem(NAMES_KEY); } catch (e) { /* ignore */ }
  renderNameSettings();
  const hint = el("namesHint");
  if (hint) hint.textContent = t("settings.resetDone");
}

function resetMoodIcons() {
  moodIcons = {};
  moodPending = {};
  try { localStorage.removeItem(MOOD_ICONS_KEY); } catch (e) { /* ignore */ }
  const hint = el("moodHint");
  if (hint) hint.textContent = t("settings.moodResetDone");
}

function initSettings() {
  initI18n();
  renderNameSettings();
  const save = el("saveNamesBtn");
  if (save) save.addEventListener("click", saveNameSettings);
  const reset = el("resetNamesBtn");
  if (reset) reset.addEventListener("click", resetNameSettings);
  const resetMood = el("resetMoodBtn");
  if (resetMood) resetMood.addEventListener("click", resetMoodIcons);
}

if (document.body.dataset.page === "records") initRecords();
else if (document.body.dataset.page === "settings") initSettings();
else init();
