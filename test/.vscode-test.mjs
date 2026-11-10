import * as path from "node:path";

import { defineConfig } from "@vscode/test-cli";

// `bun run build:test` bundles the extension + tests into ./out and creates the fixture workspace.
export default defineConfig({
  label: "integration",
  files: "../out/test/**/*.test.js",
  extensionDevelopmentPath: process.cwd(),
  version: "stable",
  workspaceFolder: path.join(process.cwd(), "out", "test", "fixtures", "workspace"),
  mocha: {
    ui: "tdd",
    timeout: 30000,
  },
});
