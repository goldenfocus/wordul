import { addWorld, removeWorld, moveWorld, updateField, buildOverrides } from "/studio-worlds-core.js";
import { EDITIONS } from "/editions/index.js";

const TOKEN_KEY = "wordul.admin.token";
const $ = (id) => document.getElementById(id);

let BASE = [];     // code defaults (read-only reference)
let working = [];  // editable effective list

const tokenInput = $("adminToken");
tokenInput.value = localStorage.getItem(TOKEN_KEY) || "";
tokenInput.addEventListener("input", () => localStorage.setItem(TOKEN_KEY, tokenInput.value.trim()));

function authHeaders() {
  return { "content-type": "application/json", Authorization: `Bearer ${tokenInput.value.trim()}` };
}

function setStatus(msg, ok = true) {
  const el = $("status");
  el.textContent = msg;
  el.style.color = ok ? "" : "#ff8a8a";
}

function editionOptions(selected) {
  return EDITIONS.map((e) => `<option value="${e.id}" ${e.id === selected ? "selected" : ""}>${e.id}</option>`).join("");
}

function render() {
  const rows = $("rows");
  const sorted = [...working].sort((a, b) => a.order - b.order);
  rows.innerHTML = "";
  for (const w of sorted) {
    const row = document.createElement("div");
    row.className = "wm-row";
    row.innerHTML = `
      <input data-id="${w.id}" data-k="slug"  value="${escapeAttr(w.slug)}"  placeholder="slug" />
      <input data-id="${w.id}" data-k="name"  value="${escapeAttr(w.name)}"  placeholder="name" />
      <select data-id="${w.id}" data-k="editionId">${editionOptions(w.editionId)}</select>
      <label><input data-id="${w.id}" data-k="featured" type="checkbox" ${w.featured ? "checked" : ""}/> ★</label>
      <span class="wm-actions">
        <button data-id="${w.id}" data-act="up">↑</button>
        <button data-id="${w.id}" data-act="down">↓</button>
        <button data-id="${w.id}" data-act="del" class="danger">✕</button>
      </span>`;
    rows.appendChild(row);
  }
}

function escapeAttr(s) { return String(s ?? "").replace(/"/g, "&quot;"); }

$("rows").addEventListener("input", (e) => {
  const t = e.target;
  const id = t.getAttribute("data-id"); const k = t.getAttribute("data-k");
  if (!id || !k) return;
  const val = t.type === "checkbox" ? t.checked : t.value;
  working = updateField(working, id, k, val);
});

$("rows").addEventListener("click", (e) => {
  const t = e.target; const id = t.getAttribute("data-id"); const act = t.getAttribute("data-act");
  if (!id || !act) return;
  if (act === "up") working = moveWorld(working, id, -1);
  if (act === "down") working = moveWorld(working, id, +1);
  if (act === "del") { if (confirm("Delete this World?")) working = removeWorld(working, id); }
  render();
});

$("addBtn").addEventListener("click", () => {
  working = addWorld(working, { slug: "new-world", name: "New World", editionId: EDITIONS[0].id });
  render();
});

$("revertBtn").addEventListener("click", async () => {
  if (!confirm("Revert ALL worlds to code defaults? This clears admin overrides.")) return;
  await save({ edits: {}, added: [], deleted: [] }, "Reverted to defaults.");
});

$("saveBtn").addEventListener("click", async () => {
  await save(buildOverrides(working, BASE), "Saved.");
});

async function save(overrides, okMsg) {
  setStatus("Saving…");
  try {
    const res = await fetch("/admin/worlds", { method: "POST", headers: authHeaders(), body: JSON.stringify(overrides) });
    if (res.status === 401) return setStatus("Unauthorized — check the admin token.", false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setStatus(`Save failed: ${body.error || res.status}`, false);
    setStatus(okMsg);
    await load(); // re-pull effective state
  } catch (err) {
    setStatus(`Network error: ${err}`, false);
  }
}

async function load() {
  setStatus("Loading…");
  try {
    const res = await fetch("/admin/worlds", { headers: authHeaders() });
    if (res.status === 401) { setStatus("Enter the admin token to load worlds.", false); return; }
    if (!res.ok) { setStatus(`Load failed: ${res.status}`, false); return; }
    const { base, effective } = await res.json();
    BASE = base; working = effective.map((w) => ({ ...w }));
    render(); setStatus("");
  } catch (err) {
    setStatus(`Network error: ${err}`, false);
  }
}

if (tokenInput.value) load(); else setStatus("Enter the admin token to load worlds.", false);
tokenInput.addEventListener("change", () => { if (tokenInput.value) load(); });
