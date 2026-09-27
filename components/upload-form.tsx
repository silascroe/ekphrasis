"use client";

import { useRef, useState } from "react";
import type { IdentificationResult } from "../lib/types";

type UploadFormProps = {
  onResult: (result: IdentificationResult) => void;
  onStart?: () => void;
};

export function UploadForm({ onResult, onStart }: UploadFormProps) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      onResult({ state: "ERROR", error: "UNSUPPORTED_INPUT" });
      return;
    }

    onStart?.();
    setBusy(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const response = await fetch("/api/identify", { method: "POST", body: form });
      onResult(await response.json() as IdentificationResult);
    } catch {
      onResult({ state: "ERROR", error: "PROCESSING_FAILED" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload-control">
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Identifying…" : "Choose a photo"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        hidden
        disabled={busy}
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) void submit(file);
        }}
      />
    </div>
  );
}
