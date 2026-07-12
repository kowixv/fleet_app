"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ModeBadge } from "@/components/tracking/Badges";
import type { LocationPayload, TrackingMode } from "@/lib/tracking/types";

const TOKEN_KEY = "fleet_drive_token";
const DEVICE_KEY = "fleet_drive_device_id";
const MS_TO_MPH = 2.2369362920544;

// Minimal Wake Lock typings (not present in all TS DOM libs).
interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockNavigator {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
}

interface ActiveLoad {
  id: string;
  load_number: string | null;
  status: string;
  pickup_location: string | null;
  delivery_location: string | null;
}

/** Reads (and persists) a stable device id so the dashboard can label the tablet. */
function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export default function DriverTracker() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [tracking, setTracking] = useState(false);
  const [mode, setMode] = useState<TrackingMode | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [queueLen, setQueueLen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number; mph: number } | null>(null);
  const [activeLoad, setActiveLoad] = useState<ActiveLoad | null>(null);

  const queueRef = useRef<LocationPayload[]>([]);
  const sendingRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  // Resolve token from URL (?token=) or localStorage on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("token");
    const stored = localStorage.getItem(TOKEN_KEY);
    const t = fromUrl?.trim() || stored;
    if (t) {
      setToken(t);
      localStorage.setItem(TOKEN_KEY, t);
    }
    if (fromUrl) {
      // Scrub the secret from the address bar/history once it's stored —
      // shared screenshots and browser history shouldn't carry the token.
      params.delete("token");
      const rest = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }
  }, []);

  const fetchActiveLoad = useCallback(async (t: string) => {
    try {
      const res = await fetch("/api/tracking/active-load", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setActiveLoad(data.load ?? null);
    } catch {
      // Non-fatal — keep last known load.
    }
  }, []);

  const flush = useCallback(async (t: string) => {
    if (sendingRef.current || queueRef.current.length === 0) return;
    sendingRef.current = true;
    const batch = queueRef.current.slice(0, 50);
    try {
      const body = batch.length === 1 ? batch[0] : { batch };
      const res = await fetch("/api/tracking/location", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 401 || res.status === 403) {
          setError(`Token reddedildi (${res.status}). Token'ı kontrol edin.`);
        } else {
          setError(`Gönderim hatası (${res.status}): ${text.slice(0, 120)}`);
        }
        return; // keep queue for retry
      }
      const data = await res.json();
      queueRef.current = queueRef.current.slice(batch.length);
      setQueueLen(queueRef.current.length);
      if (data.mode) setMode(data.mode as TrackingMode);
      setLastSentAt(Date.now());
      setSentCount((c) => c + batch.length);
      setError(null);
    } catch {
      setError("Bağlantı yok — konumlar kuyrukta, geldiğinde gönderilecek.");
    } finally {
      sendingRef.current = false;
    }
  }, []);

  // Retry the queue periodically while tracking (covers offline → online).
  useEffect(() => {
    if (!tracking || !token) return;
    const id = setInterval(() => flush(token), 5000);
    return () => clearInterval(id);
  }, [tracking, token, flush]);

  // Refresh active load periodically while tracking.
  useEffect(() => {
    if (!tracking || !token) return;
    fetchActiveLoad(token);
    const id = setInterval(() => fetchActiveLoad(token), 30000);
    return () => clearInterval(id);
  }, [tracking, token, fetchActiveLoad]);

  async function requestWakeLock() {
    try {
      const nav = navigator as Navigator & WakeLockNavigator;
      if (nav.wakeLock) {
        wakeLockRef.current = await nav.wakeLock.request("screen");
      }
    } catch {
      // Wake lock is best-effort; ignore failures.
    }
  }

  function start() {
    if (!token) return;
    setError(null);
    if (!("geolocation" in navigator)) {
      setError("Bu cihaz/ tarayıcı konum erişimini desteklemiyor.");
      return;
    }
    const deviceId = getDeviceId();
    setTracking(true);
    requestWakeLock();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const mph = typeof c.speed === "number" && !Number.isNaN(c.speed) ? c.speed * MS_TO_MPH : 0;
        const heading =
          typeof c.heading === "number" && !Number.isNaN(c.heading) ? c.heading : undefined;
        const payload: LocationPayload = {
          latitude: c.latitude,
          longitude: c.longitude,
          speed: Math.max(0, mph),
          heading,
          accuracy: typeof c.accuracy === "number" ? c.accuracy : undefined,
          timestamp: new Date(pos.timestamp).toISOString(),
          device_id: deviceId,
        };
        setCoords({ lat: c.latitude, lng: c.longitude, mph: payload.speed });
        queueRef.current.push(payload);
        setQueueLen(queueRef.current.length);
        flush(token);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setError("Konum izni reddedildi. Tarayıcı ayarlarından izin verin.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError("Konum alınamıyor (GPS sinyali yok).");
        } else {
          setError(`Konum hatası: ${err.message}`);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }

  function stop() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    setTracking(false);
  }

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      wakeLockRef.current?.release().catch(() => {});
    };
  }, []);

  function disconnect() {
    stop();
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setActiveLoad(null);
    setMode(null);
    setCoords(null);
    setSentCount(0);
  }

  // ── Token entry screen ────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="card space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Sürücü Takip</h1>
          <p className="text-sm text-slate-500">
            Yöneticinizin verdiği tablet token'ını girin. (Genelde link ile otomatik gelir.)
          </p>
        </div>
        <input
          className="input"
          placeholder="Tablet token"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
        />
        <button
          className="btn-primary w-full"
          disabled={!tokenInput.trim()}
          onClick={() => {
            const t = tokenInput.trim();
            localStorage.setItem(TOKEN_KEY, t);
            setToken(t);
          }}
        >
          Bağlan
        </button>
      </div>
    );
  }

  // ── Tracking screen ───────────────────────────────────────────────────
  const lastSentLabel = lastSentAt
    ? `${Math.max(0, Math.round((Date.now() - lastSentAt) / 1000))} sn önce`
    : "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sürücü Takip</h1>
        <button onClick={disconnect} className="text-xs text-slate-400 hover:text-slate-600 underline">
          Token'ı değiştir
        </button>
      </div>

      {activeLoad ? (
        <div className="card">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Aktif Yük</div>
          <div className="mt-1 font-semibold">#{activeLoad.load_number ?? activeLoad.id.slice(0, 8)}</div>
          <div className="mt-1 text-sm text-slate-600">
            {activeLoad.pickup_location ?? "—"} → {activeLoad.delivery_location ?? "—"}
          </div>
        </div>
      ) : (
        <div className="card text-sm text-slate-500">Bu araca atanmış aktif yük yok.</div>
      )}

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Durum</span>
          <span className="flex items-center gap-2">
            {mode ? <ModeBadge mode={mode} /> : null}
            <span
              className={`badge ${tracking ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}
            >
              {tracking ? "Yayında" : "Durduruldu"}
            </span>
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Son gönderim</dt>
          <dd className="text-right font-medium">{lastSentLabel}</dd>
          <dt className="text-slate-500">Gönderilen</dt>
          <dd className="text-right font-medium">{sentCount}</dd>
          <dt className="text-slate-500">Kuyrukta</dt>
          <dd className="text-right font-medium">{queueLen}</dd>
          <dt className="text-slate-500">Hız</dt>
          <dd className="text-right font-medium">{coords ? `${coords.mph.toFixed(0)} mph` : "—"}</dd>
          <dt className="text-slate-500">Konum</dt>
          <dd className="text-right font-mono text-xs">
            {coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : "—"}
          </dd>
        </dl>

        {error && (
          <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {tracking ? (
          <button onClick={stop} className="btn-ghost w-full py-3 text-base">
            Durdur
          </button>
        ) : (
          <button onClick={start} className="btn-primary w-full py-3 text-base">
            Takibi Başlat
          </button>
        )}
        <p className="text-center text-xs text-slate-400">
          Bu ekran açık kalmalı. Konum yalnızca takip açıkken paylaşılır.
        </p>
      </div>
    </div>
  );
}
