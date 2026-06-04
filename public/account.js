// public/account.js — accounts P0 client: session-token storage + the "🔒 secure this
// account" sheet (preview→commit) + a login form. Server is authoritative for the
// passphrase (generated + hashed in the User DO); this never sees the word list.

const SESSION_KEY = "wr.session";

export function getSessionToken() { return localStorage.getItem(SESSION_KEY) || ""; }
export function setSessionToken(t) { if (t) localStorage.setItem(SESSION_KEY, t); }
export function clearSessionToken() { localStorage.removeItem(SESSION_KEY); }

async function postJSON(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Ask the server to preview a fresh passphrase (re-roll calls this again).
export function previewPassphrase(username) { return postJSON("/api/account/preview", { username }); }
// Commit the previewed claim; on success persist the returned session token.
export async function commitClaim(username, nonce) {
  const r = await postJSON("/api/account/claim", { username, nonce });
  if (r.ok && r.data.sessionToken) setSessionToken(r.data.sessionToken);
  return r;
}
// Log in on a new device; on success persist the token.
export async function login(username, passphrase) {
  const r = await postJSON("/api/account/login", { username, passphrase });
  if (r.ok && r.data.sessionToken) setSessionToken(r.data.sessionToken);
  return r;
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Build + show the secure-account sheet. `username` is the active (unclaimed) name.
// onClaimed() is called after a successful commit so the host can refresh chrome.
export async function openSecureSheet(username, onClaimed) {
  const overlay = document.createElement("div");
  overlay.className = "acct-overlay";
  document.body.appendChild(overlay);
  const close = () => overlay.remove();

  let nonce = "";
  async function roll() {
    overlay.querySelector(".acct-phrase").textContent = "…";
    const r = await previewPassphrase(username);
    if (!r.ok) {
      overlay.querySelector(".acct-phrase").textContent =
        r.data.error === "reserved" ? "That name is reserved." :
        r.data.error === "already_claimed" ? "This name is already secured." :
        r.status === 429 ? "Slow down a moment, then try again." : "Couldn't generate a phrase.";
      overlay.querySelector(".acct-confirm").disabled = true;
      return;
    }
    nonce = r.data.nonce;
    overlay.querySelector(".acct-phrase").textContent = r.data.passphrase;
    overlay.querySelector(".acct-confirm").disabled = false;
  }

  overlay.innerHTML = `
    <div class="acct-sheet" role="dialog" aria-modal="true" aria-label="Secure this account">
      <h2>🔒 Secure @${esc(username)}</h2>
      <p class="acct-lede">Your name is the public handle. This 6-word phrase is the secret that proves it's yours — like a key. Write it down: we store only a one-way hash and <strong>can't reset it</strong>. (A warm backup — sign in with Google/email — is coming.)</p>
      <p class="acct-phrase" aria-live="polite">…</p>
      <div class="acct-actions">
        <button class="acct-roll" type="button">🎲 Re-roll</button>
        <button class="acct-copy" type="button">Copy</button>
      </div>
      <label class="acct-ack"><input type="checkbox" class="acct-ack-box"> I've written it down somewhere safe.</label>
      <div class="acct-actions">
        <button class="acct-cancel" type="button">Cancel</button>
        <button class="acct-confirm" type="button" disabled>Secure my account</button>
      </div>
    </div>`;

  overlay.querySelector(".acct-roll").addEventListener("click", roll);
  overlay.querySelector(".acct-cancel").addEventListener("click", close);
  overlay.querySelector(".acct-copy").addEventListener("click", () => {
    navigator.clipboard?.writeText(overlay.querySelector(".acct-phrase").textContent || "").catch(() => {});
  });
  const confirmBtn = overlay.querySelector(".acct-confirm");
  const ackBox = overlay.querySelector(".acct-ack-box");
  const sync = () => { confirmBtn.disabled = !ackBox.checked || !nonce; };
  ackBox.addEventListener("change", sync);
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    const r = await commitClaim(username, nonce);
    if (r.ok) { close(); if (onClaimed) onClaimed(); }
    else { overlay.querySelector(".acct-phrase").textContent = "Claim failed — re-roll and try again."; }
  });

  await roll();
  // Confirm stays disabled until BOTH a phrase exists and the ack box is checked.
  confirmBtn.disabled = true;
}
