import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const destDir = path.join(process.cwd(), "public", "mlc");
const dest = path.join(destDir, "Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm");
const url =
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm";

function download(from, to) {
  return new Promise((resolve, reject) => {
    https
      .get(from, { headers: { "User-Agent": "synap-build" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          download(res.headers.location, to).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`wasm download ${res.statusCode}`));
          return;
        }
        fs.mkdirSync(path.dirname(to), { recursive: true });
        const out = fs.createWriteStream(to);
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve()));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

if (fs.existsSync(dest) && fs.statSync(dest).size > 10_000) {
  console.log("mlc wasm already present");
  process.exit(0);
}

try {
  await download(url, dest);
  console.log("saved", dest, fs.statSync(dest).size, "bytes");
} catch (err) {
  console.warn("Could not vendor MLC wasm (GitHub). Production will fetch it at runtime.", err);
}
