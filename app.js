const MAX_CONCH = 6;
const CONCH_LIST = ["卡爾", "逮蝦", "螺神", "螺寶", "啵塞咚", "礦工", "爆螺", "拖拉機", "船長"];
const EMOTIONS = ["呆", "黑", "怒", "墨", "笑"];
const WIN_KEYS = ["贏的螺", "赢的螺", "winner", "Winner", "WINNER"];
const WINNER_ALIAS = { "螺保": "螺寶" };
const EXCEL_HEADER = CONCH_LIST.concat(["赢的螺"]);
const EXTRA_KEY = "conchExtraRecords_v1";
const BASE_KEY = "conchBaseRecords_v1";
const BASE_NAME_KEY = "conchBaseName_v1";

const state = {
  selected: new Set(),
  emotions: {},
  results: null,
  compact: false,
  uncertain: new Set()
};

const el = (id) => document.getElementById(id);

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
  if (extraCount) extraCount.textContent = `${extraRecords.length} 筆`;
  const summary = el("extraSummaryCount");
  if (summary) summary.textContent = String(extraRecords.length);
  const wrap = el("extraWrap");
  if (wrap) wrap.classList.toggle("hidden", extraRecords.length === 0);
  updateSourceLabel();
  updateUnsaved();
}

function updateUnsaved() {
  const n = extraRecords.length;
  const text = `尚有 ${n} 筆未寫入 Excel`;
  document.querySelectorAll("[data-unsaved-text]").forEach((node) => {
    node.textContent = text;
  });
  document.querySelectorAll("[data-unsaved]").forEach((node) => {
    node.classList.toggle("hidden", n === 0);
  });
}

function updateSourceLabel() {
  const name = baseName || (baseRecords.length ? "瀏覽器暫存" : "");
  const pill = el("fileName");
  const foot = el("footSource");
  if (pill) pill.textContent = name || "尚未載入";
  if (foot) foot.textContent = name || "尚未載入 Excel";
}

function init() {
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
  setOcrStatus("載入辨識引擎…", 0);
  ocrWorker = await Tesseract.createWorker("chi_tra+chi_sim+eng", 1, {
    workerPath: base + "worker.min.js",
    langPath: base + "tessdata",
    corePath: base,
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === "loading tesseract core") setOcrStatus("載入辨識核心…", m.progress);
      else if (m.status === "loading language traineddata") setOcrStatus("載入語言模型…", m.progress);
      else if (m.status === "initializing api") setOcrStatus("初始化…", m.progress);
      else if (m.status === "recognizing text") setOcrStatus("辨識文字中…", m.progress);
    }
  });
  return ocrWorker;
}

function loadImageEl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { resolve({ img: im, url }); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("圖片讀取失敗")); };
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
  const t = (text || "").replace(/\s/g, "");
  let best = null, bestScore = 0;
  for (const c of CONCH_LIST) {
    if (t.includes(c)) return { name: c, score: 1 };
    const chars = [...c];
    const hit = chars.filter((ch) => t.includes(ch)).length;
    const score = hit / chars.length;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return { name: bestScore >= 0.5 ? best : null, score: bestScore };
}

function bestEmotion(text) {
  const t = (text || "").replace(/\s/g, "");
  let best = null, bestN = 0;
  for (const em of EMOTIONS) {
    const n = t.split(em).length - 1;
    if (n > bestN) { bestN = n; best = em; }
  }
  return { emotion: best, count: bestN };
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
  setOcrStatus("讀取圖片…", 0);

  let img;
  try {
    const loaded = await loadImageEl(file);
    img = loaded.img;
    el("shotPreview").src = loaded.url;
    el("shotPreviewWrap").classList.remove("hidden");
  } catch (e) {
    setOcrStatus("無法讀取圖片。", 1);
    ocrBusy = false;
    return;
  }

  try {
    setOcrStatus("① 偵測螺的選項框…", 0.05);
    const cv = (await loadOpenCV()).cv;
    const src = cv.imread(img);
    const boxes = detectBoxes(cv, src);
    src.delete();
    drawOverlay(boxes);

    if (!boxes.length) {
      setOcrStatus("① 找不到螺的選項框，請改用更清晰的截圖或手動選擇。", 1);
      ocrBusy = false;
      return;
    }
    setOcrStatus(`① 偵測到 ${boxes.length} 個選項框`, 0.15);

    const worker = await getOcrWorker();
    const pairs = [];
    const logLines = [];

    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];

      const nameCanvas = cropRegion(img, b, 0.0, 0.5, 3).canvas;
      const nd = await worker.recognize(nameCanvas);
      const nameText = (nd.data.text || "").trim();
      const name = bestConch(nameText);

      const emCanvas = cropRegion(img, b, 0.5, 1.0, 3).canvas;
      const ed = await worker.recognize(emCanvas);
      const emText = (ed.data.text || "").trim();
      const em = bestEmotion(emText);

      logLines.push(`#${i + 1}  ② 名稱「${nameText.replace(/\s+/g, "")}」→ ${name.name || "?"}（${Math.round((name.score || 0) * 100)}%）  ③ 心情「${emText.replace(/\s+/g, "")}」→ ${em.emotion || "?"}`);
      if (name.name) {
        pairs.push({
          conch: name.name,
          emotion: em.emotion || "",
          uncertain: !em.emotion || (name.score || 0) < 1,
          box: i + 1
        });
      }

      setOcrStatus(`① 框 ${i + 1}/${boxes.length}  ② 名稱：${name.name || "?"}  ③ 心情：${em.emotion || "?"}`, 0.15 + 0.85 * ((i + 1) / boxes.length));
    }

    el("ocrText").textContent = logLines.join("\n");
    el("ocrTextWrap").classList.remove("hidden");

    const withEmotion = pairs.filter((p) => p.emotion);
    if (pairs.length) applyDetected(pairs);
    setOcrStatus(`完成：偵測 ${boxes.length} 框、辨識 ${pairs.length} 名稱、${withEmotion.length} 心情。已自動填入可辨識的部分，請確認後再比對。`, 1);
  } catch (err) {
    console.error(err);
    setOcrStatus("辨識失敗：" + (err && err.message ? err.message : err), 1);
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
  for (const c of CONCH_LIST) if (text.includes(c)) return c;
  return null;
}

function emotionTokens(word) {
  const tokens = [];
  const chars = [...word.text];
  const charsIn = chars.filter((ch) => EMOTIONS.includes(ch));
  if (!charsIn.length) return tokens;
  const b = word.bbox;
  const w = (b.x1 - b.x0) / Math.max(chars.length, 1);
  chars.forEach((ch, i) => {
    if (EMOTIONS.includes(ch)) {
      const cx = b.x0 + w * (i + 0.5);
      tokens.push({ em: ch, cx, cy: (b.y0 + b.y1) / 2, conf: word.conf });
    }
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
  const preview = el("shotPreviewWrap");
  if (preview) preview.classList.add("is-small");
  renderGrid();
  updateCounter();
  const submit = el("submitBtn");
  if (submit && submit.scrollIntoView) submit.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearShot() {
  el("shotPreview").removeAttribute("src");
  el("shotPreviewWrap").classList.add("hidden");
  el("shotPreviewWrap").classList.remove("is-small");
  el("ocrBar").classList.add("hidden");
  el("ocrTextWrap").classList.add("hidden");
  el("clearShotBtn").classList.add("hidden");
  el("shotInput").value = "";
  const dz = el("dropzone");
  if (dz) dz.classList.remove("collapsed");
  state.compact = false;
  lineupExpanded = false;
  state.uncertain.clear();
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
          flashAdd(`最多只能選 ${MAX_CONCH} 隻螺。`);
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
    label.insertAdjacentHTML("beforeend", `<span>🐚 ${name}</span>`);
    card.appendChild(label);

    const sel = document.createElement("select");
    sel.className = "emotion-select";
    sel.innerHTML = `<option value="">心情…</option>` +
      EMOTIONS.map((e) => `<option value="${e}">${e}</option>`).join("");
    sel.value = addState.emotions[name] || "";
    sel.disabled = !addState.selected.has(name);
    sel.addEventListener("change", () => { addState.emotions[name] = sel.value; updateAddHint(); });
    card.appendChild(sel);

    wrap.appendChild(card);
  });

  const win = document.createElement("div");
  win.className = "add-winner";
  win.innerHTML = `<span>贏的螺</span>`;
  const ws = document.createElement("select");
  ws.innerHTML = `<option value="">請選擇…</option>` +
    [...addState.selected].map((n) => `<option value="${n}">${n}</option>`).join("");
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
  if (n < MAX_CONCH) hint.textContent = `已選 ${n}/${MAX_CONCH}，還需要 ${MAX_CONCH - n} 隻。`;
  else if (missing.length) hint.textContent = `請設定 ${missing.join("、")} 的心情。`;
  else if (!addState.winner) hint.textContent = addFromMatch
    ? "沒有完全符合的紀錄。已填入這 6 隻螺，請選擇贏的螺。"
    : "請選擇贏的螺。";
  else hint.textContent = "可以新增！";
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
  if (record) setDataHint(`已加入 1 筆（贏：${rec.winner}）。下載 Excel 時會寫入這筆。`);
  if (!record) {
    addFromMatch = false;
    addState.selected.clear();
    addState.emotions = {};
    addState.winner = "";
    const panel = document.querySelector(".manage-panel");
    if (panel) panel.classList.remove("prefilled");
    renderAddForm();
    flashAdd("已新增 1 筆紀錄，並納入比對。");
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
      return `<span class="${cls}">${name}<span class="em">${em}</span></span>`;
    }).join("");
    card.innerHTML = `
      <div class="record-top">
        <span class="record-index">新增 #${i + 1}</span>
        <span class="winner-badge">贏的螺 ${rec.winner || "-"}</span>
        <button class="record-del" type="button">刪除</button>
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
  if (typeof XLSX === "undefined") throw new Error("Excel 元件尚未載入");
  let bytes = data;
  let type = "array";
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(data)) type = "buffer";
  const wb = XLSX.read(bytes, { type });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("找不到工作表");
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: "" });

  let headerIdx = -1;
  let cols = null;
  const scan = Math.min(rows.length, 20);
  for (let i = 0; i < scan; i++) {
    const cells = (rows[i] || []).map(normCell);
    const hits = CONCH_LIST.filter((name) => cells.includes(name)).length;
    const hasWin = cells.some((c) => WIN_KEYS.includes(c));
    if (hits >= 3 || hasWin) { headerIdx = i; cols = cells; break; }
  }

  const conchCol = {};
  let winIdx = -1;
  let start = 0;
  if (cols) {
    CONCH_LIST.forEach((name) => {
      const idx = cols.indexOf(name);
      if (idx >= 0) conchCol[name] = idx;
    });
    winIdx = cols.findIndex((c) => WIN_KEYS.includes(c));
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
    let winner = winIdx >= 0 ? (cells[winIdx] || "") : "";
    if (WINNER_ALIAS[winner]) { winner = WINNER_ALIAS[winner]; normalized++; }
    if (Object.keys(conch).length && CONCH_LIST.includes(winner)) records.push({ conch, winner });
    else skipped++;
  }
  return { records, skipped, normalized };
}

function applyLoadedRecords(parsed, filename) {
  const { records, skipped, normalized } = parsed;
  if (!records.length) {
    setDataHint("這份 Excel 沒有可讀的對局。請確認第一列是螺的名字，最後一欄是赢的螺。");
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
  const bits = [`已從「${baseName}」讀入 ${records.length} 筆。`];
  if (skipped) bits.push(`略過 ${skipped} 列。`);
  if (normalized) bits.push(`已把 ${normalized} 個「螺保」改為「螺寶」。`);
  if (extraRecords.length) bits.push(`瀏覽器另有 ${extraRecords.length} 筆新增，下載時會一併寫入。`);
  else bits.push("按「下載 Excel」可把目前紀錄寫成檔案。");
  setDataHint(bits.join(""));
}

function readExcelFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try { applyLoadedRecords(parseWorkbook(reader.result), file.name); }
    catch (err) { setDataHint("無法讀取 Excel：" + (err && err.message ? err.message : err)); }
  };
  reader.onerror = () => setDataHint("讀取檔案失敗。");
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
    if (!/\.xlsx?$/i.test(file.name)) { setDataHint("請放下 .xlsx 或 .xls 檔。"); return; }
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
  const raw = (baseName || "賭螺紀錄").replace(/[\\/:*?"<>|]/g, "_");
  if (/\.xlsx$/i.test(raw)) return raw;
  return raw.replace(/\.xls$/i, "") + ".xlsx";
}

function downloadExcel() {
  const records = allRecords();
  if (!records.length) { setDataHint("沒有可寫入的紀錄。請到「全部紀錄」開啟 Excel，或先新增一筆。"); return; }
  if (typeof XLSX === "undefined") { setDataHint("Excel 元件尚未載入。"); return; }
  const name = excelDownloadName();
  const folded = extraRecords.length;
  try {
    XLSX.writeFile(workbookFromRecords(records), name);
  } catch (e) {
    setDataHint("下載失敗：" + (e && e.message ? e.message : e));
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
    ? `已下載「${name}」，共 ${records.length} 筆。這 ${folded} 筆已併入瀏覽器暫存。`
    : `已下載「${name}」，共 ${records.length} 筆。`);
}

function noteDataset() {
  if (!allRecords().length) {
    setDataHint(document.body.dataset.page === "records"
      ? "尚未載入紀錄。請按「開啟 Excel」選擇試算表，或按「新增一列」。"
      : "尚未載入紀錄。到「全部紀錄」開啟 Excel 後即可比對。");
    return;
  }
  const name = baseName ? `（${baseName}）` : "";
  if (document.body.dataset.page === "records") {
    setDataHint(`已載入 ${allRecords().length} 筆${name}。改儲存格會立即儲存，下載 Excel 時寫入。`);
  } else {
    setDataHint(`已還原此瀏覽器的 ${allRecords().length} 筆${name}。可到「全部紀錄」再開啟 Excel 取代。`);
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
    const unsure = state.uncertain.has(name) ? `<span class="uncertain-tag">請確認</span>` : "";
    top.innerHTML = `<span class="conch-name">🐚 ${name}${unsure}</span><span class="conch-toggle">✓</span>`;
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
      btn.textContent = em;
      if (state.emotions[name] === em) btn.classList.add("active");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!state.selected.has(name)) toggleConch(name, true);
        state.emotions[name] = em;
        state.uncertain.delete(name);
        renderGrid();
        updateCounter();
        refreshResults();
      });
      row.appendChild(btn);
    });
    card.appendChild(row);

    grid.appendChild(card);
  });
  const showAll = el("showAllBtn");
  if (showAll) showAll.classList.toggle("hidden", !(state.compact && state.selected.size > 0));
  refreshResults();
}

function toggleConch(name, forceSelect) {
  if (state.selected.has(name) && !forceSelect) {
    state.selected.delete(name);
    delete state.emotions[name];
    state.uncertain.delete(name);
  } else if (!state.selected.has(name)) {
    if (state.selected.size >= MAX_CONCH) {
      flashHint(`最多只能選 ${MAX_CONCH} 隻螺，請先取消一隻。`);
      return;
    }
    state.selected.add(name);
  }
  renderGrid();
  updateCounter();
}

function updateCounter() {
  const n = state.selected.size;
  el("counter").innerHTML = `已選 <strong>${n}</strong> / ${MAX_CONCH}`;

  const ready = n === MAX_CONCH && CONCH_LIST.every((c) => !state.selected.has(c) || state.emotions[c]);
  el("submitBtn").disabled = !ready;

  if (n < MAX_CONCH) {
    el("hint").textContent = `還需要再選 ${MAX_CONCH - n} 隻螺。`;
  } else if (!ready) {
    const missing = [...state.selected].filter((c) => !state.emotions[c]);
    el("hint").textContent = `請為 ${missing.join("、")} 選擇心情。`;
  } else {
    el("hint").textContent = "完成！按「開始比對」尋找歷史紀錄。";
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

function renderResults() {
  if (!state.results) return;
  el("results").classList.remove("hidden");
  const { input, exact, closest, ranked, best, groupSize } = state.results;

  const banner = el("matchBanner");
  if (exact.length) {
    banner.className = "match-banner exact";
    banner.textContent = `找到 ${exact.length} 筆完全符合的歷史紀錄！`;
  } else {
    banner.className = "match-banner none";
    const pct = Math.round((Math.floor(best / 100) / MAX_CONCH) * 100);
    banner.textContent = `沒有完全符合的紀錄，以下顯示最接近的結果（最高相似度 ${pct}%）。`;
  }

  const pred = el("predictionCard");
  if (ranked.length) {
    pred.classList.remove("hidden");
    const [winner, count] = ranked[0];
    const label = exact.length ? "完全符合紀錄中的最常勝出螺" : "最接近紀錄中的最常勝出螺";
    const chips = ranked.map(([w, c]) => {
      const pct = Math.round((c / groupSize) * 100);
      return `<span class="dist-chip">${w} <strong>${c}</strong> · ${pct}%</span>`;
    }).join("");
    pred.innerHTML = `<h3>${label}</h3><div class="prediction-main"><span class="prediction-winner">${winner} · ${groupSize} 筆裡 ${count} 次</span></div><div class="distribution">${chips}</div>`;
  } else {
    pred.classList.add("hidden");
  }

  el("exactCount").textContent = `${exact.length} 筆`;
  el("closeCount").textContent = `${closest.length} 筆`;
  renderList(el("exactList"), exact, input, true);
  renderList(el("closeList"), closest, input, false);
  renderMissSave(exact.length === 0);
  if (exact.length === 0 && el("addForm")) prefillAddFromPick();
  const scrollTarget = pred && !pred.classList.contains("hidden") ? pred : el("results");
  if (scrollTarget && scrollTarget.scrollIntoView) {
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
    btn.innerHTML = `<span>${name}</span><span class="em">${state.emotions[name] || ""}</span>`;
    btn.addEventListener("click", () => {
      missWinner = name;
      renderMissSave(true);
    });
    picks.appendChild(btn);
  });
  el("missSaveBtn").disabled = !missWinner;
  el("missHint").textContent = missWinner ? `將記錄「${missWinner}」勝出。` : "請點選贏的螺。";
}

function saveMissRecord() {
  if (!missWinner || state.selected.size !== MAX_CONCH) return;
  if ([...state.selected].some((name) => !state.emotions[name])) return;
  const rec = currentPickRecord(missWinner);
  if (allRecords().some((r) => sameRecord(r, rec))) {
    el("missHint").textContent = "這筆紀錄已經在資料裡。";
    return;
  }
  addRecord(rec);
  runMatch();
}

function renderList(container, items, input, isExact) {
  if (!items.length) {
    container.innerHTML = `<div class="empty">${isExact ? "沒有完全符合的紀錄。" : "沒有可比較的紀錄。"}</div>`;
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
    return `<span class="${cls}">${name}<span class="em">${em}</span></span>`;
  }).join("");

  return `
    <div class="record">
      <div class="record-top">
        <span class="record-index">#${index + 1}${isExtra ? ' <span class="added-badge">新增</span>' : ""}</span>
        <span class="sim-label">相符 ${matched}/${MAX_CONCH}（${pct}%）</span>
        <div class="simbar"><span style="width:${pct}%"></span></div>
        <span class="winner-badge">赢的螺 ${record.winner || "-"}</span>
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
  return CONCH_LIST.map((name) => name + (conch[name] || "")).concat(rec && rec.winner || "").join(" ");
}

function fillSelect(sel, values, current, blankLabel) {
  if (blankLabel != null) {
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = blankLabel;
    sel.appendChild(blank);
  }
  values.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
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
  const q = tableQuery.trim();
  body.innerHTML = "";
  let shown = 0;

  const paint = (index, rec, isNew) => {
    const tr = document.createElement("tr");
    tr.dataset.index = isNew ? "new" : String(index);
    if (isNew) tr.classList.add("editing");
    if (!isNew && index >= baseRecords.length) tr.classList.add("extra-row");

    const num = document.createElement("td");
    num.textContent = isNew ? "新" : String(index + 1);
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
      fillSelect(sel, EMOTIONS, (rec.conch && rec.conch[name]) || "", "—");
      addCell(sel);
    });

    const wsel = document.createElement("select");
    wsel.dataset.field = "winner";
    fillSelect(wsel, CONCH_LIST, rec.winner || "", "請選擇");
    addCell(wsel);

    const actions = document.createElement("td");
    actions.className = "row-actions";
    actions.appendChild(actionBtn("刪除", "record-del", () => {
      if (tr.dataset.index === "new") discardNewRow();
      else deleteTableRow(Number(tr.dataset.index));
    }));
    tr.appendChild(actions);
    body.appendChild(tr);
    shown++;
  };

  records.forEach((rec, index) => {
    if (q && !rowSearchText(rec).includes(q)) return;
    paint(index, rec, false);
  });
  if (tableEdit && tableEdit.isNew) {
    paint(records.length, tableEdit.draft || { conch: {}, winner: "" }, true);
  }

  const empty = el("dataEmpty");
  if (empty) {
    empty.textContent = records.length ? "沒有符合的紀錄。" : "尚未載入紀錄。請開啟 Excel，或新增一列。";
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
      setDataHint("請至少填一個心情，並選擇贏的螺。填完後會自動加入。");
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
    setDataHint(`已新增第 ${meta.index + 1} 列。下載 Excel 時會寫入。`);
    tr.scrollIntoView({ block: "nearest" });
    return;
  }
  if (!valid) {
    sel.value = sel.dataset.prev || "";
    setDataHint("請至少填一個心情，並選擇贏的螺。");
    return;
  }
  writeRecordAt(meta.index, rec);
  tr.querySelectorAll("select").forEach((node) => { node.dataset.prev = node.value; });
  updateCounts();
  setDataHint(`已儲存第 ${meta.index + 1} 列。下載 Excel 時會寫入。`);
}

function discardNewRow() {
  const row = el("dataBody") && el("dataBody").querySelector('tr[data-index="new"]');
  const draft = row ? readDraft(row) : (tableEdit && tableEdit.draft) || { conch: {}, winner: "" };
  const had = Object.keys(draft.conch).length > 0 || !!draft.winner;
  tableEdit = null;
  renderDataTable();
  setDataHint("已取消新增。");
  if (had) {
    showUndo("已取消新增。", () => {
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
  const label = `第 ${index + 1} 列（贏：${rec.winner}）`;
  if (!window.confirm(`刪除${label}？`)) return;
  const snapshot = JSON.parse(JSON.stringify(rec));
  const wasExtra = index >= baseRecords.length;
  const localIndex = wasExtra ? index - baseRecords.length : index;
  removeRecordAt(index);
  updateCounts();
  renderDataTable();
  setDataHint(`已刪除${label}。下載 Excel 時不會再寫入。`);
  showUndo(`已刪除${label}。`, () => {
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
    setDataHint(`已復原${label}。`);
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
  btn.textContent = "復原";
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
    hint.textContent = "已復原選擇。";
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
    hint.textContent = "已清空選擇。";
    hint.style.color = "";
  }
  if (had) showUndo("已清空選擇。", () => restorePick(prev));
}

if (document.body.dataset.page === "records") initRecords();
else init();
