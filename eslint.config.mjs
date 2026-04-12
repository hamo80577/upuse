import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const typescriptFiles = ["apps/**/*.{ts,tsx}"];
const testFiles = ["**/*.test.{ts,tsx}"];
const coreStrictFiles = [
  "apps/server/src/monitor/**/*.ts",
  "apps/server/src/routes/**/*.ts",
  "apps/server/src/shared/http/**/*.ts",
  "apps/server/src/shared/persistence/**/*.ts",
  "apps/server/src/systems/**/*.ts",
];

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
  },
  js.configs.recommended,
  {
    files: typescriptFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "separate-type-imports" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true, ignoreIIFE: true }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false, attributes: false } }],
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-empty": "off",
      "no-undef": "off",
      "no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: coreStrictFiles,
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: testFiles,
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
];
