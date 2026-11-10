import { defineConfig, type OxlintConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc"],
  categories: {
    correctness: "error",
  },
  env: {
    builtin: true,
  },
  ignorePatterns: ["out/**", ".vscode-test/**"],
} satisfies OxlintConfig);
