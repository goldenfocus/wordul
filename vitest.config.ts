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
      { find: /^\/editions\//, replacement: new URL("./public/editions/", import.meta.url).pathname },
      { find: /^\/edition\.js$/, replacement: new URL("./public/edition.js", import.meta.url).pathname },
      { find: /^\/voice-key\.js$/, replacement: new URL("./public/voice-key.js", import.meta.url).pathname },
      { find: /^\/voice\.js$/, replacement: new URL("./public/voice.js", import.meta.url).pathname },
      { find: /^\/companion\.js$/, replacement: new URL("./public/companion.js", import.meta.url).pathname },
      { find: /^\/roomConfig\.js$/, replacement: new URL("./public/roomConfig.js", import.meta.url).pathname },
      { find: /^\/celebrate\.js$/, replacement: new URL("./public/celebrate.js", import.meta.url).pathname },
      { find: /^\/gold\.js$/, replacement: new URL("./public/gold.js", import.meta.url).pathname },
      { find: /^\/hacklog\.js$/, replacement: new URL("./public/hacklog.js", import.meta.url).pathname },
      { find: /^\/keyboard\.js$/, replacement: new URL("./public/keyboard.js", import.meta.url).pathname },
      { find: /^\/settings\.js$/, replacement: new URL("./public/settings.js", import.meta.url).pathname },
      { find: /^\/share-card\.js$/, replacement: new URL("./public/share-card.js", import.meta.url).pathname },
      { find: /^\/hub-glyphs\.js$/, replacement: new URL("./public/hub-glyphs.js", import.meta.url).pathname },
      { find: /^\/daily-card\.js$/, replacement: new URL("./public/daily-card.js", import.meta.url).pathname },
      { find: /^\/race-copy\.js$/, replacement: new URL("./public/race-copy.js", import.meta.url).pathname },
      { find: /^\/vibe-studio-core\.js$/, replacement: new URL("./public/vibe-studio-core.js", import.meta.url).pathname },
    ],
  },
});
