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
  if (document.querySelector(".acct-overlay")) return; // guard: don't stack overlays
  const overlay = document.createElement("div");
  overlay.className = "acct-overlay";
  document.body.appendChild(overlay);
  const close = () => overlay.remove();

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

  const phraseEl = overlay.querySelector(".acct-phrase");
  const confirmBtn = overlay.querySelector(".acct-confirm");
  const ackBox = overlay.querySelector(".acct-ack-box");
  let nonce = "";

  // Confirm is live only when a phrase has been minted (nonce) AND the user acked.
  const sync = () => { confirmBtn.disabled = !ackBox.checked || !nonce; };

  async function roll() {
    phraseEl.textContent = "…";
    confirmBtn.disabled = true;
    const r = await previewPassphrase(username);
    if (!r.ok) {
      nonce = ""; // drop any prior phrase so a stale nonce can't be committed
      phraseEl.textContent =
        r.data.error === "reserved" ? "That name is reserved." :
        r.data.error === "already_claimed" ? "This name is already secured." :
        r.status === 429 ? "Slow down a moment, then try again." : "Couldn't generate a phrase.";
      sync();
      return;
    }
    nonce = r.data.nonce;
    phraseEl.textContent = r.data.passphrase;
    sync();
  }

  overlay.querySelector(".acct-roll").addEventListener("click", roll);
  overlay.querySelector(".acct-cancel").addEventListener("click", close);
  overlay.querySelector(".acct-copy").addEventListener("click", () => {
    navigator.clipboard?.writeText(phraseEl.textContent || "").catch(() => {});
  });
  ackBox.addEventListener("change", sync);
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    try {
      const r = await commitClaim(username, nonce);
      if (r.ok) { close(); if (onClaimed) onClaimed(); return; }
      nonce = ""; // failed claim — force a re-roll
      phraseEl.textContent = "Claim failed — re-roll and try again.";
      sync();
    } catch {
      phraseEl.textContent = "Network error — check your connection and try again.";
      sync(); // keep the (still-valid) nonce so the user can retry without re-rolling
    }
  });

  await roll();
  confirmBtn.focus(); // move focus into the dialog for keyboard users
}
