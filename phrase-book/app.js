// ===== Phrase Book — vanilla JS, localStorage =====
const STORAGE_KEY = "phrasebook.v1";

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

// ---------- Storage ----------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state.phrases = SEED.map(makePhrase);
      saveState();
      return;
    }
    const data = JSON.parse(raw);
    state.phrases = Array.isArray(data.phrases) ? data.phrases : [];
  } catch (e) {
    console.error("Load state failed:", e);
    state.phrases = SEED.map(makePhrase);
  }
}
function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, phrases: state.phrases })
  );
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

// ---------- Render ----------
function render() {
  renderSidebarCategories();
  renderCounts();
  renderGrid();
  syncActiveFilters();
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

// ---------- Init ----------
loadState();
render();
