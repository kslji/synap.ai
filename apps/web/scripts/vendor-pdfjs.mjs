import fs from "node:fs";
import path from "node:path";

/**
 * Ship pdf.js as *.js (not *.mjs). nginx on many VMs maps .mjs to
 * application/octet-stream, which makes browsers refuse the ES module and
 * PDF text extract silently returns nothing.
 */
const src = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build");
const dest = path.join(process.cwd(), "public");
const pairs = [
  ["pdf.min.mjs", "pdf.js"],
  ["pdf.worker.min.mjs", "pdf.worker.js"],
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

// Remove stale .mjs copies so production cannot keep serving a broken MIME type.
for (const stale of ["pdf.mjs", "pdf.worker.mjs"]) {
  const p = path.join(dest, stale);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log(`vendor-pdfjs: removed stale ${stale}`);
  }
}
