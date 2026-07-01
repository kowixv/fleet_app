/**
 * Tablet token authentication middleware.
 * Validates `Authorization: Bearer <token>` from tablet requests.
 * Resolves unit_id and organization_id from the tablet_tokens table.
 */

import { createServiceClient } from '@/lib/supabase/server';

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
    .eq('token', token)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 401, error: 'Invalid token' };
  }

  if (!data.is_active) {
    return { ok: false, status: 403, error: 'Token revoked' };
  }

  // Update last_seen_at without blocking the response
  supabase
    .from('tablet_tokens')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return {
    ok: true,
    unitId: data.unit_id,
    orgId: data.organization_id,
    tokenId: data.id,
  };
}
