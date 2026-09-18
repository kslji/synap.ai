import fs from "node:fs";
import path from "node:path";

const out = path.join(process.cwd(), "out");
if (!fs.existsSync(out)) process.exit(0);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const urls = walk(out)
  .filter((f) => !f.endsWith(".map"))
  .map((f) => `/${path.relative(out, f).split(path.sep).join("/")}`)
  .filter((u) => u !== "/sw.js");

fs.writeFileSync(path.join(out, "sw-assets.json"), JSON.stringify(urls));
console.log(`sw-assets.json: ${urls.length} files`);
