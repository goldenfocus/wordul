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

// Pick the most mechanical voice the browser offers, so the answer reveal sounds
// deliberately uncanny against Yan's warm frame. Falls back to pitch/rate mangling.
function pickRoboticVoice() {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  const wanted = ["Zarvox", "Trinoids", "Cellos", "Bad News", "Boing", "Albert"];
  for (const name of wanted) {
    const v = voices.find((x) => x.name && x.name.includes(name));
    if (v) return v;
  }
  return null;
}

function roboticUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  const v = pickRoboticVoice();
  if (v) u.voice = v;
  else { u.pitch = 0.3; u.rate = 0.85; } // no robot voice available → mangle the default
  return u;
}

export function speakRobotic(word) {
  if (!word || !window.speechSynthesis) return;
  try { window.speechSynthesis.speak(roboticUtterance(word)); } catch { /* ignore */ }
}

// A templated line like "The word was {answer}." spoken in two voices: the static
// frame in Yan's cloned voice (pre-rendered clip, else fallback TTS), the answer in
// the robotic voice. Segments play strictly in order via the audio's `ended` event.
export async function speakTemplated(editionId, rawLine, ctx = {}) {
  if (!rawLine || isMuted()) return;
  const token = "{answer}";
  const idx = rawLine.indexOf(token);
  if (idx === -1) { // not actually templated — fall back to the normal path
    return speakLine(editionId, rawLine, rawLine);
  }
  const prefix = rawLine.slice(0, idx).trim();
  const suffix = rawLine.slice(idx + token.length).trim();
  const map = await loadManifest(editionId);
  if (isMuted()) return;

  // Play one cloned-voice segment, resolving when it finishes (clip end, or TTS end,
  // or immediately if empty / on error). Reuses module-level `current` for stop().
  const playSegment = (seg) => new Promise((resolve) => {
    if (!seg) return resolve();
    const file = map[lineKey(seg)];
    if (file) {
      stopSpeaking();
      try {
        const audio = new Audio(`/voice/${editionId}/${file}`);
        current = { audio };
        audio.addEventListener("ended", resolve, { once: true });
        audio.play().catch(resolve);
      } catch { resolve(); }
    } else {
      try {
        const u = new SpeechSynthesisUtterance(seg);
        u.addEventListener("end", resolve, { once: true });
        window.speechSynthesis.speak(u);
      } catch { resolve(); }
    }
  });

  const sayAnswer = () => new Promise((resolve) => {
    if (!ctx.answer || !window.speechSynthesis) return resolve();
    try {
      const u = roboticUtterance(ctx.answer);
      u.addEventListener("end", resolve, { once: true });
      window.speechSynthesis.speak(u);
    } catch { resolve(); }
  });

  await playSegment(prefix);
  if (isMuted()) return;
  await sayAnswer();
  if (isMuted()) return;
  await playSegment(suffix);
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
