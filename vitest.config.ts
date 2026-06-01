import { defineConfig } from "vitest/config";

export default defineConfig({
  publicDir: false,
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.js"],
    environment: "node",
  },
  resolve: {
    alias: [
      { find: /^\/editions\//, replacement: new URL("./public/editions/", import.meta.url).pathname },
      { find: /^\/edition\.js$/, replacement: new URL("./public/edition.js", import.meta.url).pathname },
      { find: /^\/voice-key\.js$/, replacement: new URL("./public/voice-key.js", import.meta.url).pathname },
      { find: /^\/voice\.js$/, replacement: new URL("./public/voice.js", import.meta.url).pathname },
      { find: /^\/celebrate\.js$/, replacement: new URL("./public/celebrate.js", import.meta.url).pathname },
      { find: /^\/gold\.js$/, replacement: new URL("./public/gold.js", import.meta.url).pathname },
      { find: /^\/hacklog\.js$/, replacement: new URL("./public/hacklog.js", import.meta.url).pathname },
    ],
  },
});
