"use client";

import { useState, useEffect } from "react";

interface TabletToken {
  id: string;
  unit_id: string;
  device_label: string;
  device_id: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
  vehicles: { unit_number: string; vehicle_type: string } | null;
}

interface Vehicle {
  id: string;
  unit_number: string;
}

export default function TabletManagement({ vehicles }: { vehicles: Vehicle[] }) {
  const [tokens, setTokens] = useState<TabletToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [copied, setCopied] = useState(false);

  // Base URL for the driver page link. Prefer the configured public app URL
  // (HTTPS — works on a phone); fall back to the current origin.
  const driveBase =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const driveLink = newToken ? `${driveBase}/drive?token=${newToken}` : "";

  async function copyDriveLink() {
    try {
      await navigator.clipboard.writeText(driveLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked — the link is selectable in the box.
    }
  }

  async function fetchTokens() {
    const res = await fetch("/api/admin/tablet-pair");
    if (res.ok) {
      const data = await res.json();
      setTokens(data.tokens ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { fetchTokens(); }, []);

  async function handleCreate() {
    if (!selectedUnit) return;
    setCreating(true);
    setNewToken(null);
    try {
      const res = await fetch("/api/admin/tablet-pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit_id: selectedUnit, device_label: deviceLabel || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewToken(data.token.token);
        setSelectedUnit("");
        setDeviceLabel("");
        await fetchTokens();
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(tokenId: string) {
    if (!confirm("Revoke this tablet token? The tablet will stop sending updates.")) return;
    await fetch("/api/admin/tablet-pair", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token_id: tokenId }),
    });
    await fetchTokens();
  }

  async function handleDelete(tokenId: string) {
    if (!confirm("Bu token kalıcı olarak silinecek, geri alınamaz. Devam edilsin mi?")) return;
    const res = await fetch("/api/admin/tablet-pair", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token_id: tokenId, hard: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "Token silinemedi.");
      return;
    }
    await fetchTokens();
  }

  function timeAgo(ts: string | null) {
    if (!ts) return "never";
    const min = Math.round((Date.now() - new Date(ts).getTime()) / 60_000);
    if (min < 2) return "just now";
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    return `${h}h ago`;
  }

  return (
    <div className="space-y-4">
      <h2 className="font-semibold">Tablet Yönetimi</h2>
      <p className="text-sm text-slate-500">
        Her tableta bir token üretin. Token'ı tablette Fleet Tablet uygulamasına girin.
        Token sadece atandığı unit'i günceller.
      </p>

      {/* Create form */}
      <div className="rounded-xl border border-slate-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Yeni Tablet Token</h3>
        <div className="flex gap-3 flex-wrap">
          <select
            value={selectedUnit}
            onChange={(e) => setSelectedUnit(e.target.value)}
            className="input flex-1 min-w-40"
          >
            <option value="">Araç seç…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>Unit {v.unit_number}</option>
            ))}
          </select>
          <input
            value={deviceLabel}
            onChange={(e) => setDeviceLabel(e.target.value)}
            placeholder="Label (isteğe bağlı)"
            className="input flex-1 min-w-40"
          />
          <button
            onClick={handleCreate}
            disabled={!selectedUnit || creating}
            className="btn-primary whitespace-nowrap"
          >
            {creating ? "Oluşturuluyor…" : "Token Oluştur"}
          </button>
        </div>

        {newToken && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-3">
            <p className="text-xs font-semibold text-green-700 mb-1">
              ✅ Token oluşturuldu — tablete kopyalayın. Bir daha gösterilmez.
            </p>
            <code className="block text-sm font-mono bg-white border border-green-200 rounded p-2 select-all break-all">
              {newToken}
            </code>
            <p className="text-xs font-semibold text-green-700 mt-3 mb-1">
              📱 Sürücü linki — telefonda açın (HTTPS gerekir, konum için):
            </p>
            <div className="flex gap-2 items-start">
              <code className="block flex-1 text-xs font-mono bg-white border border-green-200 rounded p-2 select-all break-all">
                {driveLink}
              </code>
              <button onClick={copyDriveLink} className="btn-ghost whitespace-nowrap text-xs">
                {copied ? "Kopyalandı ✓" : "Kopyala"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Token list */}
      {loading ? (
        <p className="text-sm text-slate-400">Yükleniyor…</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-slate-400">Henüz tablet token yok.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Araç</th>
                <th className="px-4 py-2 text-left">Label</th>
                <th className="px-4 py-2 text-left">Durum</th>
                <th className="px-4 py-2 text-left">Son Aktiflik</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tokens.map((t) => (
                <tr key={t.id} className={t.is_active ? "" : "opacity-40"}>
                  <td className="px-4 py-2 font-medium">
                    Unit {t.vehicles?.unit_number ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{t.device_label}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      t.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}>
                      {t.is_active ? "Active" : "Revoked"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500 text-xs">{timeAgo(t.last_seen_at)}</td>
                  <td className="px-4 py-2">
                    {t.is_active ? (
                      <button
                        onClick={() => handleRevoke(t.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Revoke
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Sil
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
