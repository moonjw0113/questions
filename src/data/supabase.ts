import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
function isPublicKey(value: string) {
  if (value.startsWith('sb_publishable_')) return true;
  try {
    const encoded = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(encoded)).role === 'anon';
  } catch {
    return false;
  }
}
export const configured = Boolean(url && /^https:\/\/[^/]+/.test(url) && key && isPublicKey(key));
export const supabase = configured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
