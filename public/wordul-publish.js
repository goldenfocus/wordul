// public/wordul-publish.js — turn the current Vibe-Studio draft into a published wordul.
import { getSessionToken, openSecureSheet } from "/account.js";

const USERNAME_KEY = "wr.username"; // LS.username in app.js — the active handle

function slugify(t) {
  return (String(t || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "world";
}

export async function publishWordul(vibe) {
  const owner = (localStorage.getItem(USERNAME_KEY) || "").trim();
  if (!owner) {
    alert("Pick a name first (top-right on the home screen), then come back and publish.");
    return;
  }
  const token = getSessionToken();
  const desiredSlug = prompt("Your wordul's link:  /@" + owner + "/", slugify(vibe.vibeTitle || vibe.word));
  if (desiredSlug === null) return; // cancelled
  const bundle = {
    vibeTitle: vibe.vibeTitle, word: vibe.word, rows: vibe.rows,
    story: { title: vibe.vibeTitle || "Why this word", body: vibe.story || "" },
    colorScheme: vibe.colorScheme,
  };
  const res = await fetch("/api/worduls", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ owner, desiredSlug: slugify(desiredSlug), bundle }),
  });
  if (res.status === 401) {
    // Name not secured (or session expired) → open the claim/secure sheet, then retry once.
    // The draft persists in localStorage, so a redirect-to-home path is also safe.
    openSecureSheet(owner, () => publishWordul(vibe));
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error === "bad_owner" ? "That name can't publish — check your handle." : "Could not publish — try again.");
    return;
  }
  const { url } = await res.json();
  location.href = url; // land on the new wordul page (share link + play counter)
}
