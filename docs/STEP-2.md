# Step 2 — chat with your own documents

Attachments and local retrieval. A file never leaves the computer, and the chat stays usable while it is read.

## Conversion

Node and TypeScript, not a Python sidecar. pdfjs-dist reads text PDFs, mammoth reads DOCX, SheetJS reads XLSX and CSV, a small unzip reads PPTX slide text, and html-to-text reads HTML. Images and scanned PDF pages (a page with under 20 characters of text) go through tesseract.js (WASM) with English and Hindi traineddata fetched by `apps/desktop/scripts/fetch-tessdata.mjs` and copied beside the app. Those files are not committed.

A PyInstaller worker (Docling or MarkItDown) would add a second toolchain and a few hundred megabytes for formats these libraries already cover. OCR runs in an Electron utility process. tesseract.js treats Electron as a browser and would try to download language files, so the runner copies the bundled traineddata into its cache first. Inside the main process the same worker stalled after pdf.js loaded.

## Chunks and embeddings

Passages are about 250 words, capped at 300, with a 40-word overlap. Headings stay with the text. Each chunk keeps a page, slide, or sheet label. EmbeddingGemma 2 uses the document prefix `title: {title} | text: {content}` and the query prefix `task: search result | query: {q}`, then 256 dimensions, L2-normalised, in sqlite-vec plus FTS5 inside the encrypted user database. The same bytes (SHA-256) are stored once. A changed file is indexed again. Deleting a file deletes its chunks and vectors.

## Retrieval

Hybrid search is vector plus FTS5, merged with reciprocal rank fusion (`k = 60`). The composer toggle is "This chat" or "All documents". The token budgeter receives at most 5 passages. Citations are the file name plus page, slide, or sheet, and they open a preview of that passage.

Measured on 9 Oct 2026 with EmbeddingGemma 2 at 256 dimensions, Qwen3.5-2B, and the self-test fixtures:

| Query | Top file | Cosine | Gate |
|---|---|---|---|
| What time does the harbor ferry leave? | harbor-ferry.pdf page 1 | 0.832 | answer |
| नौका किस घाट से निकलती है? | harbor-ferry.pdf | 0.766 | answer |
| best pizza recipe with pineapple | — | 0.539 | insufficient |
| How much is invoice INV-441? | northwind-invoice.docx | answer | answer |

Thresholds in `DOC_TAU`: Latin cosine 0.64 and keyword coverage 0.34, or cosine 0.75 with no coverage requirement. Devanagari queries skip keyword coverage (FTS porter is English-centric) and answer at cosine 0.66. That is above the old 0.60 placeholder and still under the measured Hindi cosine of 0.766. An unrelated query at 0.539 stays insufficient.

If documents were searched and nothing is relevant, the reply is exactly: `I don't have enough information in your documents.` If the files in scope are still being read, the reply is: `I'm still reading your files. Ask again when they finish.` A chat with no documents skips the gate and answers normally.

The self-test grounded answer from Qwen3.5-2B was: `The harbor ferry leaves at 06:40 [S1].` The shelf photo OCR text was `Warehouse shelf B7 holds 40 coils of rope.`

## Wired vs deferred

| Piece | State |
|---|---|
| Drag-and-drop, file picker, Documents view, job queue, cancel, retry | Wired |
| PDF, DOCX, PPTX, XLSX/CSV, TXT/MD, HTML, PNG, JPEG | Wired |
| tesseract.js eng+hin in a utility process | Wired. Language data is fetched, not committed |
| sqlite-vec + FTS5, content-hash dedupe, delete cascades | Wired |
| Hybrid search, scope toggle, citations, source preview | Wired |
| Relevance gate | Calibrated on the fixture set above |
| Octopus while files are read; jellyfish while a reply is thought through | Wired |
| Qwen3.5 mmproj image description | Optional only when the projector file is already on disk. It is not downloaded (about 670 MB). TODO: a Models row and a Describe button. OCR is the image path |
| Page-level resume | The `resume_cursor` column exists. Retry reprocesses the whole file |
| Knowledge-pack search | Still empty until signed packs exist |
| Web search | Day 4 |
| Installers | `electron-builder.yml` unpacks native addons, tesseract, pdfjs, canvas, and the OCR runner for mac arm64/x64 and win x64. CI builds the bundle. A Mac and a Windows runner still produce the installers |

## Tests

`npm run test:unit -w @surf/desktop` covers the chunker, prefixes, gate, and reciprocal rank fusion, plus a SQLCipher round-trip. `SURF_SELFTEST=1` ingests a PDF, a DOCX, and a PNG, then asks Qwen3.5-2B. Fetch tessdata before packaging or CI: `node apps/desktop/scripts/fetch-tessdata.mjs`.
