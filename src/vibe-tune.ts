// Pure logic for the Vibe Studio "✨ tune" affordance — assembling the prompt the
// curator's "why this word" note is rewritten with, and cleaning the model's reply.
// No `env.AI`, no fetch here: the worker route (worker.ts) calls env.AI.run with
// these messages, so everything in this file is unit-tested in vibe-tune.test.ts.

// Workers AI text model. Llama 3.1 8B Instruct: fast (feels instant), generous on
// the free Neuron allocation, plenty for prose tuning. Swap here to upgrade quality.
export const TUNE_MODEL = "@cf/meta/llama-3.1-8b-instruct";

// Mirrors public/vibe-studio-core.js DEFAULT_AI_PROMPT (client/server boundary — the
// worker can't import the public ESM asset cleanly, so the text is duplicated). Keep
// the two in sync if either changes.
export const DEFAULT_TUNE_PROMPT = "Make this text legendary — vivid, cool, unforgettable.";

// Caps — the route also enforces these, but keeping them here keeps the pure layer
// self-contained for tests and stops a pathological story from ballooning the call.
export const MAX_STORY_CHARS = 4000;
export const MAX_PROMPT_CHARS = 500;

export type TuneMessage = { role: "system" | "user"; content: string };

const SYSTEM = [
  "You are a master wordsmith for a daily word game called Wordul.",
  "A curator wrote a short 'why this word' note. Rewrite it to follow the curator's instruction,",
  "keeping it first-person, warm, and roughly the same length (a sentence or two).",
  "Return ONLY the rewritten note — no preamble, no quotation marks, no explanation.",
].join(" ");

// Assemble the chat turns sent to env.AI.run. A blank/absent instruction falls back
// to the default so the bare ✨ click always has something coherent to send.
export function buildTuneMessages(story: string, prompt?: string): TuneMessage[] {
  const instruction = (typeof prompt === "string" && prompt.trim()) || DEFAULT_TUNE_PROMPT;
  const text = typeof story === "string" ? story : "";
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Instruction: ${instruction}\n\nNote to rewrite:\n${text}` },
  ];
}

// Instruct models love to wrap output in quotes, code fences, or a "Here is…:" lead-in.
// Strip the common envelopes conservatively so the curator gets clean prose, never
// touching a colon that is genuinely part of the sentence.
export function cleanTuneOutput(text: string): string {
  if (typeof text !== "string") return "";
  let out = text.trim();

  // ``` … ``` fences (with or without a language tag).
  const fence = out.match(/^```[a-z]*\n?([\s\S]*?)\n?```$/i);
  if (fence) out = fence[1].trim();

  // A leading "Sure! Here's a … version:" / "Here is the rewritten text:" preamble,
  // only when it stays on the first line (so real prose with a colon survives).
  out = out.replace(/^(?:sure[,!.\s]*)?here(?:'s| is)\b[^:\n]*:\s*/i, "").trim();

  // Wrapping quotes — straight or curly — applied as a matched pair.
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"], // “ ”
    ["‘", "’"], // ‘ ’
  ];
  for (const [open, close] of pairs) {
    if (out.length >= 2 && out.startsWith(open) && out.endsWith(close)) {
      out = out.slice(open.length, out.length - close.length).trim();
      break;
    }
  }

  return out;
}
