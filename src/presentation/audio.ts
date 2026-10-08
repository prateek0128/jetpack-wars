// Original procedural sound; no files, downloads, backend settings, or background music.
export type Sound = 'VX9' | 'SH8' | 'hit' | 'damage' | 'reload' | 'loaded' | 'switch' | 'burst' | 'landing' | 'elimination' | 'death' | 'respawn' | 'countdown' | 'start' | 'end';
let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let jet: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let voices=0;
let muted = false;
try { muted = localStorage.getItem('jw-muted') === 'true'; } catch { /* storage may be unavailable */ }
export function isMuted() { return muted; }
export function setMuted(value: boolean) {
  muted = value;
  try { localStorage.setItem('jw-muted', String(value)); } catch { /* preference remains in memory */ }
  if (master && context) master.gain.setTargetAtTime(value ? 0 : 0.23, context.currentTime, 0.025);
}
export function unlockAudio() {
  try {
    if (!context) {
      context = new AudioContext(); master = context.createGain(); master.gain.value = muted ? 0 : 0.23; master.connect(context.destination);
      noise = context.createBuffer(1, context.sampleRate * 0.4, context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
  } catch { /* gameplay remains available when browser audio is unavailable */ }
}
function tone(hz: number, end: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0) {
  if (!context || !master || muted || voices>=16 || context.state !== 'running') return;
  voices++;
  const time = context.currentTime + delay;
  const oscillator = context.createOscillator(); const gain = context.createGain();
  oscillator.type = type; oscillator.frequency.setValueAtTime(hz, time); oscillator.frequency.exponentialRampToValueAtTime(Math.max(20,end),time+duration);
  gain.gain.setValueAtTime(0.001,time); gain.gain.exponentialRampToValueAtTime(volume,time+0.006); gain.gain.exponentialRampToValueAtTime(0.001,time+duration);
  oscillator.connect(gain); gain.connect(master); oscillator.start(time); oscillator.stop(time+duration+0.02);
  oscillator.onended = () => { voices--; oscillator.disconnect(); gain.disconnect(); };
}
function noisePulse(duration: number, volume: number, frequency: number) {
  if (!context || !master || !noise || muted || voices>=16 || context.state !== 'running') return;
  voices++;
  const source=context.createBufferSource(), gain=context.createGain(), filter=context.createBiquadFilter();
  source.buffer=noise; filter.type='lowpass'; filter.frequency.value=frequency;
  gain.gain.setValueAtTime(volume,context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001,context.currentTime+duration);
  source.connect(filter);filter.connect(gain);gain.connect(master);source.start();source.stop(context.currentTime+duration);
  source.onended=()=>{voices--;source.disconnect();filter.disconnect();gain.disconnect();};
}
export function jetSound(active: boolean) {
  if (!active) { if (jet) { jet.source.stop(); jet=null; } return; }
  if (jet || !context || !master || !noise || context.state !== 'running') return;
  const source=context.createBufferSource(), gain=context.createGain(), filter=context.createBiquadFilter();
  source.buffer=noise;source.loop=true;filter.type='bandpass';filter.frequency.value=420;filter.Q.value=0.6;gain.gain.value=0.11;
  source.connect(filter);filter.connect(gain);gain.connect(master);source.start();jet={source,gain};
  source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
}
export function sound(effect: Sound) {
  switch(effect) {
    case 'VX9': noisePulse(0.07,0.55,3300);tone(190,65,0.09,0.4,'triangle'); break;
    case 'SH8': noisePulse(0.18,0.8,1900);tone(95,32,0.2,0.65,'triangle'); break;
    case 'hit': tone(1250,1700,0.055,0.22); break;
    case 'damage': noisePulse(0.09,0.16,700);tone(140,70,0.11,0.15); break;
    case 'reload': tone(330,200,0.065,0.17,'triangle');tone(480,320,0.07,0.12,'triangle',0.1); break;
    case 'loaded': tone(780,1050,0.08,0.15); break;
    case 'switch': tone(460,680,0.06,0.12,'triangle'); break;
    case 'burst': noisePulse(0.22,0.4,1600);tone(180,400,0.18,0.12); break;
    case 'landing': noisePulse(0.09,0.2,600); break;
    case 'elimination': tone(750,900,0.12,0.23);tone(1120,1450,0.18,0.2,'sine',0.08);break;
    case 'death': tone(190,45,0.35,0.22,'triangle');break;
    case 'respawn': tone(320,1100,0.24,0.17);break;
    case 'countdown': tone(700,700,0.075,0.18);break;
    case 'start': tone(900,1600,0.22,0.22);break;
    case 'end': tone(500,620,0.18,0.18);tone(750,900,0.25,0.15,'sine',0.16);break;
  }
}
