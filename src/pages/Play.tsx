import { usePresentation } from '../hooks/usePresentation';
import { WEAPONS } from '../game/weapons';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GameScene from '../components/GameScene';
import { useGameState } from '../hooks/useGameState';
import { useMultiplayerGame } from '../hooks/useMultiplayerGame';
import { returnToLobby, startMatch } from '../multiplayer/rooms';

function clock(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
export default function Play() {
  const game = useGameState();
  const multiplayer = useMultiplayerGame(game);
  const navigate = useNavigate();
  const state = game.snapshot;
  const roomPlayers = multiplayer.session?.players.filter((player) => player.is_active) ?? [];
  const [aiming, setAiming] = useState(false);
  useEffect(() => {
    const lock = () => setAiming(document.pointerLockElement !== null);
    const fallback = (event: Event) => setAiming((event as CustomEvent<{ active: boolean }>).detail.active);
    document.addEventListener('pointerlockchange', lock);
    window.addEventListener('game-aim-state', fallback);
    return () => { document.removeEventListener('pointerlockchange', lock); window.removeEventListener('game-aim-state', fallback); };
  }, []);
  useEffect(() => {
    const input = (event: KeyboardEvent) => {
      if (event.repeat || game.snapshot.hp <= 0 || (multiplayer.session && multiplayer.session.match.match_state !== 'ACTIVE')) return;
      if (event.code === 'KeyR') { if (multiplayer.session) multiplayer.reloadAuthoritative(); else game.reload(); }
      const weapon = event.code === 'Digit1' ? 'VX9' : event.code === 'Digit2' ? 'SH8' : null;
      if (weapon) { if (multiplayer.session) multiplayer.switchAuthoritative(weapon); else game.switchWeapon(weapon); }
    };
    window.addEventListener('keydown', input);
    return () => window.removeEventListener('keydown', input);
  }, [game.reload, game.switchWeapon, game.snapshot.hp, multiplayer.session, multiplayer.reloadAuthoritative, multiplayer.switchAuthoritative]);

  const deathFlashVisible = state.deathAt > 0 && performance.now() - state.deathAt < 720;
  const match = multiplayer.session?.match;
  const matchState = match?.match_state ?? 'LOBBY';
  useEffect(() => {
    if (multiplayer.lobbyRoomCode) navigate(`/lobby/${multiplayer.lobbyRoomCode}`, { replace: true });
  }, [multiplayer.lobbyRoomCode, navigate]);
  useEffect(() => {
    if (multiplayer.session && matchState === 'LOBBY') {
      navigate(`/lobby/${multiplayer.session.room_code}`, { replace: true });
    }
  }, [matchState, multiplayer.session?.game_id, multiplayer.session?.room_code, navigate]);
  const serverNow = Date.now() + multiplayer.serverOffsetMs;
  const countdown = match?.countdown_ends_at ? Math.max(0, Math.ceil((Date.parse(match.countdown_ends_at) - serverNow) / 1000)) : 0;
  const matchTime = match?.ends_at ? Math.max(0, (Date.parse(match.ends_at) - serverNow) / 1000) : 300;
  const presentation = usePresentation(game, multiplayer.localPlayerId, Boolean(multiplayer.session), matchState, countdown);
  const scoreboard = useMemo(() => {
    const players = multiplayer.session?.players ?? [];
    return players.map((player) => ({
      player_id: player.player_id,
      display_name: player.display_name,
      kills: player.kills,
      deaths: player.deaths,
      score: player.kills,
      is_active: player.is_active,
    })).sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.player_id.localeCompare(b.player_id));
  }, [multiplayer.session?.players]);
  const isHost = multiplayer.session?.players.find((player) => player.player_id === multiplayer.localPlayerId)?.player_id === multiplayer.session?.host_player_id;
  const [matchActionBusy, setMatchActionBusy] = useState(false);
  const [matchActionError, setMatchActionError] = useState('');
  async function runMatchAction(action: () => Promise<unknown>, returnToLobbyPage = false) {
    setMatchActionBusy(true); setMatchActionError('');
    try {
      const result = await action();
      if (returnToLobbyPage && result && typeof result === 'object' && 'code' in result) {
        const room = result as { code: string };
        await multiplayer.refreshSession();
        navigate(`/lobby/${room.code}`, { replace: true });
      } else await multiplayer.refreshSession();
    } catch (error) { setMatchActionError(error instanceof Error ? error.message : 'Match action failed.'); }
    finally { setMatchActionBusy(false); }
  }

  return <main className={`game-screen ${state.hp>0 && state.hp<35 ? 'low-health' : ''} ${state.hp>0 && state.hp<20 ? 'critical-health' : ''} ${state.hp===0 ? 'player-dead' : ''}`}>
    <GameScene game={game} session={multiplayer.session} localPlayerId={multiplayer.localPlayerId} motionMap={multiplayer.motionMap} matchActive={matchState === 'ACTIVE'} fireAuthoritative={multiplayer.fireAuthoritative} reloadAuthoritative={multiplayer.reloadAuthoritative}/>
    <div className="game-vignette"/><div className="health-vignette" aria-hidden="true"/>
    <button className="sound-toggle" onClick={presentation.toggleSound} aria-pressed={!presentation.muted} aria-label={presentation.muted ? 'Turn sound on' : 'Mute sound'}>{presentation.muted ? 'SOUND OFF' : 'SOUND ON'}</button>
    <header className="game-header">
      <Link to="/" className="mini-brand"><span>JW</span> JETPACK WARS</Link>
      <div className="match-state"><i/> {multiplayer.session ? <>{matchState} <b>•</b> ROOM {multiplayer.session.room_code} <b>•</b> {roomPlayers.length}/8 PILOTS</> : multiplayer.loading || multiplayer.connection === 'RECONNECTING' ? 'RECOVERING MATCH SESSION' : multiplayer.matchDetected ? 'MULTIPLAYER SESSION UNAVAILABLE' : 'SOLO TRAINING'} </div>
      <div className={`timer ${matchState === 'ACTIVE' && matchTime <= 30 ? 'urgent' : ''}`}><small>{multiplayer.session ? 'MATCH TIME' : 'TIME'}</small><strong>{clock(multiplayer.session ? matchTime : state.timeLeft)}</strong></div>
    </header>
    {(multiplayer.session||multiplayer.matchDetected)&&<div className={`network-status ${multiplayer.connection.toLowerCase()}`}><i/>{multiplayer.connection}</div>}
    {multiplayer.session&&<div className="multiplayer-roster"><small>PLAYERS <b>{roomPlayers.length}/8</b></small>{roomPlayers.map((player)=><span key={player.player_id}>{player.display_name}{player.player_id===multiplayer.localPlayerId&&<><b>YOU</b><i/></>}</span>)}</div>}
    {multiplayer.session&&<section className="match-leaderboard" aria-label="Live scoreboard"><div className="leaderboard-title">JETPACK WARS <span>LIVE SCORE</span></div><div className="leaderboard-columns"><span>PLAYER</span><span title="Kills">K</span><span title="Deaths">D</span><span>SCORE</span></div>{scoreboard.map((player,index)=><div className={`leaderboard-row ${player.player_id===multiplayer.localPlayerId?'local':''}`} key={player.player_id}><span><i>{String(index+1).padStart(2,'0')}</i>{player.display_name}{player.player_id===multiplayer.localPlayerId&&<b>YOU</b>}</span><span>{player.kills}</span><span>{player.deaths}</span><strong>{player.score}</strong></div>)}</section>}
    <div className="hud-top-left">
      <div className="hud-label">VITALS <span>{state.hp}<small> / 100</small></span></div>
      <div className="meter hp"><i style={{ width: `${state.hp}%` }}/></div>
      <div className="hud-label fuel-label">JET FUEL <small className="fuel-state">{presentation.fuelStatus}</small><span>{Math.round(state.fuel)}<small> / 100</small></span></div>
      <div className={`meter fuel ${`${state.fuel < 20 ? 'low' : ''} ${presentation.fuelStatus === 'RECOVERING' ? 'recovering' : ''}`}`}><i style={{ width: `${state.fuel}%` }}/></div>
    </div>
    <div className="hud-top-right">
      <div className="stat"><small>ELIMINATIONS</small><b>{String(state.kills).padStart(2, '0')}</b></div>
      <div className="stat"><small>FALLEN</small><b>{String(state.deaths).padStart(2, '0')}</b></div>
    </div>
    <div className={`crosshair ${presentation.firing ? 'firing' : ''} ${state.weapon==='SH8' ? 'scatter' : ''} ${presentation.hit ? 'confirmed' : ''}`} aria-hidden="true"><i/><i/><i/><i/><b/></div>
    <div className={`hit-marker ${presentation.hit ? 'active' : ''}`} aria-hidden="true"><i/><i/><i/><i/></div>
    <div className={`weapon-hud ${presentation.switching ? 'switching' : ''} ${presentation.loaded ? 'loaded' : ''}`}>
      <div className="weapon-symbol">⌁</div>
      <div className="weapon-name"><small>{WEAPONS[state.weapon].name} · {WEAPONS[state.weapon].type}</small><span>{state.reloading ? 'RELOADING' : <span className="weapon-slots"><b className={state.weapon === 'VX9' ? 'selected' : ''}>[1] VX-9</b> / <b className={state.weapon === 'SH8' ? 'selected' : ''}>[2] SH-8</b></span>}</span></div>
      <div className="ammo"><strong>{String(state.ammo).padStart(2, '0')}</strong><span> / {WEAPONS[state.weapon].magazine}</span></div>
      {state.reloading&&<div className="reload-progress" role="progressbar" aria-label="Reloading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.reloadProgress*100)}><i style={{width:`${state.reloadProgress*100}%`}}/></div>}
    </div>
    <div className="controls-hint"><kbd>WASD / Arrow Keys</kbd> MOVE <kbd>SPACE</kbd> BOOST · DOUBLE TAP FOR BURST <kbd>LMB</kbd> FIRE <kbd>R</kbd> RELOAD <kbd>1 / 2</kbd> WEAPON</div>
    <div className="center-notice">
      {!aiming && state.hp > 0 && <span>CLICK TO AIM · ESC TO RELEASE</span>}
      {state.hp === 0 && <div className="respawn-notice"><strong>ELIMINATED</strong><small>RESPAWNING</small><b key={presentation.respawnCount}>{presentation.respawnCount||'…'}</b></div>}
    </div>
    {presentation.elimination&&<div className="elimination-toast" role="status"><small>ELIMINATION +1</small><strong>{presentation.elimination}</strong></div>}
    {presentation.damageDirection!==null&&<div className="damage-direction" style={{transform:`translate(-50%,-50%) rotate(${presentation.damageDirection}deg)`}} aria-hidden="true"><i/></div>}
    <div className="kill-feed" aria-label="Recent eliminations">{presentation.feed.map(entry=><div className={entry.local?'local':''} key={entry.id}><b>{entry.killer}</b><span>eliminated</span><b>{entry.victim}</b></div>)}</div>
    {presentation.respawnFlash&&<div className="respawn-flash" aria-hidden="true"/>}
    {presentation.respawnFlash&&<div className="spawn-go">GO</div>}
    {presentation.go&&<div className="match-go" aria-hidden="true">GO</div>}
    {state.hitFlash > 0 && <div className="damage-flash"/>}
    {deathFlashVisible && <div className="death-flash"/>}
    {multiplayer.session&&matchState==='COUNTDOWN'&&<div className="countdown-overlay"><small>MATCH STARTING</small><strong key={countdown}>{countdown || 'GO'}</strong><span>GET READY, PILOT</span></div>}
    {multiplayer.session&&['FINISHED','RESULTS'].includes(matchState)&&<div className="results-backdrop"><section className="results-card"><div className="eyebrow"><span/> MATCH COMPLETE</div><h1>{match?.winner_player_id ? <><small>{match.winner_player_id===multiplayer.localPlayerId?'VICTORY':'DEFEAT'}</small>{match.winner_name ?? scoreboard.find((row)=>row.player_id===match.winner_player_id)?.display_name}</> : <><small>FINAL RESULT</small>DRAW</>}</h1>{match?.winner_player_id&&<p className="winner-score">{scoreboard.find(player=>player.player_id===match.winner_player_id)?.kills ?? 0} ELIMINATIONS</p>}<div className="results-heading"><span>FINAL SCOREBOARD</span><span>KILLS&nbsp;&nbsp; DEATHS&nbsp;&nbsp; SCORE</span></div>{scoreboard.map((player,index)=><div className={`results-row ${player.player_id===multiplayer.localPlayerId?'local':''}`} key={player.player_id}><b>{index+1}</b><span>{player.display_name}{player.player_id===multiplayer.localPlayerId&&<small> YOU</small>}</span><strong>{player.kills}<i>{player.deaths}</i>{player.score}</strong></div>)}{matchActionError&&<p className="results-error">{matchActionError}</p>}<div className="results-actions">{isHost&&<button disabled={matchActionBusy} onClick={()=>void runMatchAction(startMatch)}>{matchActionBusy?'PREPARING…':'PLAY AGAIN'} <b>↻</b></button>}{isHost&&<button className="secondary" disabled={matchActionBusy} onClick={()=>void runMatchAction(returnToLobby, true)}>RETURN TO LOBBY <b>↗</b></button>}{!isHost&&<p>WAITING FOR THE HOST TO CHOOSE THE NEXT FLIGHT</p>}</div></section></div>}
    <button className="exit-button" onClick={() => { document.exitPointerLock?.(); window.location.href = '/'; }}>EXIT SIM</button>
  </main>;
}
