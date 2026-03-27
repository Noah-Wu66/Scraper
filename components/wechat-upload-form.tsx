"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function WechatUploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function submit() {
    if (!file) {
      setError("请先选一个 CSV 文件");
      return;
    }
    setError("");
    setMessage("");

    const form = new FormData();
    form.append("file", file);

    const response = await fetch("/api/imports/wechat", {
      method: "POST",
      body: form,
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      setError(payload?.error?.message || "导入失败");
      return;
    }
    setMessage(`导入完成，共 ${payload.data.total} 条`);
    router.refresh();
  }

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="wechatCsv">CSV 文件</label>
        <input id="wechatCsv" type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </div>
      {message ? <div className="help">{message}</div> : null}
      {error ? <div className="error-text">{error}</div> : null}
      <div className="btn-row">
        <button className="btn" type="button" disabled={isPending} onClick={() => startTransition(submit)}>
          {isPending ? "导入中..." : "开始导入"}
        </button>
      </div>
    </div>
  );
}
