/**
 * Copy the IDL emitted by `anchor build` from target/idl/ghos.json into
 * sdk/src/idl/ghos.json so the SDK + downstream consumers have a tracked copy
 * that does not require rebuilding the program.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "target", "idl", "ghos.json");
const DEST = path.join(ROOT, "sdk", "src", "idl", "ghos.json");

function main(): void {
  if (!fs.existsSync(SOURCE)) {
    console.error(`no IDL at ${SOURCE}. Run 'anchor build' first.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(SOURCE, "utf-8");
  const parsed = JSON.parse(raw);
  const pretty = JSON.stringify(parsed, null, 2) + "\n";
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, pretty, "utf-8");
  const sizeKb = (pretty.length / 1024).toFixed(1);
  console.log(`wrote ${DEST} (${sizeKb} KiB, ${parsed.instructions?.length ?? "?"} instructions)`);
}

main();

// wip: sketch idl export integration with CI
