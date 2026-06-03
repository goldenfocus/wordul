import { defineConfig } from "vitest/config";

export default defineConfig({
  publicDir: false,
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.js"],
    environment: "node",
    setupFiles: ["./test/setup.js"],
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
    ],
  },
});
