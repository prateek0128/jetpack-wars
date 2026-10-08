import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);
export const supabase = supabaseConfigured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export async function requirePlayer() {
  if (!supabase) throw new Error('Multiplayer is temporarily unavailable. Please try again later.');
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error('Unable to recover your pilot session. Please try again.');
  if (session) return session.user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error('Unable to sign in to the game service. Please try again.');
  return data.user;
}
