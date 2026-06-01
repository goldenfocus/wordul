// Cloned-voice playback with graceful fallback.
// speakLine(editionId, rawLine, spokenText):
//   - look up the RAW template line in the edition's manifest; if a clip exists,
//     play it (the cloned voice). Otherwise speak `spokenText` via the browser's
//     speechSynthesis (covers un-rendered and dynamic {answer} lines).
import { lineKey } from "/voice-key.js";

const MUTE_LS = "wordul.muted";
const manifests = {}; // editionId -> { key: filename }
let current = null;   // { audio } currently playing

function isMuted() { return localStorage.getItem(MUTE_LS) === "1"; }

async function loadManifest(editionId) {
  if (editionId in manifests) return manifests[editionId];
  try {
    const res = await fetch(`/voice/${editionId}/manifest.json`);
    manifests[editionId] = res.ok ? await res.json() : {};
  } catch {
    manifests[editionId] = {};
  }
  return manifests[editionId];
}

function playClip(url) {
  stopSpeaking();
  try {
    const audio = new Audio(url);
    current = { audio };
    // Autoplay can be blocked before a user gesture — that's fine, stay silent.
    audio.play().catch(() => {});
  } catch { /* ignore */ }
}

function fallbackSpeak(text) {
  if (!text || !window.speechSynthesis) return;
  try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* ignore */ }
}

export async function speakLine(editionId, rawLine, spokenText) {
  if (!rawLine || isMuted()) return;
  const map = await loadManifest(editionId);
  if (isMuted()) return; // re-check after the await
  const file = map[lineKey(rawLine)];
  if (file) playClip(`/voice/${editionId}/${file}`);
  else fallbackSpeak(spokenText ?? rawLine);
}

export function stopSpeaking() {
  try { current?.audio?.pause(); } catch { /* ignore */ }
  current = null;
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}
