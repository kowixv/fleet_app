/**
 * Tablet token authentication middleware.
 * Validates `Authorization: Bearer <token>` from tablet requests.
 * Resolves unit_id and organization_id from the tablet_tokens table.
 */

import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';

/** Tokens are stored hashed — a DB read never exposes live tablet credentials. */
export function hashTabletToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export type TabletAuthResult =
  | {
      ok: true;
      unitId: string;
      orgId: string;
      tokenId: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export async function authenticateTablet(req: Request): Promise<TabletAuthResult> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing or invalid Authorization header' };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { ok: false, status: 401, error: 'Empty token' };
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('tablet_tokens')
    .select('id, unit_id, organization_id, is_active')
    .eq('token_hash', hashTabletToken(token))
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 401, error: 'Invalid token' };
  }

  if (!data.is_active) {
    return { ok: false, status: 403, error: 'Token revoked' };
  }

  // Awaited on purpose: a floating promise gets dropped when the serverless
  // function freezes after the response, leaving "Son Aktiflik" stuck at
  // "never". A single indexed UPDATE is cheap enough to wait for.
  await supabase
    .from('tablet_tokens')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', data.id);

  return {
    ok: true,
    unitId: data.unit_id,
    orgId: data.organization_id,
    tokenId: data.id,
  };
}
