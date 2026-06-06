import { defineConfig } from "vitest/config";

export default defineConfig({
  publicDir: false,
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.js"],
    environment: "node",
    setupFiles: ["./test/setup.js"],
    // This repo runs many agents (and their vitest runs) on one box at once. A few
    // CPU-bound tests (solver, noob word-list sweeps) finish in <2s standalone but get
    // starved past the 5s default under that contention, flaking the ship gate. 20s gives
    // headroom without hiding a genuinely hung test.
    testTimeout: 20000,
  },
  resolve: {
    alias: [
      // `cloudflare:workers` is a workerd-only virtual module; stub its DurableObject
      // base so DO classes (e.g. Worduls) are unit-testable in the node environment.
      { find: /^cloudflare:workers$/, replacement: new URL("./test/stubs/cloudflare-workers.ts", import.meta.url).pathname },
      { find: /^\/editions\//, replacement: new URL("./public/editions/", import.meta.url).pathname },
      { find: /^\/edition\.js$/, replacement: new URL("./public/edition.js", import.meta.url).pathname },
      { find: /^\/voice-key\.js$/, replacement: new URL("./public/voice-key.js", import.meta.url).pathname },
      { find: /^\/voice\.js$/, replacement: new URL("./public/voice.js", import.meta.url).pathname },
      { find: /^\/companion\.js$/, replacement: new URL("./public/companion.js", import.meta.url).pathname },
      { find: /^\/roomConfig\.js$/, replacement: new URL("./public/roomConfig.js", import.meta.url).pathname },
      { find: /^\/celebrate\.js$/, replacement: new URL("./public/celebrate.js", import.meta.url).pathname },
      { find: /^\/gold\.js$/, replacement: new URL("./public/gold.js", import.meta.url).pathname },
      { find: /^\/lane\.js$/, replacement: new URL("./public/lane.js", import.meta.url).pathname },
      { find: /^\/hacklog\.js$/, replacement: new URL("./public/hacklog.js", import.meta.url).pathname },
      { find: /^\/keyboard\.js$/, replacement: new URL("./public/keyboard.js", import.meta.url).pathname },
      { find: /^\/settings\.js$/, replacement: new URL("./public/settings.js", import.meta.url).pathname },
      { find: /^\/mute-btn\.js$/, replacement: new URL("./public/mute-btn.js", import.meta.url).pathname },
      { find: /^\/share-card\.js$/, replacement: new URL("./public/share-card.js", import.meta.url).pathname },
      { find: /^\/share-links\.js$/, replacement: new URL("./public/share-links.js", import.meta.url).pathname },
      { find: /^\/owner-tape\.js$/, replacement: new URL("./public/owner-tape.js", import.meta.url).pathname },
      { find: /^\/hub-glyphs\.js$/, replacement: new URL("./public/hub-glyphs.js", import.meta.url).pathname },
      { find: /^\/daily-card\.js$/, replacement: new URL("./public/daily-card.js", import.meta.url).pathname },
      { find: /^\/daily-lb\.js$/, replacement: new URL("./public/daily-lb.js", import.meta.url).pathname },
      { find: /^\/stamp-replay-core\.js$/, replacement: new URL("./public/stamp-replay-core.js", import.meta.url).pathname },
      { find: /^\/stamp-replay\.js$/, replacement: new URL("./public/stamp-replay.js", import.meta.url).pathname },
      { find: /^\/race-copy\.js$/, replacement: new URL("./public/race-copy.js", import.meta.url).pathname },
      { find: /^\/vibe-studio-core\.js$/, replacement: new URL("./public/vibe-studio-core.js", import.meta.url).pathname },
      { find: /^\/studio-worlds-core\.js$/, replacement: new URL("./public/studio-worlds-core.js", import.meta.url).pathname },
      { find: /^\/worlds\.js$/, replacement: new URL("./public/worlds.js", import.meta.url).pathname },
      { find: /^\/world-card\.js$/, replacement: new URL("./public/world-card.js", import.meta.url).pathname },
      { find: /^\/endcard\.js$/, replacement: new URL("./public/endcard.js", import.meta.url).pathname },
      { find: /^\/i18n\.js$/, replacement: new URL("./public/i18n.js", import.meta.url).pathname },
      { find: /^\/inspire\.js$/, replacement: new URL("./public/inspire.js", import.meta.url).pathname },
      { find: /^\/locales\/en\.js$/, replacement: new URL("./public/locales/en.js", import.meta.url).pathname },
      { find: /^\/drama\.js$/, replacement: new URL("./public/drama.js", import.meta.url).pathname },
      { find: /^\/lobby-view\.js$/, replacement: new URL("./public/lobby-view.js", import.meta.url).pathname },
    ],
  },
});
