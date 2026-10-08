import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  if (command === 'build') {
    const url = env.VITE_SUPABASE_URL;
    const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Production configuration requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY).');
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('VITE_SUPABASE_URL must be a valid HTTPS URL.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('VITE_SUPABASE_URL must be a valid HTTPS URL without credentials.');
    let anonymousKey = false;
    if (key.startsWith('eyJ')) {
      try { anonymousKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { /* invalid key */ }
    }
    if (!key.startsWith('sb_publishable_') && !anonymousKey) throw new Error('The browser requires a Supabase publishable or anon key. Privileged keys are prohibited.');
  }
  return { plugins: [react()] };
});
