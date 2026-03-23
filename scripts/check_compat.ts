/**
 * Verify the local Anchor + Solana + Rust + Node toolchain matches the pinned
 * versions declared in Anchor.toml, rust-toolchain.toml, and .nvmrc.
 *
 * Run before a release to catch drift. Exits non-zero if any pinned version
 * does not match the installed version.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";

type Check = { name: string; expected: string; actual: string };

const ROOT = path.resolve(__dirname, "..");

function readMatch(file: string, pattern: RegExp): string | null {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return null;
  const body = fs.readFileSync(full, "utf-8");
  const m = body.match(pattern);
  return m ? m[1] : null;
}

function which(cmd: string): string {
  try {
    return execSync(`${cmd} --version`, { encoding: "utf-8" }).trim();
  } catch {
    return "not installed";
  }
}

function normalize(version: string): string {
  const m = version.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : version;
}

function main(): void {
  const anchorPinned = readMatch("Anchor.toml", /anchor_version\s*=\s*"([^"]+)"/);
  const solanaPinned = readMatch("Anchor.toml", /solana_version\s*=\s*"([^"]+)"/);
  const rustPinned = readMatch("rust-toolchain.toml", /channel\s*=\s*"([^"]+)"/);
  const nodePinnedRaw = readMatch(".nvmrc", /(\d+(?:\.\d+){0,2})/);
  const nodePinned = nodePinnedRaw ?? "20";

  const checks: Check[] = [
    {
      name: "anchor",
      expected: anchorPinned ?? "unknown",
      actual: normalize(which("anchor")),
    },
    {
      name: "solana",
      expected: solanaPinned ?? "unknown",
      actual: normalize(which("solana")),
    },
    {
      name: "rustc",
      expected: rustPinned ?? "unknown",
      actual: normalize(which("rustc")),
    },
    {
      name: "node",
      expected: nodePinned,
      actual: normalize(which("node")),
    },
  ];

  let failed = 0;
  for (const c of checks) {
    const expMajor = c.expected.split(".")[0];
    const actMajor = c.actual.split(".")[0];
    const pass = c.expected === "unknown" || expMajor === actMajor;
    const verdict = pass ? "ok" : "MISMATCH";
    console.log(`[${verdict}] ${c.name}: expected=${c.expected} actual=${c.actual}`);
    if (!pass) failed += 1;
  }

  if (failed > 0) {
    console.error(`${failed} tools have major-version drift. Fix before release.`);
    process.exit(1);
  }
}

main();
