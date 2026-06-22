import { timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison for secrets (webhook / cron tokens).
 * Avoids leaking secret length/prefix via early-exit timing.
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Resolves how to treat a missing endpoint secret. In production a missing secret
 * is a misconfiguration and must fail closed; in development we allow it so local
 * testing of the webhook/cron is possible without secrets.
 */
export function secretMisconfigured(secret: string | undefined): boolean {
  return !secret && process.env.NODE_ENV === "production";
}
