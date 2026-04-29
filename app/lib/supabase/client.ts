import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isSupabaseUploadConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getBrowserSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase upload is not configured.');
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}
