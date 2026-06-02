// ===== Phrase Book — vanilla JS, localStorage + Supabase sync =====
const APP_NAMESPACE = (() => {
  const cleanPath = window.location.pathname.replace(/^\/|\/$/g, "");
  return (cleanPath.split("/")[0] || "local").toLowerCase();
})();
const STORAGE_KEY = `phrasebook.v2.${APP_NAMESPACE}`;
const CLOUD_CONFIG_KEY = `phrasebook.cloud.v1.${APP_NAMESPACE}`;
const CLOUD_TABLE = "phrasebook_store";

// ---------- Seed data ----------
const SEED = [
  {
    text: "Thank you for your patience. I'll get back to you within 24 hours.",
    language: "EN", category: "thanks", tags: ["formal", "follow-up"],
    note: "Khi cần thêm thời gian xử lý.", pinned: true,
  },
  {
    text: "Could you please provide more details about the issue?",
    language: "EN", category: "support", tags: ["question"],
    note: "Yêu cầu khách cung cấp thêm thông tin.", pinned: false,
  },
  {
    text: "お忙しいところ恐れ入りますが、ご確認のほどよろしくお願いいたします。",
    language: "JA", category: "request", tags: ["formal", "keigo"],
    note: "Email lịch sự yêu cầu xác nhận.", pinned: true,
  },
  {
    text: "ご不便をおかけして大変申し訳ございません。",
    language: "JA", category: "apology", tags: ["formal"],
    note: "Xin lỗi khi gây bất tiện cho khách.", pinned: false,
  },
  {
    text: "Cảm ơn anh/chị đã liên hệ. Em sẽ kiểm tra và phản hồi ngay ạ.",
    language: "VI", category: "greeting", tags: ["polite"],
    note: "Câu mở đầu trả lời khách.", pinned: false,
  },
  {
    text: "Em xin phép xác nhận lại thông tin với bộ phận liên quan và sẽ phản hồi trong thời gian sớm nhất ạ.",
    language: "VI", category: "support", tags: ["formal"],
    note: "Khi cần thời gian kiểm tra với bộ phận khác.", pinned: false,
  },
];

// ---------- State ----------
let state = {
  phrases: [],
  filter: { lang: "ALL", category: null, pinned: false, query: "" },
};

let cloudConfig = {
  url: "",
  anonKey: "",
  workspaceId: "default",
};

let cloudSaveTimer;

// ---------- Storage ----------
function loadCloudConfig() {
  try {
    const raw = localStorage.getItem(CLOUD_CONFIG_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    cloudConfig.url = (data.url || "").trim();
    cloudConfig.anonKey = (data.anonKey || "").trim();
    cloudConfig.workspaceId = (data.workspaceId || "default").trim() || "default";
  } catch (e) {
    console.error("Load cloud config failed:", e);
  }
}

function saveCloudConfig() {
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cloudConfig));
}

function isCloudReady() {
  return !!(cloudConfig.url && cloudConfig.anonKey && cloudConfig.workspaceId);
}

function cloudEndpoint(path) {
  return `${cloudConfig.url.replace(/\/$/, "")}${path}`;
}

function cloudHeaders(extra = {}) {
  return {
    apikey: cloudConfig.anonKey,
    Authorization: `Bearer ${cloudConfig.anonKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state.phrases = SEED.map(makePhrase);
      saveLocalState();
      return;
    }
    const data = JSON.parse(raw);
    state.phrases = Array.isArray(data.phrases) ? data.phrases : [];
  } catch (e) {
    console.error("Load state failed:", e);
    state.phrases = SEED.map(makePhrase);
  }
}

function saveLocalState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, phrases: state.phrases })
  );
}

async function pullCloudPhrases() {
  const id = encodeURIComponent(cloudConfig.workspaceId);
  const url = cloudEndpoint(`/rest/v1/${CLOUD_TABLE}?id=eq.${id}&select=payload&limit=1`);
  const res = await fetch(url, { headers: cloudHeaders() });
  if (!res.ok) throw new Error(`Cloud pull failed (${res.status})`);
  const rows = await res.json();
  const payload = rows?.[0]?.payload;
  return Array.isArray(payload?.phrases) ? payload.phrases : null;
}

async function pushCloudPhrases(phrases) {
  const url = cloudEndpoint(`/rest/v1/${CLOUD_TABLE}?on_conflict=id`);
  const body = [{
    id: cloudConfig.workspaceId,
    payload: { version: 1, phrases },
  }];
  const res = await fetch(url, {
    method: "POST",
    headers: cloudHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Cloud push failed (${res.status})`);
}

function mergePhrases(localList, remoteList) {
  const map = new Map();
  for (const p of localList || []) {
    if (!p?.id) continue;
    map.set(p.id, p);
  }
  for (const p of remoteList || []) {
    if (!p?.id) continue;
    const old = map.get(p.id);
    if (!old) {
      map.set(p.id, p);
      continue;
    }
    const oldTs = Number(old.updatedAt || old.createdAt || 0);
    const newTs = Number(p.updatedAt || p.createdAt || 0);
    if (newTs >= oldTs) map.set(p.id, p);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
  });
}

async function loadState() {
  loadCloudConfig();
  loadLocalState();
  if (!isCloudReady()) return;
  try {
    const remote = await pullCloudPhrases();
    if (!remote) {
      await pushCloudPhrases(state.phrases);
      return;
    }
    state.phrases = mergePhrases(state.phrases, remote);
    saveLocalState();
    await pushCloudPhrases(state.phrases);
  } catch (e) {
    console.error(e);
    toast("Cloud chưa sẵn sàng, đang dùng dữ liệu local");
  }
}

function scheduleCloudSave() {
  if (!isCloudReady()) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(async () => {
    try {
      await pushCloudPhrases(state.phrases);
      renderCloudStatus();
    } catch (e) {
      console.error(e);
      renderCloudStatus("Loi sync", true);
    }
  }, 500);
}

function saveState() {
  saveLocalState();
  scheduleCloudSave();
}

// ---------- Helpers ----------
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function makePhrase(p) {
  const now = Date.now();
  return {
    id: uid(),
    text: p.text || "",
    language: p.language || "EN",
    category: (p.category || "general").trim().toLowerCase(),
    tags: p.tags || [],
    note: p.note || "",
    pinned: !!p.pinned,
    createdAt: now,
    updatedAt: now,
  };
}
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// ---------- Filtering ----------
function filterPhrases() {
  const { lang, category, pinned, query } = state.filter;
  const q = query.trim().toLowerCase();
  return state.phrases.filter((p) => {
    if (lang !== "ALL" && p.language !== lang) return false;
    if (category && p.category !== category) return false;
    if (pinned && !p.pinned) return false;
    if (q) {
      const hay = (p.text + " " + p.note + " " + p.tags.join(" ") + " " + p.category).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

// ---------- DOM refs ----------
const $ = (id) => document.getElementById(id);
const grid = $("phraseGrid");
const emptyState = $("emptyState");
const searchInput = $("searchInput");
const categoryList = $("categoryList");
const langFilters = $("langFilters");
const resultMeta = $("resultMeta");
const modalBackdrop = $("modalBackdrop");
const phraseForm = $("phraseForm");
const modalTitle = $("modalTitle");
const sidebar = $("sidebar");
const cloudStatus = $("cloudStatus");

// ---------- Render ----------
function render() {
  renderSidebarCategories();
  renderCounts();
  renderGrid();
  syncActiveFilters();
  renderCloudStatus();
}

function renderCloudStatus(note = "", isError = false) {
  if (!cloudStatus) return;
  if (!isCloudReady()) {
    cloudStatus.textContent = "Cloud: chua cau hinh";
    cloudStatus.style.color = "var(--text-muted)";
    return;
  }
  cloudStatus.textContent = note ? `Cloud: ${note}` : `Cloud: ${cloudConfig.workspaceId}`;
  cloudStatus.style.color = isError ? "var(--danger)" : "var(--text-muted)";
}

function renderSidebarCategories() {
  const counts = {};
  for (const p of state.phrases) counts[p.category] = (counts[p.category] || 0) + 1;
  const cats = Object.keys(counts).sort();
  categoryList.innerHTML = cats
    .map(
      (c) => `<li><button class="cat-item" data-cat="${escapeHtml(c)}">
        <span>${escapeHtml(c)}</span>
        <span class="count">${counts[c]}</span>
      </button></li>`
    )
    .join("");

  // datalist for form
  const dl = $("categoryOptions");
  dl.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">`).join("");
}

function renderCounts() {
  $("countAll").textContent = state.phrases.length;
  $("countPinned").textContent = state.phrases.filter((p) => p.pinned).length;
}

function renderGrid() {
  const list = filterPhrases();
  resultMeta.textContent = `${list.length} câu` +
    (state.filter.query ? ` · từ khóa "${state.filter.query}"` : "") +
    (state.filter.category ? ` · danh mục: ${state.filter.category}` : "") +
    (state.filter.pinned ? " · đã ghim" : "") +
    (state.filter.lang !== "ALL" ? ` · ${state.filter.lang}` : "");

  if (list.length === 0) {
    grid.innerHTML = "";
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  grid.innerHTML = list.map(cardHTML).join("");
}

function cardHTML(p) {
  const tags = p.tags.length
    ? `<div class="card-tags">${p.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join("")}</div>`
    : "";
  const note = p.note
    ? `<div class="card-note">${escapeHtml(p.note)}</div>`
    : "";
  return `
    <article class="card ${p.pinned ? "pinned" : ""}" data-id="${p.id}">
      <button class="copy-fab" data-act="copy" title="Copy nội dung câu này" aria-label="Copy nội dung câu này">📋</button>
      <div class="card-badges">
        <span class="badge badge-lang ${p.language}">${p.language}</span>
        <span class="badge badge-cat">${escapeHtml(p.category)}</span>
      </div>
      <p class="card-text">${escapeHtml(p.text)}</p>
      ${note}
      ${tags}
      <div class="card-actions">
        <button class="action-btn" data-act="pin" title="Ghim/Bỏ ghim">${p.pinned ? "📌 Bỏ ghim" : "📍 Ghim"}</button>
        <button class="action-btn" data-act="edit" title="Sửa">✏️ Sửa</button>
        <button class="action-btn delete" data-act="delete" title="Xóa">🗑 Xóa</button>
      </div>
    </article>`;
}

function syncActiveFilters() {
  // language
  for (const btn of langFilters.querySelectorAll(".chip")) {
    btn.classList.toggle("active", btn.dataset.lang === state.filter.lang);
  }
  // category / special
  for (const btn of document.querySelectorAll(".cat-item")) {
    const sp = btn.dataset.special;
    const cat = btn.dataset.cat;
    let active = false;
    if (sp === "all") active = !state.filter.category && !state.filter.pinned;
    else if (sp === "pinned") active = state.filter.pinned;
    else if (cat) active = state.filter.category === cat;
    btn.classList.toggle("active", active);
  }
}

// ---------- Mutations ----------
function addPhrase(data) {
  state.phrases.unshift(makePhrase(data));
  saveState(); render();
  toast("Đã thêm câu mới");
}
function updatePhrase(id, data) {
  const p = state.phrases.find((x) => x.id === id);
  if (!p) return;
  Object.assign(p, {
    text: data.text,
    language: data.language,
    category: (data.category || "general").trim().toLowerCase(),
    tags: data.tags,
    note: data.note,
    updatedAt: Date.now(),
  });
  saveState(); render();
  toast("Đã cập nhật");
}
function removePhrase(id) {
  const p = state.phrases.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`Xóa câu này?\n\n"${p.text.slice(0, 80)}${p.text.length > 80 ? "..." : ""}"`)) return;
  state.phrases = state.phrases.filter((x) => x.id !== id);
  saveState(); render();
  toast("Đã xóa");
}
function togglePin(id) {
  const p = state.phrases.find((x) => x.id === id);
  if (!p) return;
  p.pinned = !p.pinned;
  p.updatedAt = Date.now();
  saveState(); render();
}
async function copyPhrase(id) {
  const p = state.phrases.find((x) => x.id === id);
  if (!p) return;
  try {
    await navigator.clipboard.writeText(p.text);
    toast("Đã copy vào clipboard ✓");
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = p.text;
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    toast("Đã copy ✓");
  }
}

// ---------- Modal ----------
function openModal(phrase) {
  modalBackdrop.hidden = false;
  modalTitle.textContent = phrase ? "Sửa câu" : "Thêm câu mới";
  $("fId").value = phrase?.id || "";
  $("fText").value = phrase?.text || "";
  $("fLang").value = phrase?.language || "EN";
  $("fCategory").value = phrase?.category || "";
  $("fTags").value = (phrase?.tags || []).join(", ");
  $("fNote").value = phrase?.note || "";
  setTimeout(() => $("fText").focus(), 50);
}
function closeModal() {
  modalBackdrop.hidden = true;
  phraseForm.reset();
}

phraseForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {
    text: $("fText").value.trim(),
    language: $("fLang").value,
    category: $("fCategory").value.trim() || "general",
    tags: $("fTags").value.split(",").map((t) => t.trim()).filter(Boolean),
    note: $("fNote").value.trim(),
  };
  if (!data.text) return;
  const id = $("fId").value;
  if (id) updatePhrase(id, data);
  else addPhrase(data);
  closeModal();
});

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => (el.hidden = true), 200);
  }, 1800);
}

// ---------- Event wiring ----------
$("addBtn").addEventListener("click", () => openModal(null));
$("closeModalBtn").addEventListener("click", closeModal);
$("cancelBtn").addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});

// search debounce
let searchTimer;
searchInput.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => {
    state.filter.query = v;
    renderGrid();
  }, 120);
});

// language chips
langFilters.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  state.filter.lang = btn.dataset.lang;
  render();
});

// sidebar category & specials (delegate)
sidebar.addEventListener("click", (e) => {
  const btn = e.target.closest(".cat-item");
  if (!btn) return;
  const sp = btn.dataset.special;
  const cat = btn.dataset.cat;
  if (sp === "all") { state.filter.category = null; state.filter.pinned = false; }
  else if (sp === "pinned") { state.filter.category = null; state.filter.pinned = true; }
  else if (cat) { state.filter.category = cat; state.filter.pinned = false; }
  if (window.matchMedia("(max-width: 768px)").matches) sidebar.classList.remove("open");
  render();
});

// card actions (delegate)
grid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const card = e.target.closest(".card");
  const id = card?.dataset.id;
  if (!id) return;
  const act = btn.dataset.act;
  if (act === "copy") copyPhrase(id);
  else if (act === "pin") togglePin(id);
  else if (act === "edit") openModal(state.phrases.find((p) => p.id === id));
  else if (act === "delete") removePhrase(id);
});

// keyboard shortcuts
document.addEventListener("keydown", (e) => {
  const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if (e.key === "Escape") {
    if (!modalBackdrop.hidden) closeModal();
  } else if (e.key === "/" && !inField) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  } else if (e.key === "n" && !inField && modalBackdrop.hidden) {
    e.preventDefault();
    openModal(null);
  }
});

// mobile sidebar toggle
$("openSidebarBtn").addEventListener("click", () => sidebar.classList.add("open"));
$("closeSidebarBtn").addEventListener("click", () => sidebar.classList.remove("open"));

// import / export
$("exportBtn").addEventListener("click", () => {
  const blob = new Blob(
    [JSON.stringify({ version: 1, phrases: state.phrases }, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `phrasebook-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Đã xuất file JSON");
});
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : data.phrases;
    if (!Array.isArray(incoming)) throw new Error("Định dạng không hợp lệ");
    if (!confirm(`Nhập ${incoming.length} câu? (Sẽ gộp với dữ liệu hiện tại)`)) return;
    const existingIds = new Set(state.phrases.map((p) => p.id));
    for (const p of incoming) {
      const newP = makePhrase(p);
      if (p.id && !existingIds.has(p.id)) newP.id = p.id;
      state.phrases.push(newP);
    }
    saveState(); render();
    toast(`Đã nhập ${incoming.length} câu`);
  } catch (err) {
    alert("Lỗi nhập file: " + err.message);
  } finally {
    e.target.value = "";
  }
});

$("cloudSetupBtn").addEventListener("click", () => {
  const url = prompt("Supabase URL (vd: https://xxxx.supabase.co)", cloudConfig.url || "");
  if (url === null) return;
  const anonKey = prompt("Supabase Anon Key", cloudConfig.anonKey || "");
  if (anonKey === null) return;
  const workspaceId = prompt("Workspace ID de dong bo nhieu may", cloudConfig.workspaceId || "default");
  if (workspaceId === null) return;

  cloudConfig.url = url.trim();
  cloudConfig.anonKey = anonKey.trim();
  cloudConfig.workspaceId = workspaceId.trim() || "default";
  saveCloudConfig();
  renderCloudStatus("da cau hinh");
  toast("Da luu cau hinh cloud");
});

$("cloudSyncBtn").addEventListener("click", async () => {
  if (!isCloudReady()) {
    toast("Ban can Setup cloud truoc");
    return;
  }
  try {
    renderCloudStatus("dang sync...");
    const remote = await pullCloudPhrases();
    if (!remote) {
      await pushCloudPhrases(state.phrases);
      renderCloudStatus("da sync");
      toast("Da dong bo cloud");
      return;
    }
    state.phrases = mergePhrases(state.phrases, remote);
    saveLocalState();
    await pushCloudPhrases(state.phrases);
    render();
    renderCloudStatus("da sync");
    toast("Da dong bo cloud");
  } catch (err) {
    console.error(err);
    renderCloudStatus("loi sync", true);
    alert("Sync cloud that bai. Kiem tra URL/Key hoac bang Supabase.");
  }
});

// ---------- Init ----------
(async function init() {
  await loadState();
  render();
})();
