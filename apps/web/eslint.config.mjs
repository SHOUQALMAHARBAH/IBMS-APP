import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // THE THREE PLAYWRIGHT READS THAT DO NOT AUTO-WAIT.
    //
    // `count()`, `evaluateAll()` and `allInnerTexts()` answer about the DOM at the instant they are
    // called. Straight after `goto()` that instant is "React has not hydrated", and the answer is
    // zero — a plausible number, so nothing fails. It produced four wrong readings in one session,
    // in four files, every one written by someone who knew about the trap.
    //
    // `e2e/support/anchored.ts` is deliberately not in this list: it is the exemption, and it does
    // the anchoring once so no spec has to remember to.
    files: ["e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='count']",
          message:
            "count() does not auto-wait: called before render it returns 0, which is a plausible answer. Use anchoredCount(target[, anchor]) from ./support/anchored, or expectNone(target, anchor) when the expected count is zero.",
        },
        {
          selector: "CallExpression[callee.property.name='evaluateAll']",
          message:
            "evaluateAll() does not auto-wait: called before render it enumerates an empty page. Use anchoredAttributes(target, attribute[, anchor]) from ./support/anchored.",
        },
        {
          selector: "CallExpression[callee.property.name=/^(allInnerTexts|allTextContents)$/]",
          message:
            "allInnerTexts() does not auto-wait: called before render it returns []. Use anchoredTexts(target[, anchor]) from ./support/anchored.",
        },
      ],
    },
  },
]);

export default eslintConfig;
