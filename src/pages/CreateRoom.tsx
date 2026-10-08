import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createRoom } from '../multiplayer/rooms';
import { supabaseConfigured } from '../multiplayer/client';

function savedName() { try { return localStorage.getItem('jw-display-name') || ''; } catch { return ''; } }
export default function CreateRoom() {
  const [name, setName] = useState(savedName()); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const navigate = useNavigate();
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { localStorage.setItem('jw-display-name', name.trim()); } catch { /* callsign still works without saved preferences */ } try { const room = await createRoom(name.trim()); navigate(`/lobby/${room.code}`); } catch (err) { setError(err instanceof Error ? err.message : 'Could not create room.'); } finally { setBusy(false); } }
  return <main className="room-page"><div className="landing-grid"/><Link className="room-back" to="/">← JETPACK WARS</Link><section className="room-card"><div className="eyebrow"><span/> PILOT CHECK-IN</div><h1>CREATE<br/><em>ROOM</em></h1><p>Set your callsign. You’ll be the host for this flight.</p><form onSubmit={submit}><label htmlFor="pilot-name">CALLSIGN</label><input id="pilot-name" maxLength={24} minLength={1} placeholder="e.g. SKYRUNNER" value={name} onChange={e=>setName(e.target.value)} required autoComplete="nickname"/><button className="play-button" disabled={busy || !supabaseConfigured}>{busy?'OPENING ROOM…':'CREATE ROOM'} <b>↗</b></button></form>{!supabaseConfigured&&<div className="room-error">Multiplayer is temporarily unavailable. Please try again later.</div>}{error&&<div className="room-error">{error}</div>}<div className="room-footnote">ANONYMOUS PILOT ID · NO EMAIL REQUIRED</div></section></main>
}
