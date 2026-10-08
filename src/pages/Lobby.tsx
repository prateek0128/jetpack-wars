import { unlockAudio } from '../presentation/audio';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLobby } from '../hooks/useLobby';
import { supabase } from '../multiplayer/client';
import { leaveRoom, setReady, startMatch } from '../multiplayer/rooms';

export default function Lobby() {
  const { roomCode } = useParams(); const { room, loading, error, connected, refresh } = useLobby(roomCode); const navigate = useNavigate();
  const [playerId, setPlayerId] = useState(''); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => () => { if (copyTimer.current !== null) window.clearTimeout(copyTimer.current); }, []);
  useEffect(()=>{void supabase?.auth.getUser().then(({data})=>{const id=data.user?.id||''; setPlayerId(id); if(id) sessionStorage.setItem('jw-lobby-player-id',id);});},[]);
  useEffect(()=>{ if(room && room.match_state && room.match_state !== 'LOBBY') { sessionStorage.setItem('jw-match-room', room.code); navigate('/play',{replace:true}); } },[room?.match_state,navigate]);
  async function act(fn:()=>Promise<unknown>) { unlockAudio(); setBusy(true); setNotice(''); try { await fn(); await refresh(); } catch(e) { setNotice(e instanceof Error?e.message:'Action failed.'); } finally { setBusy(false); } }
  async function copyCode() { try { await navigator.clipboard.writeText(room?.code || roomCode || ''); setCopied(true); if (copyTimer.current !== null) window.clearTimeout(copyTimer.current); copyTimer.current = window.setTimeout(()=>setCopied(false),1500); } catch { setNotice('Could not copy the room code.'); } }
  async function exit() { setBusy(true); try { await leaveRoom(); sessionStorage.removeItem('jw-lobby-player-id'); navigate('/'); } catch(e) { setNotice(e instanceof Error?e.message:'Could not leave room.'); } finally { setBusy(false); } }
  const self = room?.players.find(p=>p.player_id===playerId); const isHost = !!room && room.host_player_id===playerId; const count=room?.players.length||0; const canStart=count>=2 && !!room?.players.every(p=>p.is_ready);
  return <main className="lobby-page"><div className="landing-grid"/><header className="lobby-top"><Link to="/" className="mini-brand"><span>JW</span> JETPACK WARS</Link><div className={`lobby-connection ${connected?'online':''}`}><i/>{connected?'LOBBY CONNECTED':'CONNECTING'}</div><button className="lobby-leave" onClick={exit} disabled={busy}>LEAVE ROOM</button></header><section className="lobby-shell">
    {loading?<div className="lobby-loading">ESTABLISHING SECURE LINK…</div>:!room?<div className="room-card lobby-error-card"><div className="eyebrow"><span/> LINK NOT FOUND</div><h1>ROOM<br/><em>UNAVAILABLE</em></h1><p>{error}</p><Link className="play-button" to="/join">BACK TO JOIN <b>↗</b></Link></div>:<>
      <div className="lobby-heading"><div><div className="eyebrow"><span/> PRIVATE SQUAD ROOM · {room.status}</div><h1>FLIGHT<br/><em>BRIEFING</em></h1></div><div className="room-code-panel"><small>ROOM CODE</small><strong>{room.code}</strong><button onClick={copyCode}>{copied?'COPIED':'COPY CODE'} <span>▣</span></button></div></div>
      <div className="lobby-roster-head"><span>PILOTS <b>{count}/{room.max_players}</b></span><span>READY STATUS</span></div><div className="lobby-roster">{room.players.map((pilot,index)=><div className="lobby-pilot" key={pilot.player_id}><span className="pilot-index">{String(index+1).padStart(2,'0')}</span><span className="pilot-avatar">{pilot.display_name.slice(0,1).toUpperCase()}</span><span className="pilot-name">{pilot.display_name}{pilot.player_id===playerId&&<small> YOU</small>}</span>{pilot.player_id===room.host_player_id&&<span className="host-badge">HOST</span>}<span className={`ready-badge ${pilot.is_ready?'ready':''}`}><i/>{pilot.is_ready?'READY':'NOT READY'}</span></div>)}{Array.from({length:Math.max(0,Math.min(8,room.max_players)-count)},(_,i)=><div className="lobby-pilot vacant" key={`vacant-${i}`}><span className="pilot-index">{String(count+i+1).padStart(2,'0')}</span><span className="pilot-avatar">＋</span><span className="pilot-name">OPEN SLOT</span><span className="ready-badge">AWAITING PILOT</span></div>)}</div>
      <div className="lobby-bottom"><div className="lobby-status">{count<2?'Waiting for at least 2 players.':!room.players.every(p=>p.is_ready)?'Waiting for all pilots to ready up.':'All pilots ready. Clear for launch.'}<small>Ready up together · the host starts the match</small></div><div className="lobby-actions"><button className={`ready-button ${self?.is_ready?'selected':''}`} disabled={busy||!self} onClick={()=>void act(()=>setReady(!self?.is_ready))}>{self?.is_ready?'UNREADY':'READY UP'} <b>{self?.is_ready?'✓':'↗'}</b></button>{isHost&&<button className="start-button" disabled={busy||!canStart} onClick={()=>void act(()=>startMatch())}>{busy?'STARTING…':'START MATCH'} <b>▶</b></button>}</div></div>
      {(notice||error)&&<div className="room-error lobby-notice">{notice||error}</div>}
      <div className="lobby-phase-note">FREE-FOR-ALL · 5 MINUTES · OWN THE AIR</div>
    </>}
  </section></main>
}
