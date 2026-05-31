import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.js"],
    environment: "node",
  },
  resolve: {
    alias: [
      { find: /^\/editions\//, replacement: new URL("./public/editions/", import.meta.url).pathname },
      { find: /^\/edition\.js$/, replacement: new URL("./public/edition.js", import.meta.url).pathname },
    ],
  },
});
