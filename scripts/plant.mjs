#!/usr/bin/env node
/**
 * PLANT — apply a deliberate regression, prove a guard catches it, put it back.
 *
 * ## Why this is a tool and not four lines of sed
 *
 * A plant is how this project proves a test can fail. The whole value of it rests on one assumption
 * nobody checks: that the edit actually happened. On 2026-09-24 three plants reported PASSING and had
 * never applied — `process.argv[2]` is empty when node runs with `-e`, because no script path occupies
 * argv[1], so the selector was `undefined`, no branch matched, the file was untouched, and the suite
 * was green for the only reason a suite is ever green: nothing was wrong with it.
 *
 * A plant that silently fails to apply reads EXACTLY like a guard that works. Both print a green
 * suite. That makes it the most expensive kind of mistake available here, because its output is
 * indistinguishable from success and it is used to justify the claim "this guard is proven".
 *
 * So every failure mode below EXITS NON-ZERO and says which one it was. The tool cannot report success
 * without having changed a file on disk and re-read it to confirm.
 *
 * ## Use
 *
 *   node scripts/plant.mjs <plants.json> <name>            apply one plant
 *   node scripts/plant.mjs <plants.json> <name> --revert    put the file back, byte for byte
 *   node scripts/plant.mjs --self-test                      prove this tool fails loudly
 *
 * `plants.json` maps a name to `{ file, from, to }`. `from` must occur exactly once — zero means the
 * code moved and the plant is stale; more than one means the plant is ambiguous about which site it is
 * testing. Both are errors, because both produce a plant whose meaning nobody can state.
 *
 * Revert restores from the backup written at apply time, so a plant cannot leave a half-reverted file
 * behind — the failure mode after "never applied" that actually costs a day.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const BACKUP_SUFFIX = ".plant-backup";

function die(code, message) {
  console.error(`plant: ${message}`);
  process.exit(code);
}

/** Applies one plant and PROVES it landed. Returns a summary; throws a string on any failure. */
export function applyPlant({ file, from, to }) {
  const target = resolve(file);
  if (!existsSync(target)) throw `the file this plant names does not exist: ${file}`;
  const before = readFileSync(target, "utf8");

  const occurrences = before.split(from).length - 1;
  if (occurrences === 0) {
    throw `the text this plant replaces is not in ${file}. The code moved, so this plant is stale — re-derive it against what is there now rather than assuming it still applies.`;
  }
  if (occurrences > 1) {
    throw `the text this plant replaces occurs ${occurrences} times in ${file}. A plant that hits several sites cannot say which guard it is testing.`;
  }
  if (from === to) throw `this plant replaces text with itself, so it changes nothing.`;

  const after = before.split(from).join(to);
  // The belt: compare what we are about to write against what is there.
  if (after === before) {
    throw `the replacement produced an identical file. Refusing to report a plant that changed nothing.`;
  }

  writeFileSync(`${target}${BACKUP_SUFFIX}`, before);
  writeFileSync(target, after);

  // The braces: re-READ from disk. A write that silently failed, a read-only file, an editor holding
  // the old content — none of those are theoretical on Windows, and all of them look like success.
  const readBack = readFileSync(target, "utf8");
  if (readBack === before) {
    throw `${file} is unchanged on disk after the write. The plant did NOT apply.`;
  }
  if (readBack.includes(from)) {
    throw `${file} still contains the text this plant was supposed to replace.`;
  }
  return { file, bytesBefore: before.length, bytesAfter: readBack.length };
}

export function revertPlant({ file }) {
  const target = resolve(file);
  const backup = `${target}${BACKUP_SUFFIX}`;
  if (!existsSync(backup)) {
    throw `no backup for ${file}. Revert would be a guess, and a half-reverted plant is worse than a planted file.`;
  }
  const original = readFileSync(backup, "utf8");
  writeFileSync(target, original);
  const readBack = readFileSync(target, "utf8");
  if (readBack !== original) throw `${file} does not match its backup after revert.`;
  unlinkSync(backup);
  return { file, bytes: original.length };
}

function loadPlants(path) {
  if (!existsSync(path)) die(2, `no such plants file: ${path}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    die(2, `${path} is not valid JSON: ${String(err)}`);
  }
  return parsed;
}

function cli(argv) {
  if (argv.includes("--self-test")) return selfTest();

  const [plantsPath, name, ...rest] = argv;
  if (!plantsPath || !name) {
    die(
      2,
      `usage: node scripts/plant.mjs <plants.json> <name> [--revert]\nA missing name is an ERROR, never a no-op — that is the bug this tool exists to make impossible.`,
    );
  }
  const plants = loadPlants(plantsPath);
  const plant = plants[name];
  if (!plant) {
    die(
      2,
      `no plant named "${name}" in ${plantsPath}. Defined: ${Object.keys(plants).join(", ") || "(none)"}. A typo is an error, not a plant that quietly does nothing.`,
    );
  }
  for (const key of ["file", "from", "to"]) {
    if (typeof plant[key] !== "string") die(2, `plant "${name}" is missing a string "${key}".`);
  }

  try {
    if (rest.includes("--revert")) {
      const done = revertPlant(plant);
      console.log(`REVERTED ${name} — ${done.file} restored (${done.bytes} bytes)`);
    } else {
      const done = applyPlant(plant);
      console.log(
        `PLANTED ${name} — ${done.file} (${done.bytesBefore} -> ${done.bytesAfter} bytes), verified on disk`,
      );
    }
  } catch (message) {
    die(1, String(message));
  }
}

/**
 * A PLANT ON THE PLANT MECHANISM.
 *
 * Each case below is a way this tool could lie. The one that matters most is the last: invoked with no
 * plant name, it must EXIT NON-ZERO, because the original bug was precisely an unnamed plant reporting
 * success.
 */
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "plant-self-test-"));
  const file = join(dir, "subject.ts");
  let failures = 0;

  const check = (label, fn, expect) => {
    let outcome = "no error";
    try {
      fn();
    } catch (err) {
      outcome = String(err);
    }
    const ok = expect === "throws" ? outcome !== "no error" : outcome === "no error";
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : ` — got: ${outcome}`}`);
    if (!ok) failures += 1;
  };

  console.log("plant --self-test");

  writeFileSync(file, "const gate = true;\nconst other = 1;\n");
  check(
    "a plant whose target text is absent FAILS",
    () => applyPlant({ file, from: "not in this file", to: "x" }),
    "throws",
  );

  writeFileSync(file, "dup();\ndup();\n");
  check(
    "a plant whose target text occurs twice FAILS (ambiguous site)",
    () => applyPlant({ file, from: "dup();", to: "gone();" }),
    "throws",
  );

  writeFileSync(file, "const gate = true;\n");
  check(
    "a plant that replaces text with itself FAILS",
    () => applyPlant({ file, from: "const gate = true;", to: "const gate = true;" }),
    "throws",
  );

  check(
    "a plant naming a file that does not exist FAILS",
    () => applyPlant({ file: join(dir, "absent.ts"), from: "a", to: "b" }),
    "throws",
  );

  writeFileSync(file, "const gate = true;\n");
  check(
    "a valid plant applies",
    () => applyPlant({ file, from: "const gate = true;", to: "const gate = false;" }),
    "ok",
  );
  const planted = readFileSync(file, "utf8");
  if (!planted.includes("false")) {
    console.log("  FAIL  the applied plant is not on disk");
    failures += 1;
  } else {
    console.log("  ok    the applied plant is on disk");
  }

  check("revert restores the file", () => revertPlant({ file }), "ok");
  if (readFileSync(file, "utf8") !== "const gate = true;\n") {
    console.log("  FAIL  revert did not restore byte for byte");
    failures += 1;
  } else {
    console.log("  ok    revert restored byte for byte");
  }

  check(
    "a second revert with no backup FAILS rather than guessing",
    () => revertPlant({ file }),
    "throws",
  );

  // THE ORIGINAL BUG, as a test: no name given.
  const plantsFile = join(dir, "plants.json");
  writeFileSync(
    plantsFile,
    JSON.stringify({ real: { file, from: "const gate = true;", to: "const gate = false;" } }),
  );
  const spawn = (args) =>
    spawnSync(process.execPath, [import.meta.filename, ...args], { encoding: "utf8" });
  const noName = spawn([plantsFile]);
  const noNameOk = noName.status !== 0;
  console.log(
    `  ${noNameOk ? "ok  " : "FAIL"}  invoked with NO plant name, the CLI exits non-zero (status ${noName.status})`,
  );
  if (!noNameOk) failures += 1;

  const badName = spawn([plantsFile, "typo"]);
  const badNameOk = badName.status !== 0;
  console.log(
    `  ${badNameOk ? "ok  " : "FAIL"}  invoked with an unknown plant name, the CLI exits non-zero (status ${badName.status})`,
  );
  if (!badNameOk) failures += 1;

  rmSync(dir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`plant --self-test: ${failures} case(s) failed. The plant mechanism is not trustworthy.`);
    process.exit(1);
  }
  console.log("plant --self-test: every failure mode is loud.");
}

cli(process.argv.slice(2));
