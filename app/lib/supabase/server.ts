import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const WEB_UPLOAD_BUCKET =
  process.env.SUPABASE_UPLOAD_BUCKET || process.env.NEXT_PUBLIC_SUPABASE_UPLOAD_BUCKET || 'birdbrain-uploads';
export const WEB_UPLOAD_MAX_BYTES = Number(process.env.BIRDBRAIN_WEB_UPLOAD_MAX_BYTES || 100 * 1024 * 1024);

export function isServerSupabaseConfigured() {
  return Boolean(supabaseUrl && serviceRoleKey);
}

export function getServerSupabase() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase server credentials are not configured.');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
