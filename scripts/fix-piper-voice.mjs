// Makes newer Piper voices load in the 2023 Windows piper.exe, which only accepts
// single-character phonemes. Keeps the original as <file>.original and can be re-run safely.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("Usage: node scripts/fix-piper-voice.mjs <path to voice .onnx.json>");
  process.exit(1);
}

const backup = `${file}.original`;
if (!existsSync(backup)) copyFileSync(file, backup);

const cfg = JSON.parse(readFileSync(backup, "utf8"));
const single = (s) => [...s].length === 1;
const removed = [];

const cleanKeys = (map) => {
  if (!map) return;
  for (const key of Object.keys(map)) {
    if (!single(key)) {
      removed.push(key);
      delete map[key];
    }
  }
};

cleanKeys(cfg.phoneme_id_map);
cleanKeys(cfg.inference?.phoneme_silence);

if (cfg.phoneme_map) {
  cleanKeys(cfg.phoneme_map);
  for (const [key, values] of Object.entries(cfg.phoneme_map)) {
    cfg.phoneme_map[key] = values.filter(single);
  }
}

writeFileSync(file, JSON.stringify(cfg, null, 2));
console.log(
  removed.length
    ? `Done. Removed ${removed.length} multi-character phoneme(s): ${removed.join(" ")}`
    : "Nothing to change; this voice already works with the old piper.exe.",
);
console.log(`The original file is kept at ${backup}`);