type AnyHandle = {
  kind: string;
  name: string;
  getFile?: () => Promise<File>;
  values?: () => AsyncIterableIterator<AnyHandle>;
};

type FsEntry = {
  isFile?: boolean;
  isDirectory?: boolean;
  name: string;
  file?: (ok: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: FsEntry[]) => void, err?: (e: unknown) => void) => void };
};

const SKIP_DIR = /^(node_modules|\.git|\.ssh|\.gnupg|Library|AppData|__pycache__|\.venv)$/i;
const SKIP_FILE = /(\.pem|\.key|\.p12|\.env|id_rsa|credentials|secret)/i;
const SKIP_IMAGE = /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif|tiff?|ico)$/i;

export function canPickFolder(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export function canUseFilePicker(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}

export async function pickDeviceFolder(): Promise<File[]> {
  const w = window as unknown as { showDirectoryPicker?: () => Promise<AnyHandle> };
  if (!w.showDirectoryPicker) {
    throw new Error(
      "This browser cannot open a folder picker. Use Chrome or Edge on this computer, or add files with the paperclip.",
    );
  }
  const root = await w.showDirectoryPicker();
  const out: File[] = [];
  await walk(root, "", out, 0);
  if (!out.length) throw new Error("No readable documents in that folder.");
  return out;
}

/** One gesture: files (Chrome file picker) or a whole folder (Chrome folder picker). */
export async function pickFilesOrFolder(): Promise<File[]> {
  const w = window as unknown as {
    showOpenFilePicker?: (opts?: {
      multiple?: boolean;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<Array<{ getFile: () => Promise<File> }>>;
    showDirectoryPicker?: () => Promise<AnyHandle>;
  };
  if (w.showOpenFilePicker) {
    const handles = await w.showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: "Documents",
          accept: {
            "application/pdf": [".pdf"],
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
            "text/csv": [".csv", ".tsv"],
            "text/plain": [".txt", ".md"],
            "application/zip": [".zip"],
            "application/json": [".json"],
          },
        },
      ],
    });
    return Promise.all(handles.map((h) => h.getFile()));
  }
  if (w.showDirectoryPicker) {
    return pickDeviceFolder();
  }
  throw new DOMException("Use the file input", "NotSupportedError");
}

export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = [...(dt.items || [])];
  const collected: File[] = [];
  let walked = false;
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.() as FsEntry | null;
    if (!entry) continue;
    walked = true;
    await walkEntry(entry, "", collected, 0);
  }
  if (walked && collected.length) return collected;
  return [...(dt.files || [])];
}

async function walk(dir: AnyHandle, prefix: string, out: File[], depth: number): Promise<void> {
  if (depth > 3 || out.length >= 40 || !dir.values) return;
  for await (const handle of dir.values()) {
    if (out.length >= 40) return;
    const name = handle.name;
    if (handle.kind === "directory") {
      if (SKIP_DIR.test(name)) continue;
      await walk(handle, `${prefix}${name}/`, out, depth + 1);
      continue;
    }
    if (SKIP_FILE.test(name)) continue;
    if (SKIP_IMAGE.test(name)) continue;
    if (!handle.getFile) continue;
    const file = await handle.getFile();
    if (file.size > 8 * 1024 * 1024) continue;
    out.push(new File([file], `${prefix}${name}`, { type: file.type }));
  }
}

function walkEntry(entry: FsEntry, prefix: string, out: File[], depth: number): Promise<void> {
  return new Promise((resolve) => {
    if (depth > 3 || out.length >= 40) {
      resolve();
      return;
    }
    if (entry.isFile && entry.file) {
      if (SKIP_FILE.test(entry.name) || SKIP_IMAGE.test(entry.name)) {
        resolve();
        return;
      }
      entry.file(
        (file) => {
          if (file.size <= 8 * 1024 * 1024 && out.length < 40) {
            out.push(new File([file], `${prefix}${file.name}`, { type: file.type }));
          }
          resolve();
        },
        () => resolve(),
      );
      return;
    }
    if (entry.isDirectory && entry.createReader) {
      if (SKIP_DIR.test(entry.name)) {
        resolve();
        return;
      }
      const reader = entry.createReader();
      const next: FsEntry[] = [];
      const pump = () => {
        reader.readEntries(
          async (batch) => {
            if (!batch.length) {
              for (const child of next) {
                await walkEntry(child, `${prefix}${entry.name}/`, out, depth + 1);
              }
              resolve();
              return;
            }
            next.push(...batch);
            pump();
          },
          () => resolve(),
        );
      };
      pump();
      return;
    }
    resolve();
  });
}
