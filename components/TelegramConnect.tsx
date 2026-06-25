"use client";

import { useState } from "react";
import { createTelegramPairingCode } from "@/app/(app)/settings/actions";

export default function TelegramConnect() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ code: string; link: string | null } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const r = await createTelegramPairingCode();
      setResult(r);
    } catch (e: any) {
      setError(e?.message ?? "Kod oluşturulamadı.");
    } finally {
      setLoading(false);
    }
  }

  async function copyCode() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked; the code is visible on screen regardless.
    }
  }

  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">Telegram&apos;ı Bağla</h2>
      <p className="mb-3 text-sm text-slate-500">
        Tek dokunuşla bir Telegram sohbetini (özel veya grup) bu hesaba bağlayın. Chat ID
        kopyalamanıza gerek yok.
      </p>

      <button type="button" onClick={generate} disabled={loading} className="btn-primary">
        {loading ? "Oluşturuluyor…" : "Bağlantı Kodu Oluştur"}
      </button>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-4 space-y-3 rounded-lg border border-slate-200 p-4">
          {result.link && (
            <div>
              <p className="mb-1 text-sm font-medium">Özel sohbet için:</p>
              <a href={result.link} target="_blank" rel="noopener noreferrer" className="btn-primary inline-block">
                Telegram&apos;da Aç
              </a>
              <p className="mt-1 text-xs text-slate-500">
                Linke dokunup <b>Başlat</b>&apos;a basın — sohbet otomatik bağlanır.
              </p>
            </div>
          )}

          <div>
            <p className="mb-1 text-sm font-medium">Grup için:</p>
            <p className="text-sm text-slate-600">
              Botu gruba ekleyin (admin yapın), sonra gruba şunu yazın:
            </p>
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded bg-slate-900 px-3 py-1.5 text-sm text-slate-100">
                /pair {result.code}
              </code>
              <button type="button" onClick={copyCode} className="btn-ghost text-sm">
                {copied ? "Kopyalandı ✓" : "Kodu Kopyala"}
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-400">Kod 15 dakika geçerli ve tek kullanımlıktır.</p>
        </div>
      )}
    </div>
  );
}
