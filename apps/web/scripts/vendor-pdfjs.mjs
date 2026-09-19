import fs from "node:fs";
import path from "node:path";

/** Ship pdf.js next to the app so PDF text works offline and inside the downloaded zip. */
const src = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build");
const dest = path.join(process.cwd(), "public");
const pairs = [
  ["pdf.min.mjs", "pdf.mjs"],
  ["pdf.worker.min.mjs", "pdf.worker.mjs"],
];

for (const [from, to] of pairs) {
  const a = path.join(src, from);
  if (!fs.existsSync(a)) {
    console.error(`vendor-pdfjs: missing ${a} — run npm install`);
    process.exit(1);
  }
  fs.copyFileSync(a, path.join(dest, to));
  console.log(`vendor-pdfjs: ${to} (${(fs.statSync(a).size / 1024).toFixed(0)} KB)`);
}
