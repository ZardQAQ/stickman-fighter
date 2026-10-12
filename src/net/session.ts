import { snapshot, createGame } from '../simulation/state';
import type { GameState } from '../simulation/types';
import type { Devices } from '../platform/devices';
import { HitFeedback } from '../render/feedback';
import { onLanguageChange, t } from '../platform/i18n';
import { applySnap, FRAME_MS, rawToWire, type NetSnap, type WireInput } from './snapshot';

const INTERP_MS = 50;
const SNAP_KEEP = 24;
const NAME_KEY = 'stickman.onlineName';
const TOKEN_KEY = 'stickman.onlineToken';
const ROOM_KEY = 'stickman.onlineRoom';
const POLL_MS = 4000;

interface Welcome {
  t: 'w'; id: number; token: string; roomId: string; roomName: string;
}
interface EventMsg { t: 'e'; k: string; name?: string; text?: string }
export interface RoomInfo { id: string; name: string; count: number; max: number; locked: boolean; official: boolean; host?: string }
export type RoomsPhase = 'loading' | 'ready' | 'error';
export type StatusTone = 'info' | 'error';
export interface ChatLine { name: string; text: string; system: boolean }

export class Presentation {
  game: GameState = createGame();
  previous: GameState = snapshot(this.game);
  feedback = new HitFeedback();
  ready = false;
  latest: NetSnap | null = null;
  private snaps: NetSnap[] = [];
  private applied = -1;
  private offset: number | null = null;

  reset(): void {
    this.game = createGame();
    this.previous = snapshot(this.game);
    this.feedback.reset(this.game);
    this.ready = false;
    this.latest = null;
    this.snaps = [];
    this.applied = -1;
    this.offset = null;
  }

  push(snap: NetSnap): void {
    const off = Date.now() - snap.st;
    if (this.offset === null || off < this.offset) this.offset = off;
    this.latest = snap;
    this.snaps.push(snap);
    if (this.snaps.length > SNAP_KEEP) this.snaps.shift();
  }

  /** Apply due authoritative frames and return the render blend toward the newest one. */
  sync(now: number): number {
    const latest = this.latest;
    if (!latest) return 0;
    if (latest.waiting) {
      this.previous = snapshot(this.game);
      applySnap(this.game, latest);
      if (!this.ready) this.feedback.reset(this.game);
      this.ready = true;
      this.applied = latest.frame;
      this.previous = snapshot(this.game);
      return 1;
    }
    const renderAt = now - (this.offset ?? 0) - INTERP_MS;
    let steps = 0;
    for (const snap of this.snaps) {
      if (snap.waiting || snap.frame <= this.applied || snap.st > renderAt) continue;
      if (steps >= 8) break;
      this.previous = snapshot(this.game);
      applySnap(this.game, snap);
      if (!this.ready) this.feedback.reset(this.game);
      else this.feedback.update(this.game, this.previous);
      this.ready = true;
      this.applied = snap.frame;
      steps++;
    }
    const curr = this.snaps.find(snap => snap.frame === this.applied);
    const next = this.snaps.find(snap => snap.frame > this.applied);
    if (!curr) return 1;
    const span = Math.max(1, (next?.st ?? curr.st + FRAME_MS) - curr.st);
    return Math.max(0, Math.min(1, (renderAt - curr.st) / span));
  }
}

export interface OnlineSession {
  /** Seated in a room with a live socket. */
  readonly connected: boolean;
  /** Seated, or holding the seat while the socket reconnects. */
  readonly inRoom: boolean;
  readonly reconnecting: boolean;
  /** A join request is in flight. */
  readonly joining: string | null;
  readonly waiting: boolean;
  readonly names: [string, string];
  readonly seat: number;
  readonly roomId: string;
  readonly roomName: string;
  readonly presentation: Presentation;
  readonly rooms: RoomInfo[];
  readonly roomsPhase: RoomsPhase;
  readonly refreshing: boolean;
  readonly status: { text: string; tone: StatusTone };
  readonly chat: ChatLine[];
  sendLocalInput(devices: Devices): void;
  reset(): void;
  leave(): void;
  refresh(): Promise<void>;
  join(roomId: string, password: string): void;
  create(name: string, password: string): Promise<boolean>;
  sendChat(text: string): void;
  setStatus(text: string, tone?: StatusTone): void;
  subscribe(listener: () => void): () => void;
}

export function setupOnline(onActivity: () => void): OnlineSession {
  const presentation = new Presentation();
  const nameInput = document.getElementById('online-name') as HTMLInputElement;
  const listeners = new Set<() => void>();
  let ws: WebSocket | null = null;
  let epoch = 0;
  let welcomed = false;
  let seated = false;
  let reconnect = false;
  let joining: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seat = -1;
  let roomId = sessionStorage.getItem(ROOM_KEY) || 'official';
  let roomName = '';
  let password = '';
  let token = sessionStorage.getItem(TOKEN_KEY) ?? '';
  let lastWire = '';
  let lastSent = 0;
  let rooms: RoomInfo[] = [];
  let roomsPhase: RoomsPhase = 'loading';
  let refreshing = false;
  let status: { text: string; tone: StatusTone } = { text: '', tone: 'info' };
  let statusKey: Parameters<typeof t>[0] | null = null;
  const chat: ChatLine[] = [];

  let storedName = '';
  try { storedName = localStorage.getItem(NAME_KEY) ?? ''; } catch { /* Storage denied. */ }
  nameInput.value = storedName || `P${Math.floor(100 + Math.random() * 900)}`;

  function notify(): void {
    for (const listener of listeners) listener();
    onActivity();
  }
  function nick(): string {
    const name = nameInput.value.replace(/[<>]/g, '').trim().slice(0, 12);
    return name || 'Player';
  }
  function setStatus(text: string, tone: StatusTone = 'info', key: Parameters<typeof t>[0] | null = null): void {
    status = { text, tone };
    statusKey = key;
    notify();
  }
  function chatLine(name: string, text: string, system = false): void {
    chat.push({ name, text, system });
    if (chat.length > 40) chat.shift();
    notify();
  }
  function fail(text: string): void {
    reconnect = false;
    joining = null;
    seated = false;
    if (timer) { clearTimeout(timer); timer = null; }
    token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    setStatus(text, 'error');
  }
  function send(payload: unknown): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }
  function hello(): void {
    send({ t: 'hello', name: nick(), roomId, password, token });
  }
  function open(): void {
    const mine = ++epoch;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try { ws = new WebSocket(`${proto}//${location.host}/ws`); }
    catch { schedule(); return; }
    const socket = ws;
    socket.onopen = () => { if (mine === epoch) hello(); };
    socket.onmessage = event => {
      if (mine !== epoch) return;
      let msg: Welcome | EventMsg | NetSnap;
      try { msg = JSON.parse(String(event.data)) as Welcome | EventMsg | NetSnap; } catch { return; }
      if (msg.t === 'w') {
        welcomed = true;
        seated = true;
        joining = null;
        seat = msg.id;
        token = msg.token;
        roomId = msg.roomId;
        roomName = msg.roomName;
        sessionStorage.setItem(TOKEN_KEY, token);
        sessionStorage.setItem(ROOM_KEY, roomId);
        try { localStorage.setItem(NAME_KEY, nick()); } catch { /* Storage denied. */ }
        setStatus('');
        return;
      }
      if (msg.t === 's') { presentation.push(msg); return; }
      if (msg.t !== 'e') return;
      if (msg.k === 'full' || msg.k === 'erauth') { fail(msg.text || t(msg.k === 'full' ? 'online.full' : 'online.missing')); socket.close(); return; }
      if (msg.k === 'chat' && msg.name && msg.text) chatLine(msg.name, msg.text, msg.name === '系统');
      if (msg.k === 'join' && msg.name) chatLine(t('online.system'), t('online.joined', { name: msg.name }), true);
      if (msg.k === 'leave' && msg.name) chatLine(t('online.system'), t('online.left', { name: msg.name }), true);
      if (msg.k === 'wait' && msg.name) chatLine(t('online.system'), t('online.paused', { name: msg.name }), true);
    };
    socket.onclose = () => {
      if (mine !== epoch) return;
      ws = null;
      const was = welcomed;
      welcomed = false;
      if (!reconnect) { joining = null; seated = false; notify(); return; }
      if (was) setStatus(t('online.reconnecting'), 'info', 'online.reconnecting');
      else if (!seated) { reconnect = false; joining = null; setStatus(t('online.failed'), 'error', 'online.failed'); return; }
      schedule();
    };
  }
  function schedule(): void {
    if (!reconnect || timer) return;
    timer = setTimeout(() => { timer = null; open(); }, 1500);
  }
  function connect(nextRoom: string, nextPassword: string): void {
    if (welcomed) send({ t: 'bye' });
    roomId = nextRoom || 'official';
    password = nextPassword;
    reconnect = true;
    seated = false;
    joining = roomId;
    token = '';
    chat.length = 0;
    presentation.reset();
    const old = ws;
    ws = null;
    epoch++;
    try { old?.close(); } catch { /* already closing */ }
    setStatus('');
    open();
  }
  function disconnect(): void {
    reconnect = false;
    joining = null;
    if (timer) { clearTimeout(timer); timer = null; }
    send({ t: 'bye' });
    token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    welcomed = false;
    seated = false;
    seat = -1;
    presentation.reset();
    const old = ws;
    ws = null;
    epoch++;
    try { old?.close(); } catch { /* ignore */ }
    setStatus('');
  }
  async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    notify();
    try {
      if (!navigator.onLine) throw Error('offline');
      const response = await fetch('/api/rooms', { cache: 'no-store' });
      if (!response.ok) throw Error(String(response.status));
      const body = await response.json() as { ok?: boolean; rooms?: RoomInfo[] };
      rooms = body.rooms ?? [];
      roomsPhase = 'ready';
    } catch {
      rooms = [];
      roomsPhase = 'error';
    } finally {
      refreshing = false;
      notify();
    }
  }
  async function create(name: string, pass: string): Promise<boolean> {
    const clean = name.replace(/[<>]/g, '').trim().slice(0, 20);
    try {
      const response = await fetch('/api/rooms/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: clean, password: pass }) });
      const body = await response.json() as { ok?: boolean; id?: string; text?: string };
      if (!body.ok || !body.id) { setStatus(body.text || t('online.failed'), 'error'); return false; }
      await refresh();
      connect(body.id, pass);
      chatLine(t('online.system'), t('online.created'), true);
      return true;
    } catch {
      setStatus(t('online.failed'), 'error', 'online.failed');
      return false;
    }
  }

  setInterval(() => { if (!seated && !document.hidden && document.getElementById('match')?.hidden) void refresh(); }, POLL_MS);
  window.addEventListener('online', () => { void refresh(); });
  window.addEventListener('offline', () => { roomsPhase = 'error'; rooms = []; notify(); });
  onLanguageChange(() => { if (statusKey) status = { ...status, text: t(statusKey) }; notify(); });
  queueMicrotask(() => { void refresh(); });

  return {
    presentation,
    get connected() { return welcomed; },
    get inRoom() { return seated; },
    get reconnecting() { return seated && !welcomed; },
    get joining() { return joining; },
    get waiting() { return !presentation.latest || presentation.latest.waiting; },
    get names() { return presentation.latest?.names ?? ['', '']; },
    get seat() { return seat; },
    get roomId() { return roomId; },
    get roomName() { return roomName; },
    get rooms() { return rooms; },
    get roomsPhase() { return roomsPhase; },
    get refreshing() { return refreshing; },
    get status() { return status; },
    get chat() { return chat; },
    sendLocalInput(devices: Devices): void {
      if (!welcomed) return;
      const wire: WireInput = rawToWire(devices.sample()[0]);
      const key = `${wire.left}|${wire.right}|${wire.up}|${wire.down}|${wire.buttons}`;
      const now = Date.now();
      if (wire.taps === 0 && key === lastWire && now - lastSent < 50) return;
      lastWire = key; lastSent = now;
      send({ t: 'i', ...wire, b: wire.buttons, tap: wire.taps });
    },
    reset(): void { send({ t: 'reset' }); },
    leave(): void { disconnect(); void refresh(); },
    refresh,
    join(id: string, pass: string): void { connect(id, pass); },
    create,
    sendChat(text: string): void {
      const clean = text.trim().slice(0, 80);
      if (clean) send({ t: 'chat', text: clean });
    },
    setStatus(text: string, tone: StatusTone = 'info'): void { setStatus(text, tone); },
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
