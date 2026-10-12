import { setupTheme, type Palette } from './platform/theme';
import './style.css';
import { createGame, snapshot, step } from './simulation/state';
import type { GameState } from './simulation/types';
import type { ControlEvent } from './simulation/events';
import { FixedLoop } from './platform/loop';
import { KoSlowMotion } from './platform/slow-motion';
import { render } from './render/canvas';
import { HitFeedback } from './render/feedback';
import { setupAnimationPreview } from './debug/animation-preview';
import type { HitLevel } from './data/schema';
import { MOVES } from './data/schema';
import { Devices, saveJson, type Action } from './platform/devices';
import { setupSettings } from './platform/settings';
import { setupStage } from './platform/stage';
import { STAGE_IDS, drawStage, type StageId } from './render/stages';
import { markup, type LaunchMode } from './platform/markup';
import { inputLines, stateLine } from './debug/display';
import { createReplay, parseReplay, MAX_REPLAY_FRAMES, type Replay } from './debug/replay';
import type { DummyMode } from './debug/training';
import rules from './data/rules.json';
import { CpuPlayer } from './ai';
import { loadCpuSettings, saveCpuSettings, type Difficulty } from './ai/profiles';
import { neutralInput } from './input/types';
import { onLanguageChange, setupLanguageSwitch, t, translateDocument, type TranslationKey } from './platform/i18n';
import { setupOnline } from './net/session';
import { setupLobby } from './platform/lobby';
import { icon, type IconName } from './platform/icons';

const LAUNCH_KEY = 'stickman.launch';
const DUMMIES: DummyMode[] = ['stand','crouch','block','cpu'];
const SPECIAL_LABELS: Record<string, TranslationKey> = {
  tornado_mk:'preview.tornado', spin_hk:'preview.spinHk', spin_mk:'preview.spinMk',
  forward_spin_hk:'preview.forwardSpin', jumping_uppercut:'preview.uppercut', tornado_spin_combo:'preview.tornadoCombo',
};

async function main(): Promise<void> {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = markup;
  // Frame step, hitboxes, training, replay, animation preview and key binding stay available to smoke tests.
  const toolFlag = new URLSearchParams(location.search).get('tools');
  const showTools = toolFlag === '1' || (toolFlag !== '0' && navigator.webdriver);
  if (showTools) document.getElementById('dev-tools')!.hidden = false;
  document.documentElement.dataset.tools = String(showTools);
  const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const button = (id: string): HTMLButtonElement => element<HTMLButtonElement>(id);
  const canvas = element<HTMLCanvasElement>('game');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  setupLanguageSwitch(button('language'));
  translateDocument();
  let palette: Palette;
  let paintPreviews = (): void => {};
  setupTheme(button('theme'),colors=>{palette=colors;paintPreviews();});
  let stage: StageId;
  setupStage(document,selected=>{stage=selected;paintPreviews();});
  const devices = new Devices();
  await devices.loadConfiguration();
  let game = createGame();
  game.inputConfig = { socd: structuredClone(devices.config.socd), bufferFrames: devices.config.bufferFrames };
  let previous = snapshot(game);
  // Accessing localStorage itself can throw when persistence is disabled.
  const storage = { getItem:(key:string)=>window.localStorage.getItem(key), setItem:(key:string,value:string)=>window.localStorage.setItem(key,value) };
  const cpuSettings = loadCpuSettings(storage);
  let cpus: [CpuPlayer,CpuPlayer] = [new CpuPlayer(cpuSettings.playerOneDifficulty,0),new CpuPlayer(cpuSettings.difficulty,1)];
  const matchSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
  const resetCpus = () => { cpus[0].reset(matchSeed());cpus[1].reset(matchSeed()); };
  resetCpus();
  const cpuLevelOne = element<HTMLSelectElement>('cpu-level-0');
  const cpuLevel = element<HTMLSelectElement>('cpu-level');
  cpuLevelOne.value = cpuSettings.playerOneDifficulty;
  cpuLevel.value = cpuSettings.difficulty;
  const feedback = new HitFeedback();
  const preview = setupAnimationPreview(()=>{devices.clear();setPaused(true);});
  const loop = new FixedLoop();
  loop.paused = true;
  const slowMotion = new KoSlowMotion();
  let showBoxes = false, showInputs = false, showStates = false;
  let pendingEvents: ControlEvent[] = [];
  // Demo mode plays match after match: matchOver auto-restarts instead of waiting for Backspace.
  const DEMO_MATCH_HOLD = rules.hz * 3;
  let demoMatchOverFrames = 0;
  let recording: Replay | null = null;
  let lastReplay: Replay | null = null;
  let playback: { replay: Replay; index: number; returnState: GameState; returnKoFrames: number[]; returnRelaxFrames: number[]; returnLevels: (HitLevel | undefined)[] } | null = null;
  const message = (text: string) => { element('notice').textContent = text; };
  const session = setupOnline(() => updateUI());
  const lobby = setupLobby(session);
  const blockLocal = (): boolean => session.inRoom;
  const lobbyEl = element('lobby');
  const matchEl = element('match');
  const chatBar = element('match-chat');
  let view: 'lobby' | 'local' | 'online' = 'lobby';
  let pausedByFocus = false;

  /** Icon + label buttons; skips DOM writes when nothing changed because updateUI runs every frame. */
  function setLabel(target: HTMLButtonElement, name: IconName | null, label: string): void {
    const key = `${name}|${label}`;
    if (target.dataset.label === key) return;
    target.dataset.label = key;
    target.innerHTML = `${name ? icon(name) : ''}<span>${label}</span>`;
  }
  const radios = (name: string) => [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
  const radioValue = (name: string) => radios(name).find(input => input.checked)?.value;
  const setRadio = (name: string, value: string) => radios(name).forEach(input => { input.checked = input.value === value; });

  // Lobby launcher: mode, difficulty and dummy choices persist like the stage.
  let launchDummy: DummyMode = 'stand';
  let storedMode: LaunchMode | null = null;
  try {
    const saved = JSON.parse(localStorage.getItem(LAUNCH_KEY) ?? 'null');
    if (DUMMIES.includes(saved?.dummy)) launchDummy = saved.dummy;
    if (saved?.mode === 'training') storedMode = 'training';
  } catch { /* Fall back to defaults. */ }
  const initialMode: LaunchMode = storedMode ?? (cpuSettings.demo ? 'demo' : cpuSettings.enabled ? 'cpu' : 'versus');
  setRadio('launch-mode', initialMode);
  setRadio('launch-difficulty', cpuSettings.difficulty);
  setRadio('launch-dummy', launchDummy);
  const selectedMode = (): LaunchMode => (radioValue('launch-mode') as LaunchMode | undefined) ?? 'versus';
  function saveLaunch(): void {
    try { localStorage.setItem(LAUNCH_KEY, JSON.stringify({ mode: selectedMode(), dummy: launchDummy })); } catch { /* Session only. */ }
  }
  function syncLaunch(): void {
    const mode = selectedMode();
    document.querySelectorAll<HTMLElement>('[data-mode-row]').forEach(row => row.classList.toggle('active', row.dataset.modeRow === mode));
  }
  radios('launch-mode').forEach(input => input.addEventListener('change', () => { syncLaunch(); saveLaunch(); }));
  radios('launch-difficulty').forEach(input => input.addEventListener('change', () => {
    setRadio('launch-mode', 'cpu'); syncLaunch(); saveLaunch();
    cpuSettings.difficulty = input.value as Difficulty; cpuLevel.value = input.value;
    cpus[1] = new CpuPlayer(cpuSettings.difficulty, 1); saveCpuSettings(storage, cpuSettings);
  }));
  radios('launch-dummy').forEach(input => input.addEventListener('change', () => {
    launchDummy = input.value as DummyMode; setRadio('launch-mode', 'training'); syncLaunch(); saveLaunch();
  }));
  syncLaunch();

  // Live lobby preview: two CPUs spar on the selected stage; static when motion is reduced.
  const launchCanvas = element<HTMLCanvasElement>('launch-preview');
  let launchGame = createGame();
  const launchCpus: [CpuPlayer, CpuPlayer] = [new CpuPlayer('easy', 0), new CpuPlayer('easy', 1)];
  launchCpus[0].reset(matchSeed()); launchCpus[1].reset(matchSeed());
  let launchPrevious = snapshot(launchGame);
  let launchClock = 0;
  const thumbSource = document.createElement('canvas');
  thumbSource.width = 960; thumbSource.height = 420;
  function paintThumbs(): void {
    const ctx = thumbSource.getContext('2d')!;
    for (const id of STAGE_IDS) {
      const thumb = document.querySelector<HTMLCanvasElement>(`[data-stage-thumb="${id}"]`);
      if (!thumb) continue;
      drawStage(ctx, id, palette, 0);
      const target = thumb.getContext('2d')!;
      target.clearRect(0, 0, thumb.width, thumb.height);
      target.drawImage(thumbSource, 0, 40, 960, 380, 0, 0, thumb.width, thumb.height);
    }
  }
  function paintLaunch(alpha = 1): void {
    if (!palette || !stage) return;
    render(launchCanvas, launchGame, launchPrevious, alpha, false, false, palette, [], undefined, stage);
  }
  function advanceLaunch(time: number): void {
    if (lobbyEl.hidden || reducedMotion.matches) return;
    if (!launchClock) launchClock = time;
    let steps = 0;
    while (time - launchClock >= 1000 / rules.hz && steps < 4) {
      launchPrevious = snapshot(launchGame);
      step(launchGame, [launchCpus[0].next(launchGame), launchCpus[1].next(launchGame)]);
      launchClock += 1000 / rules.hz; steps++;
      if (launchGame.round.phase !== 'fighting') {
        launchGame = createGame(); launchPrevious = snapshot(launchGame);
        launchCpus[0].reset(matchSeed()); launchCpus[1].reset(matchSeed());
      }
    }
    if (time - launchClock > 250) launchClock = time;
    paintLaunch(Math.min(1, (time - launchClock) / (1000 / rules.hz)));
  }
  paintPreviews = () => { if (palette && stage) { paintThumbs(); paintLaunch(); } };
  paintPreviews();
  reducedMotion.addEventListener('change', () => paintLaunch());
  const spotlight = document.querySelector<HTMLElement>('.spotlight');
  spotlight?.addEventListener('pointermove', event => {
    const box = spotlight.getBoundingClientRect();
    spotlight.style.setProperty('--spot-x', `${event.clientX - box.left}px`);
    spotlight.style.setProperty('--spot-y', `${event.clientY - box.top}px`);
  });

  function showLobby(): void {
    view = 'lobby';
    lobbyEl.hidden = false;
    matchEl.hidden = true;
    chatBar.hidden = true;
    document.documentElement.dataset.view = 'lobby';
    launchClock = 0;
  }
  function showMatch(): void {
    lobbyEl.hidden = true;
    matchEl.hidden = false;
    chatBar.hidden = view !== 'online';
    document.documentElement.dataset.view = 'match';
    window.scrollTo({ top: 0 });
  }
  showLobby();

  const currentMode = (): LaunchMode => game.training.enabled ? 'training' : cpuSettings.demo ? 'demo' : cpuSettings.enabled ? 'cpu' : 'versus';
  function applyMode(mode: LaunchMode, dummy: DummyMode, restart: boolean): void {
    if (blockLocal()) return;
    if (playback) stopPlayback();
    const changed = mode !== currentMode() || (mode === 'training' && dummy !== game.training.dummy);
    cpuSettings.enabled = mode === 'cpu';
    cpuSettings.demo = mode === 'demo';
    saveCpuSettings(storage, cpuSettings);
    const trainingEvent = mode === 'training' ? changed || restart : game.training.enabled;
    if (trainingEvent) { devices.clear(); queue({ type:'training', enabled:mode === 'training', dummy:mode === 'training' ? dummy : game.training.dummy }); }
    else if (changed || restart) reset();
  }
  button('enter-local').onclick = () => {
    view = 'local'; showMatch(); setPaused(false);
    applyMode(selectedMode(), launchDummy, game.frame > 0);
    updateUI();
  };
  document.addEventListener('keydown', event => {
    if (lobbyEl.hidden || event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!(event.target as HTMLElement).closest('.launch input[type="radio"]')) return;
    event.preventDefault();
    button('enter-local').click();
  });
  function backToLobby(): void {
    if (session.inRoom) session.leave();
    showLobby();
    loop.paused = true;
    devices.clear();
    void session.refresh();
    updateUI();
    button('enter-local').focus({ preventScroll: true });
  }
  button('back-lobby').onclick = backToLobby;
  button('online-leave').onclick = backToLobby;

  // In-match opponent switch mirrors the lobby launcher.
  radios('play-mode').forEach(input => input.addEventListener('change', () => {
    const mode = input.value as LaunchMode;
    setRadio('launch-mode', mode); syncLaunch(); saveLaunch();
    applyMode(mode, launchDummy, false); updateUI();
  }));
  const matchDifficulty = element<HTMLSelectElement>('match-difficulty');
  const matchDummy = element<HTMLSelectElement>('match-dummy');
  matchDifficulty.onchange = () => { changeCpu(1, matchDifficulty.value as Difficulty); setRadio('launch-difficulty', matchDifficulty.value); updateUI(); };
  matchDummy.onchange = () => {
    launchDummy = matchDummy.value as DummyMode; setRadio('launch-dummy', launchDummy); saveLaunch();
    if (!blockLocal() && game.training.enabled) queue({ type:'training', enabled:true, dummy:launchDummy });
    updateUI();
  };

  const dummyName = (mode: DummyMode) => t(`dummy.${mode}`);
  const difficultyName = (difficulty: Difficulty) => t(`difficulty.${difficulty}`);
  let layout = new Map<string,string>();
  const keyNames: Record<string,string> = {ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Space:'␣',ShiftLeft:'⇧',ShiftRight:'⇧',ControlLeft:'Ctrl',ControlRight:'Ctrl'};
  const keyName = (code: string) => keyNames[code]??layout.get(code)?.toUpperCase()??code.replace('Key','').replace('Digit','').replace('Numpad','N').slice(0,5);
  function renderMoves(): void {
    const list = element('move-list');
    const moves = Object.values(MOVES).filter(move => move.command.type === 'hold' && SPECIAL_LABELS[move.id]).sort((a, b) => a.command.priority - b.command.priority || a.id.localeCompare(b.id));
    list.innerHTML = moves.map(move => {
      const forward = move.command.directions[0] === 6;
      const keys = (owner: number) => `<span class="combo" title="P${owner + 1}">${move.command.buttons.map(b => `<kbd class="p${owner + 1}" title="P${owner + 1} · ${b}">${keyName(devices.config.players[owner].keys[b as Action])}</kbd>`).join('')}</span>`;
      return `<li><span class="move-name">${t(SPECIAL_LABELS[move.id]).split(' · ')[0]}</span><span class="move-keys"><span class="dir-chip">${forward ? '→' : '←'} ${t(forward ? 'keys.forward' : 'keys.back')}</span><span class="plus">+</span>${keys(0)}<span class="sep">/</span>${keys(1)}</span></li>`;
    }).join('');
  }
  function refreshBindings(): void {
    document.querySelectorAll<HTMLElement>('[data-control]').forEach(key=>{
      const code=devices.config.players[Number(key.dataset.owner)].keys[key.dataset.control as Action];
      key.title=code;key.textContent=keyName(code);
    });
    renderMoves();
  }
  const keyboard=(navigator as Navigator & {keyboard?:{getLayoutMap:()=>Promise<Map<string,string>>}}).keyboard;
  keyboard?.getLayoutMap().then(map=>{layout=map;refreshBindings();}).catch(()=>{});
  refreshBindings();

  function setPaused(paused: boolean): void { if (blockLocal()) return; loop.paused = paused; loop.reset(); previous = snapshot(game); if (!paused) pausedByFocus = false; }
  function stopPlayback(): void {
    if (!playback) return;
    game = playback.returnState; feedback.levels=[...playback.returnLevels]; feedback.koFrames=[...playback.returnKoFrames]; feedback.relaxFrames=[...playback.returnRelaxFrames]; previous = snapshot(game); playback = null; slowMotion.reset(); loop.timeScale=1;
    devices.clear(); setPaused(true); message(t('message.localReturn'));
  }
  function runFrame(): void {
    previous = snapshot(game);
    if (playback) {
      const entry = playback.replay.frames[playback.index];
      if (!entry) { setPaused(true); return; }
      step(game,entry.inputs,entry.events);
      if(entry.events.some(e=>e.type==='reset'||e.type==='training'))feedback.reset(game);
      feedback.update(game,previous);playback.index++;
      if (playback.index === playback.replay.frames.length) { setPaused(true); message(t('message.replayEnded')); }
    } else {
      const inputs = devices.sample(), events = pendingEvents; pendingEvents = [];
      const restarting = events.some(e=>e.type==='reset'||e.type==='training');
      if (restarting) resetCpus();
      const trainingCpu = game.training.enabled && game.training.dummy === 'cpu';
      const demoActive = cpuSettings.demo && !game.training.enabled;
      const cpuControlsOpponent = trainingCpu || (!game.training.enabled && cpuSettings.enabled) || demoActive;
      if (demoActive) inputs[0] = restarting ? neutralInput() : cpus[0].next(game);
      if (cpuControlsOpponent) inputs[1] = restarting ? neutralInput() : cpus[1].next(game);
      else if ((cpuSettings.enabled || cpuSettings.demo) && game.training.enabled) inputs[1] = neutralInput();
      if (recording) {
        recording.frames.push(structuredClone({ inputs,events }));
        if (recording.frames.length >= MAX_REPLAY_FRAMES) { lastReplay=recording; recording=null; message(t('message.recordingLimit')); }
      }
      step(game,inputs,events);
      if(events.some(e=>e.type==='reset'||e.type==='training'))feedback.reset(game);
      feedback.update(game,previous);
      if (events.some(e=>e.type==='reset'||e.type==='training')) previous=snapshot(game);
      if (demoActive && game.round.phase === 'matchOver') {
        if (++demoMatchOverFrames >= DEMO_MATCH_HOLD) { demoMatchOverFrames = 0; pendingEvents.push({ type:'reset' }); }
      } else demoMatchOverFrames = 0;
    }
    if (previous.round.phase !== 'fighting' && game.round.phase === 'fighting') { previous = snapshot(game);feedback.reset(game); }
    loop.timeScale=slowMotion.update(game,feedback.koFrames);
  }
  function queue(event: ControlEvent): void {
    if (session.inRoom) { if (event.type === 'reset') session.reset(); return; }
    if (playback) stopPlayback();
    pendingEvents.push(event);
    if (loop.paused) { runFrame(); previous=snapshot(game); }
  }
  function togglePause(): void {
    if (blockLocal()) return;
    if (playback && playback.index === playback.replay.frames.length) { game=snapshot(playback.replay.initial); feedback.reset(game);playback.index=0; }
    setPaused(!loop.paused);
  }
  function reset(): void { if (session.inRoom) { session.reset(); return; } devices.clear(); queue({type:'reset'}); loop.reset(); }
  function rematch(): void { reset(); if (!showTools) setPaused(false); }
  function changeCpu(player: 0 | 1, difficulty: Difficulty): void {
    if (blockLocal()) return;
    if (playback || (game.training.enabled && game.training.dummy !== 'cpu')) return;
    if(player===0)cpuSettings.playerOneDifficulty=difficulty;else cpuSettings.difficulty=difficulty;
    cpus[player]=new CpuPlayer(difficulty,player);saveCpuSettings(storage,cpuSettings);reset();
  }
  function toggleCpu(): void {
    if (blockLocal() || playback || game.training.enabled) return;
    cpuSettings.enabled=!cpuSettings.enabled;cpuSettings.demo=false;saveCpuSettings(storage,cpuSettings);reset();
  }
  function toggleDemo(): void {
    if (blockLocal() || playback || game.training.enabled) return;
    cpuSettings.demo=!cpuSettings.demo;cpuSettings.enabled=false;saveCpuSettings(storage,cpuSettings);reset();
  }
  cpuLevelOne.onchange=()=>{changeCpu(0,cpuLevelOne.value as Difficulty);updateUI();};
  cpuLevel.onchange=()=>{changeCpu(1,cpuLevel.value as Difficulty);updateUI();};
  function toggleTraining(): void { if (blockLocal()) return; queue({type:'training',enabled:!game.training.enabled,dummy:game.training.dummy}); }
  function changeDummy(): void {
    if (blockLocal() || !game.training.enabled) return;
    queue({type:'training',enabled:true,dummy:DUMMIES[(DUMMIES.indexOf(game.training.dummy)+1)%DUMMIES.length]});
  }
  function toggleRecord(): void {
    if (blockLocal()) return;
    if (playback) stopPlayback();
    if (recording) { lastReplay=recording; recording=null; message(t('message.recordingSaved',{frames:lastReplay.frames.length})); }
    else { recording=createReplay(game); message(t('message.recordingStarted')); }
  }
  function toggleReplay(): void {
    if (blockLocal()) return;
    if (playback) { stopPlayback(); return; }
    if (recording) { lastReplay=recording; recording=null; }
    if (!lastReplay?.frames.length) { message(t('message.replayMissing')); return; }
    playback={replay:parseReplay(lastReplay),index:0,returnState:snapshot(game),returnKoFrames:[...feedback.koFrames],returnRelaxFrames:[...feedback.relaxFrames],returnLevels:[...feedback.levels]};
    game=snapshot(playback.replay.initial); feedback.reset(game);previous=snapshot(game); pendingEvents=[]; slowMotion.reset(); loop.timeScale=1; devices.clear(); setPaused(false);
    message(t('message.replayRunning'));
  }
  function singleStep(): void { if (blockLocal()) return; if(loop.paused) { runFrame(); previous=snapshot(game); } }
  const actions: Record<string,()=>void> = {
    pause:togglePause, step:singleStep, reset,
    boxes:()=>showBoxes=!showBoxes, inputs:()=>showInputs=!showInputs, states:()=>showStates=!showStates,
    training:toggleTraining, dummy:changeDummy, record:toggleRecord, play:toggleReplay,
    cpu:toggleCpu, demo:toggleDemo,
  };
  for (const [id,action] of Object.entries(actions)) button(id).onclick=()=>{ action(); updateUI(); };
  button('export-replay').onclick=()=>{ const replay=recording??lastReplay; if(replay)saveJson('stickman-replay.json',replay); };
  button('import-replay').onclick=()=>{ setPaused(true); element<HTMLInputElement>('replay-file').click(); };
  element<HTMLInputElement>('replay-file').onchange=async event=>{
    const input=event.target as HTMLInputElement;
    try {
      const file=input.files?.[0]; if(!file)return;
      if(file.size>64*1024*1024)throw Error(t('message.replayTooLarge'));
      const imported=parseReplay(JSON.parse(await file.text()));
      if(playback)stopPlayback();
      if(recording){recording=null;}
      lastReplay=imported;message(t('message.replayLoaded',{frames:imported.frames.length}));
    } catch(error) { message(String(error)); }
    finally { input.value='';updateUI(); }
  };

  // Arena overlay: pause and match-over actions for players, waiting states online.
  type Overlay = 'none' | 'pause' | 'over' | 'waiting' | 'reconnecting';
  const overlayEl = element('arena-overlay');
  const overlayPrimary = button('overlay-primary'), overlaySecondary = button('overlay-secondary'), overlayLobby = button('overlay-lobby');
  let overlay: Overlay = 'none', overlayKey = '';
  overlayPrimary.onclick = () => { if (overlay === 'pause') togglePause(); else if (overlay === 'over') rematch(); updateUI(); };
  overlaySecondary.onclick = () => { if (overlay === 'pause') rematch(); updateUI(); };
  overlayLobby.onclick = backToLobby;
  function paintOverlay(next: Overlay): void {
    const key = `${next}|${session.roomName}|${document.documentElement.lang}`;
    const wasHidden = overlayEl.hidden;
    overlay = next;
    overlayEl.hidden = next === 'none';
    if (key === overlayKey) return;
    overlayKey = key;
    overlayEl.dataset.kind = next;
    if (next === 'none') return;
    const online = next === 'waiting' || next === 'reconnecting';
    element('overlay-title').textContent = next === 'pause' ? t('banner.pause') : next === 'over' ? t('banner.restart') : next === 'waiting' ? t('online.waiting') : t('online.reconnecting');
    element('overlay-hint').textContent = next === 'pause' ? t('match.pausedHint') : next === 'over' ? t('match.overHint') : next === 'waiting' ? t('match.waitingHint', { room: session.roomName }) : '';
    overlayPrimary.hidden = online;
    if (!online) setLabel(overlayPrimary, next === 'pause' ? 'play' : 'restart', t(next === 'pause' ? 'match.resume' : 'match.rematch'));
    overlaySecondary.hidden = next !== 'pause';
    setLabel(overlaySecondary, 'restart', t('button.reset'));
    setLabel(overlayLobby, online ? 'logOut' : 'arrowLeft', t(online ? 'match.leaveRoom' : 'lobby.back'));
    if (wasHidden && !online && (!document.activeElement || document.activeElement === document.body)) overlayPrimary.focus({ preventScroll: true });
  }

  const pollSettings=setupSettings(devices,()=>{refreshBindings();queue({type:'inputConfig',config:{socd:structuredClone(devices.config.socd),bufferFrames:devices.config.bufferFrames}});},message);
  element('settings-details').addEventListener('toggle',event=>{ if(!session.inRoom && (event.target as HTMLDetailsElement).open)setPaused(true); });
  document.addEventListener('click',event=>{ if(!matchEl.hidden && (event as MouseEvent).detail>0 && (event.target as HTMLElement).closest('button,.opponent-bar label'))requestAnimationFrame(()=>(document.activeElement as HTMLElement)?.blur()); });
  let pointerAt=0;
  document.addEventListener('pointerdown',()=>{pointerAt=performance.now();});
  element('opponent-bar').addEventListener('change',event=>{ if(performance.now()-pointerAt<1500)(event.target as HTMLElement).blur(); });
  const hotkeys: Record<string,string> = { KeyP:'pause',Escape:'pause',Period:'step',Backspace:'reset',F1:'boxes',F2:'inputs',F3:'states',F4:'training',F5:'dummy',F6:'record',F7:'play',F8:'cpu',F9:'demo' };
  window.addEventListener('keydown',event=>{
    if(matchEl.hidden)return;
    const target=event.target as HTMLElement;
    if(target.closest('#animation-preview'))return;
    if(event.repeat || devices.capture)return;
    if(target.matches('input,select,textarea') && !(event.code==='Escape' && target.matches('select,input[type=radio]')))return;
    if(devices.config.players.some(p=>Object.values(p.keys).includes(event.code)))return;
    if(event.code==='Escape' && element<HTMLDetailsElement>('settings-details').open)return;
    if(event.code==='Enter' || event.code==='NumpadEnter') {
      if(target.closest('button,summary,a'))return;
      if(overlay==='over'){event.preventDefault();rematch();updateUI();}
      else if(overlay==='pause'){event.preventDefault();togglePause();updateUI();}
      return;
    }
    const action=hotkeys[event.code];if(!action || (!showTools && action!=='reset' && action!=='pause'))return;
    event.preventDefault();if(session.inRoom && !['reset','boxes','inputs','states'].includes(action))return;
    if(action==='reset' && !showTools)rematch();else actions[action]();
    updateUI();
  });
  const resumePlay = () => { if (!showTools && !session.inRoom && !matchEl.hidden && pausedByFocus) setPaused(false); };
  const pauseForFocus = () => { if (!loop.paused) { setPaused(true); pausedByFocus = true; } };
  window.addEventListener('blur',()=>{devices.clear();if(session.inRoom)session.sendLocalInput(devices);else if(!matchEl.hidden){pauseForFocus();if(showTools)message(t('message.focusLost'));}});
  window.addEventListener('focus',resumePlay);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){devices.clear();if(session.inRoom)session.sendLocalInput(devices);else if(!matchEl.hidden) pauseForFocus();}
    else resumePlay();
  });
  window.addEventListener('gamepaddisconnected',()=>{devices.clear();if(session.inRoom)session.sendLocalInput(devices);else if(!matchEl.hidden){if(showTools)setPaused(true);else pauseForFocus();message(t('message.controllerLost'));}});

  // Online chat: rendered from the session's log.
  const chatLog = element('online-log');
  const chatInput = element<HTMLInputElement>('online-chat');
  let chatCount = -1, chatLang = '';
  function renderChat(): void {
    const lang = document.documentElement.lang;
    if (session.chat.length === chatCount && lang === chatLang) return;
    chatCount = session.chat.length; chatLang = lang;
    chatLog.replaceChildren();
    if (!session.chat.length) { const empty = document.createElement('p'); empty.className = 'chat-empty'; empty.textContent = t('match.chatEmpty'); chatLog.append(empty); return; }
    for (const line of session.chat) {
      const row = document.createElement('p');
      row.className = line.system ? 'chat-line system' : 'chat-line';
      const name = document.createElement('strong'); name.textContent = line.name;
      const text = document.createElement('span'); text.textContent = line.text;
      row.append(name, text);
      chatLog.append(row);
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  element<HTMLFormElement>('chat-form').addEventListener('submit', event => {
    event.preventDefault();
    session.sendChat(chatInput.value);
    chatInput.value = '';
  });
  session.subscribe(renderChat);

  function paintOnline(): void {
    if (!session.inRoom) return;
    const waiting = session.waiting;
    element('match-status').textContent = session.reconnecting ? t('online.reconnecting') : waiting ? t('online.waiting') : t('online.live');
    element('p1-label').textContent = (session.names[0] || 'P1').toUpperCase();
    element('p2-label').textContent = (session.names[1] || '…').toUpperCase();
    element('arena-mode').textContent = t('arena.onlineMode', { caption: t(`stage.caption.${stage}`), you: t('online.you', { seat: session.seat + 1 }) });
    element('cpu-debug').hidden = true;
    for (const id of ['pause','step','training','dummy','cpu','demo','record','play','import-replay','export-replay']) button(id).disabled = true;
    setLabel(button('pause'), 'pause', t('button.pause'));
    cpuLevel.disabled = true; cpuLevelOne.disabled = true;
  }
  function updateUI(): void {
    if (session.inRoom) {
      if (view !== 'online') { view = 'online'; showMatch(); }
      chatBar.hidden = false;
    } else if (view === 'online') {
      showLobby();
      loop.paused = true;
    }
    lobby.syncNet();
    const online = view === 'online';
    button('online-leave').hidden = !online;
    element('opponent-bar').hidden = online;
    button('pause').hidden = online;
    const local = game;
    if (session.inRoom && session.presentation.ready) game = session.presentation.game;
    const trainingCpu=game.training.enabled && game.training.dummy==='cpu';
    const cpuActive=cpuSettings.enabled && !game.training.enabled && !playback;
    const demoActive=cpuSettings.demo && !game.training.enabled && !playback;
    const cpuPresent=cpuActive || trainingCpu || demoActive;
    button('cpu').disabled=game.training.enabled || !!playback;
    button('demo').disabled=game.training.enabled || !!playback;
    cpuLevelOne.disabled=!!playback || game.training.enabled;
    cpuLevel.disabled=!!playback || (game.training.enabled && !trainingCpu);
    button('cpu').setAttribute('aria-pressed',String(cpuActive || trainingCpu));
    button('demo').setAttribute('aria-pressed',String(demoActive));
    button('cpu').textContent=trainingCpu?t('cpu.trainingDummy'):game.training.enabled?t('cpu.trainingPriority'):playback?t('cpu.replayPriority'):t('training.cpu',{state:t(cpuActive?'common.on':'common.off')});
    button('demo').textContent=game.training.enabled?t('demo.trainingPriority'):playback?t('demo.replayPriority'):t('training.demo',{state:t(demoActive?'common.on':'common.off')});
    element('p1-label').textContent=demoActive?t('fighter.cpuNumber',{id:'01'}):t('fighter.player',{id:'01'});
    element('p2-label').textContent=demoActive?t('fighter.cpuNumber',{id:'02'}):cpuPresent?t('fighter.cpu'):t('fighter.player',{id:'02'});
    const demoLevels=t('levels.vs',{left:difficultyName(cpuSettings.playerOneDifficulty).toUpperCase(),right:difficultyName(cpuSettings.difficulty).toUpperCase()});
    const statusMode=playback?t('status.replay'):trainingCpu?t('status.trainingCpu',{difficulty:difficultyName(cpuSettings.difficulty).toUpperCase()}):game.training.enabled?t('status.training'):demoActive?t('status.demo',{levels:demoLevels}):cpuActive?t('status.vsCpu',{difficulty:difficultyName(cpuSettings.difficulty).toUpperCase()}):t('status.local');
    element('match-status').textContent=statusMode;
    element('cpu-debug').hidden=!cpuPresent;
    element('cpu-debug').textContent=demoActive
      ? cpus.map((cpu,i)=>`CPU ${i+1}: ${cpu.debug.reason}${cpu.debug.kind==='attack'?' '+cpu.debug.moveId:''} (${cpu.debug.score.toFixed(2)})`).join('\n')
      : cpuPresent?`CPU 2: ${cpus[1].debug.reason}${cpus[1].debug.kind==='attack'?' '+cpus[1].debug.moveId:''} (${cpus[1].debug.score.toFixed(2)})`:'';
    setLabel(button('pause'), loop.paused?'play':'pause', t(loop.paused?'button.continue':'button.pause'));
    button('pause').setAttribute('aria-pressed', String(loop.paused));
    button('pause').disabled=false;
    button('step').disabled=!loop.paused;
    button('boxes').setAttribute('aria-pressed',String(showBoxes));
    button('inputs').setAttribute('aria-pressed',String(showInputs));
    button('states').setAttribute('aria-pressed',String(showStates));
    button('training').setAttribute('aria-pressed',String(game.training.enabled));
    button('dummy').disabled=!game.training.enabled;
    button('dummy').textContent=t('training.dummy',{mode:dummyName(game.training.dummy)});
    button('record').textContent=t(recording?'button.stopRecord':'button.record');
    button('record').setAttribute('aria-pressed',String(!!recording));
    button('play').disabled=!playback&&!lastReplay?.frames.length&&!recording?.frames.length;
    button('play').textContent=t(playback?'button.leaveReplay':'button.replay');
    button('export-replay').disabled=!(recording??lastReplay)?.frames.length;
    for (const id of ['training','record','import-replay']) button(id).disabled=false;
    element('debug').hidden=!showStates; element('input-history').hidden=!showInputs;
    if (!online) {
      const mode = currentMode();
      radios('play-mode').forEach(input => { input.checked = input.value === mode; input.disabled = !!playback; });
      matchDifficulty.hidden = !(mode === 'cpu' || trainingCpu);
      matchDifficulty.value = cpuSettings.difficulty;
      matchDifficulty.disabled = !!playback;
      matchDummy.hidden = mode !== 'training';
      if (document.activeElement !== matchDummy) matchDummy.value = game.training.dummy;
    }
    for(const f of game.fighters) {
      for(const name of ['revenge','special'] as const) {
        const resource=f.resources[name], track=element(`resource-${f.id}-${name}`);
        element(`resource-value-${f.id}-${name}`).textContent=`${resource.current} / ${resource.max}`;
        track.setAttribute('aria-valuenow',String(resource.current));track.setAttribute('aria-valuemax',String(resource.max));
        (track.firstElementChild as HTMLElement).style.width=`${resource.current/resource.max*100}%`;
        track.classList.toggle('full', resource.current >= resource.max);
      }
      element(`hp-${f.id}`).textContent=`${f.hp} / ${rules.maxHealth}`;
      const bar=element(`health-${f.id}`);bar.style.width=`${f.hp/rules.maxHealth*100}%`;bar.parentElement!.setAttribute('aria-valuenow',String(f.hp));
      bar.parentElement!.classList.toggle('low', f.hp <= rules.maxHealth * .25);
      const wins=element(`wins-${f.id}`), winKey=`${game.round.wins[f.id]}`;
      if(wins.dataset.wins!==winKey){wins.dataset.wins=winKey;wins.innerHTML=Array.from({length:rules.winsRequired},(_,i)=>`<span class="${game.round.wins[f.id]>i?'won':''}"></span>`).join('');}
      element(`state-${f.id}`).textContent=`${stateLine(f)}\n${t('state.inputFrame')} ${game.frame} · ${t('state.combatFrame')} ${game.combatFrame} · ${t('state.hitstop',{frames:game.hitstop})}`;
      if(showInputs)element(`input-${f.id}`).textContent=inputLines(f);
    }
    element('timer').textContent=game.training.enabled?'∞':String(Math.ceil(game.round.timer/rules.hz)).padStart(2,'0');
    element('timer').classList.toggle('urgent', !game.training.enabled && game.round.phase==='fighting' && game.round.timer <= rules.hz*10);
    element('round-label').textContent=game.training.enabled?t('hud.training'):t('hud.round',{round:String(game.round.number).padStart(2,'0')});
    const caption=t(`stage.caption.${stage}`);
    element('arena-mode').textContent=playback?t('arena.replay',{index:playback.index,total:playback.replay.frames.length}):recording?t('arena.rec',{frames:recording.frames.length}):trainingCpu?t('arena.trainingCpu',{difficulty:difficultyName(cpuSettings.difficulty).toUpperCase()}):game.training.enabled?t('arena.trainingDummy',{dummy:dummyName(game.training.dummy).toUpperCase()}):demoActive?t('arena.demo',{caption,levels:demoLevels}):cpuActive?t('arena.cpu',{caption,difficulty:difficultyName(cpuSettings.difficulty).toUpperCase()}):t('arena.local',{caption});
    canvas.dataset.frame=String(game.frame);canvas.dataset.ready='true';
    paintOnline();
    const matchOver = game.round.phase === 'matchOver';
    paintOverlay(matchEl.hidden ? 'none'
      : online ? (session.reconnecting ? 'reconnecting' : session.waiting ? 'waiting' : 'none')
      : showTools || playback ? 'none'
      : loop.paused ? 'pause'
      : matchOver && !demoActive ? 'over' : 'none');
    game = local;
  }
  onLanguageChange(()=>{translateDocument();for(const b of document.querySelectorAll<HTMLElement>('[data-label]'))delete b.dataset.label;renderMoves();overlayKey='';updateUI();});
  function frame(time: number): void {
    let alpha: number;
    let shown = game, prior = previous, levels = feedback.levels, ko = feedback.koFrames, relax = feedback.relaxFrames, paused = loop.paused;
    if (session.connected) {
      session.sendLocalInput(devices);
      alpha = session.presentation.sync(Date.now());
      if (session.presentation.ready) {
        shown = session.presentation.game; prior = session.presentation.previous;
        levels = session.presentation.feedback.levels; ko = session.presentation.feedback.koFrames; relax = session.presentation.feedback.relaxFrames;
      }
      paused = false;
    } else alpha = loop.advance(time, runFrame);
    if (!matchEl.hidden) {
      render(canvas,shown,prior,paused?1:alpha,paused,showBoxes,palette,levels,ko,stage,!session.inRoom && cpuSettings.demo && !game.training.enabled,relax);
      preview(time,palette);
    } else advanceLaunch(time);
    pollSettings();updateUI();requestAnimationFrame(frame);
  }
  button('enter-local').disabled = false;
  document.documentElement.dataset.app = 'ready';
  updateUI();requestAnimationFrame(frame);
}

void main().catch(error=>{
  const app=document.querySelector('#app')!;
  app.innerHTML=`<div class="boot-error" role="alert"><strong></strong><p></p><button class="btn primary" type="button"></button></div>`;
  app.querySelector('strong')!.textContent=t('app.errorTitle');
  app.querySelector('p')!.textContent=t('message.startFailed',{error:String(error)});
  const reload=app.querySelector('button')!;reload.textContent=t('app.reload');reload.onclick=()=>location.reload();
});
