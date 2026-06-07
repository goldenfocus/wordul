import { setOn, setSource, clearVoice, buildVoiceOverride } from "/studio-voice-core.js";

const TOKEN_LS = "wordul.admin.token";
let BASE = { worlds: [], clipSets: [], builtin: [] };
let working = {};

const $ = (s, r = document) => r.querySelector(s);
const token = () => $("#token").value.trim();

function authHeaders() { return token() ? { Authorization: `Bearer ${token()}` } : {}; }
function setStatus(t) { $("#status").textContent = t; }
function aiVoiceNames() { return (window.speechSynthesis?.getVoices?.() ?? []).map((v) => v.name); }

async function load() {
  const res = await fetch("/admin/voice", { headers: authHeaders() });
  if (!res.ok) { setStatus(`load failed: ${res.status}`); return; }
  const data = await res.json();
  BASE = data.base; working = { ...data.effective };
  render();
}

function render() {
  const tb = $("#rows tbody"); tb.innerHTML = "";
  for (const w of BASE.worlds) {
    const e = working[w.id] ?? {};
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${w.name}<br><span class="muted">${w.id}</span></td>
      <td><input type="checkbox" ${e.on ? "checked" : ""} data-on="${w.id}"></td>
      <td><select data-kind="${w.id}">
        <option value="">— silent —</option>
        <option value="ai" ${e.source?.kind === "ai" ? "selected" : ""}>AI voice</option>
        <option value="clips" ${e.source?.kind === "clips" ? "selected" : ""}>Clip set</option>
        <option value="record" disabled>Record (soon)</option>
        <option value="clone-sample" disabled>Clone from sample (soon)</option>
      </select></td>
      <td data-detail="${w.id}"></td>
      <td><button data-clear="${w.id}">Remove</button></td>`;
    tb.appendChild(tr);
    renderDetail(w.id);
  }
  bind();
}

function renderDetail(id) {
  const cell = $(`[data-detail="${id}"]`); const e = working[id] ?? {};
  if (e.source?.kind === "ai") {
    const opts = aiVoiceNames().map((n) => `<option ${n === e.source.voiceName ? "selected" : ""}>${n}</option>`).join("");
    cell.innerHTML = `<select data-ai-voice="${id}">${opts}</select>
      <label>rate <input type="number" step="0.1" min="0.5" max="2" value="${e.source.rate ?? 1}" data-ai-rate="${id}" style="width:4rem"></label>
      <label>pitch <input type="number" step="0.1" min="0" max="2" value="${e.source.pitch ?? 1}" data-ai-pitch="${id}" style="width:4rem"></label>`;
  } else if (e.source?.kind === "clips") {
    const sets = BASE.clipSets.map((s) => `<option ${s === e.source.clipSetId ? "selected" : ""}>${s}</option>`).join("");
    cell.innerHTML = `reuse set <select data-clip-set="${id}">${sets}</select>
      <span class="muted">(upload UI: POST /admin/voice/clips per line — v1 reuse only)</span>`;
  } else { cell.innerHTML = `<span class="muted">no voice</span>`; }
}

function bind() {
  for (const cb of document.querySelectorAll("[data-on]")) cb.onchange = () => { working = setOn(working, cb.dataset.on, cb.checked); };
  for (const sel of document.querySelectorAll("[data-kind]")) sel.onchange = () => {
    const id = sel.dataset.kind;
    if (sel.value === "ai") working = setSource(working, id, { kind: "ai", voiceName: aiVoiceNames()[0] ?? "" });
    else if (sel.value === "clips") working = setSource(working, id, { kind: "clips", clipSetId: BASE.clipSets[0] ?? "yang", origin: "clone-existing" });
    else working = clearVoice(working, id);
    renderDetail(id);
  };
  for (const el of document.querySelectorAll("[data-ai-voice]")) el.onchange = () => mutAi(el.dataset.aiVoice, { voiceName: el.value });
  for (const el of document.querySelectorAll("[data-ai-rate]")) el.onchange = () => mutAi(el.dataset.aiRate, { rate: Number(el.value) });
  for (const el of document.querySelectorAll("[data-ai-pitch]")) el.onchange = () => mutAi(el.dataset.aiPitch, { pitch: Number(el.value) });
  for (const el of document.querySelectorAll("[data-clip-set]")) el.onchange = () => { working = setSource(working, el.dataset.clipSet, { kind: "clips", clipSetId: el.value, origin: "clone-existing" }); };
  for (const b of document.querySelectorAll("[data-clear]")) b.onclick = () => { working = clearVoice(working, b.dataset.clear); render(); };
}

function mutAi(id, patch) {
  const cur = (working[id]?.source) ?? { kind: "ai", voiceName: "" };
  working = setSource(working, id, { ...cur, ...patch, kind: "ai" });
}

$("#save").onclick = async () => {
  const doc = buildVoiceOverride(working, BASE.worlds);
  const res = await fetch("/admin/voice", { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify(doc) });
  const out = await res.json().catch(() => ({}));
  setStatus(res.ok ? "saved ✓" : `error: ${out.error ?? res.status}`);
};

$("#token").value = localStorage.getItem(TOKEN_LS) ?? "";
$("#token").onchange = () => localStorage.setItem(TOKEN_LS, token());
if ($("#token").value) load();
window.speechSynthesis?.addEventListener?.("voiceschanged", () => { for (const w of BASE.worlds) renderDetail(w.id); });
