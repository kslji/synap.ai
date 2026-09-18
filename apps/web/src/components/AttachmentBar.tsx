"use client";

import { FileText, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bytesBlob } from "@/lib/attachments";
import { formatBytes, type StoredAttachment } from "@/lib/browserStore";

function Preview({ file }: { file: StoredAttachment }) {
  const url = useMemo(() => {
    if (file.kind !== "image" || !file.bytes || file.bytes.byteLength < 8) return null;
    return URL.createObjectURL(bytesBlob(file.bytes, file.mime || "image/*"));
  }, [file]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  if (url) return <img src={url} alt="" className="attach-thumb" />;
  return <FileText size={12} />;
}

export function AttachmentBar({
  files,
  onRemove,
}: {
  files: StoredAttachment[];
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!files.length) return null;
  const extra = files.length > 6;
  const shown = open || !extra ? files : files.slice(0, 6);
  return (
    <div className="attach-bar">
      <div className="attach-bar-head">
        <span className="tiny muted">
          {files.length} file{files.length === 1 ? "" : "s"} on this chat
        </span>
        {extra && (
          <button type="button" className="attach-more" onClick={() => setOpen((v) => !v)}>
            {open ? "Show less" : `+${files.length - 6} more`}
          </button>
        )}
      </div>
      <div className="attach-list">
        {shown.map((f) => (
          <div key={f.id} className="attach-chip" title={`${f.name} · ${formatBytes(f.size)}`}>
            <Preview file={f} />
            <span className="attach-name">{f.name.split("/").pop()}</span>
            <button type="button" className="attach-x" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f.id)}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
