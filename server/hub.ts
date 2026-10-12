import { createGame, step } from '../src/simulation/state';
import type { ControlEvent } from '../src/simulation/events';
import type { GameState } from '../src/simulation/types';
import { FRAME_MS, neutralWire, packState, sanitizeInput, toRaw, type WireInput } from '../src/net/snapshot';

const MAX_PLAYERS = 2;
const GRACE_MS = 12000;
const FRAME_CATCHUP = 4;

interface Socket {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: 'message', cb: (raw: unknown) => void): void;
  on(event: 'close', cb: () => void): void;
}

interface Seat {
  name: string;
  token: string;
  ws: Socket | null;
  connected: boolean;
  disconnectAt: number;
  input: WireInput;
  taps: number;
}

interface RoomMeta { id: string; name: string; password: string | null; official: boolean }

class Room {
  readonly meta: RoomMeta;
  seats: [Seat | null, Seat | null] = [null, null];
  game: GameState = createGame();
  stagePending: ControlEvent[] = [];
  closed = false;
  private acc = 0;
  private last = Date.now();
  private lastBroadcast = 0;

  constructor(meta: RoomMeta) { this.meta = meta; }

  bothConnected(): boolean { return this.seats.every(seat => seat?.connected); }

  count(): number { return this.seats.filter(Boolean).length; }

  join(ws: Socket, name: string, token: string): { seat: number; token: string; reclaimed: boolean } | null {
    if (token) {
      const index = this.seats.findIndex(seat => seat?.token === token);
      const existing = index >= 0 ? this.seats[index] : null;
      if (existing && !existing.connected) {
        existing.ws = ws; existing.connected = true; existing.name = name;
        this.speak('join', name);
        return { seat: index, token: existing.token, reclaimed: true };
      }
      if (existing?.connected) return null;
    }
    const index = this.seats.findIndex(seat => !seat);
    if (index < 0) return null;
    const seat: Seat = { name, token: token || makeToken(), ws, connected: true, disconnectAt: 0, input: neutralWire(), taps: 0 };
    this.seats[index] = seat;
    this.speak('join', name);
    if (this.bothConnected()) {
      this.stagePending.push({ type: 'reset' });
      for (const player of this.seats) if (player) player.taps = 0;
      this.speak('chat', '系统', '对局开始');
    }
    return { seat: index, token: seat.token, reclaimed: false };
  }

  drop(index: number, immediate: boolean): void {
    const seat = this.seats[index];
    if (!seat) return;
    seat.ws = null; seat.connected = false; seat.input = neutralWire(); seat.taps = 0;
    if (immediate) {
      this.seats[index] = null;
      this.speak('leave', seat.name);
      this.maybeClose();
      return;
    }
    seat.disconnectAt = Date.now();
    this.speak('wait', seat.name);
  }

  seatOf(ws: Socket): number { return this.seats.findIndex(seat => seat?.ws === ws); }

  input(index: number, raw: unknown): void {
    const seat = this.seats[index];
    if (!seat?.connected) return;
    const next = sanitizeInput(raw);
    seat.input = next;
    seat.taps |= next.taps;
  }

  reset(): void { if (this.bothConnected()) this.stagePending.push({ type: 'reset' }); }

  chat(index: number, text: unknown): void {
    const seat = this.seats[index];
    const clean = String(text ?? '').replace(/[<>]/g, '').trim().slice(0, 80);
    if (!seat?.connected || !clean) return;
    this.speak('chat', seat.name, clean);
  }

  pump(now: number): void {
    this.reap(now);
    if (!this.bothConnected()) {
      this.acc = 0; this.last = now;
      if (now - this.lastBroadcast >= 200) this.sendSnap(true, now);
      return;
    }
    this.acc += Math.min(100, now - this.last);
    this.last = now;
    let steps = 0;
    while (this.acc >= FRAME_MS && steps < FRAME_CATCHUP) {
      this.simulate();
      this.sendSnap(false, Date.now());
      this.acc -= FRAME_MS;
      steps++;
    }
  }

  private reap(now: number): void {
    this.seats.forEach((seat, index) => {
      if (seat && !seat.connected && now - seat.disconnectAt > GRACE_MS) this.drop(index, true);
    });
  }

  private maybeClose(): void {
    if (!this.meta.official && this.count() === 0) this.closed = true;
  }

  private simulate(): void {
    const inputs = [0, 1].map(index => {
      const seat = this.seats[index];
      if (!seat) return toRaw(neutralWire());
      const taps = seat.taps;
      seat.taps = 0;
      return toRaw(seat.input, taps);
    }) as [ReturnType<typeof toRaw>, ReturnType<typeof toRaw>];
    const events = this.stagePending;
    this.stagePending = [];
    step(this.game, inputs, events);
  }

  private sendSnap(waiting: boolean, st: number): void {
    this.lastBroadcast = st;
    const names: [string, string] = [this.seats[0]?.name ?? '', this.seats[1]?.name ?? ''];
    const seats: [boolean, boolean] = [!!this.seats[0], !!this.seats[1]];
    this.broadcast(packState(this.game, { st, waiting, names, seats }));
  }

  private speak(kind: 'join' | 'leave' | 'wait' | 'chat', name: string, text?: string): void {
    this.broadcast(text ? { t: 'e', k: kind, name, text } : { t: 'e', k: kind, name });
  }

  private broadcast(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const seat of this.seats) {
      if (seat?.ws && seat.ws.readyState === 1) {
        try { seat.ws.send(data); } catch { /* socket already gone */ }
      }
    }
  }

  welcome(index: number): unknown {
    const seat = this.seats[index]!;
    return { t: 'w', id: index, token: seat.token, roomId: this.meta.id, roomName: this.meta.name };
  }
}

function makeToken(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function makeRoomId(): string { return `r${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }

interface Req {
  method?: string;
  url?: string;
  on(event: 'data', cb: (chunk: unknown) => void): void;
  on(event: 'end', cb: () => void): void;
  destroy(): void;
}
interface Res { writeHead(status: number, headers?: Record<string, string>): void; end(body?: string): void }

export function createHub() {
  const rooms = new Map<string, Room>();
  const official = new Room({ id: 'official', name: '官方对战', password: null, official: true });
  rooms.set(official.meta.id, official);

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      room.pump(now);
      if (room.closed) rooms.delete(id);
    }
  }, 8);

  function list() {
    return [...rooms.values()].map(room => ({
      id: room.meta.id, name: room.meta.name, count: room.count(), max: MAX_PLAYERS,
      locked: !!room.meta.password, official: room.meta.official,
      host: room.seats[0]?.name || room.seats[1]?.name || '',
    })).sort((a, b) => Number(b.official) - Number(a.official));
  }

  function sendJson(res: Res, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(body));
  }

  function readJson(req: Req, cb: (value: Record<string, unknown> | null) => void): void {
    let body = '';
    req.on('data', chunk => { body += String(chunk); if (body.length > 1e5) req.destroy(); });
    req.on('end', () => { try { cb(JSON.parse(body || '{}') as Record<string, unknown>); } catch { cb(null); } });
  }

  function http(req: Req, res: Res): boolean {
    const path = (req.url || '/').split('?')[0];
    if (path === '/health') { sendJson(res, 200, { ok: true, rooms: rooms.size }); return true; }
    if (path === '/api/rooms' && req.method === 'GET') { sendJson(res, 200, { ok: true, rooms: list() }); return true; }
    if (path === '/api/rooms/create' && req.method === 'POST') {
      readJson(req, data => {
        if (!data) { sendJson(res, 400, { ok: false, text: 'bad request' }); return; }
        const name = String(data.name || '').replace(/[<>]/g, '').trim().slice(0, 20) || 'Room';
        const password = String(data.password || '').slice(0, 16);
        const room = new Room({ id: makeRoomId(), name, password: password || null, official: false });
        rooms.set(room.meta.id, room);
        sendJson(res, 200, { ok: true, id: room.meta.id, name: room.meta.name });
      });
      return true;
    }
    return false;
  }

  function connect(ws: Socket): void {
    let room: Room | null = null;
    let seat = -1;
    ws.on('message', raw => {
      const text = String(raw);
      if (text.length > 4000) return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(text) as Record<string, unknown>; } catch { return; }
      if (msg.t === 'hello') {
        if (seat >= 0) return;
        const found = rooms.get(String(msg.roomId || 'official'));
        if (!found) { ws.send(JSON.stringify({ t: 'e', k: 'erauth', text: '房间不存在' })); ws.close(); return; }
        if (found.meta.password && found.meta.password !== String(msg.password || '')) {
          ws.send(JSON.stringify({ t: 'e', k: 'erauth', text: '房间密码错误' })); ws.close(); return;
        }
        let name = String(msg.name || '').replace(/[<>]/g, '').trim().slice(0, 12);
        if (!name) name = `P${Math.floor(100 + Math.random() * 900)}`;
        const joined = found.join(ws, name, String(msg.token || ''));
        if (!joined) { ws.send(JSON.stringify({ t: 'e', k: 'full', text: '房间已满（最多 2 人）' })); ws.close(); return; }
        room = found; seat = joined.seat;
        ws.send(JSON.stringify(found.welcome(seat)));
        return;
      }
      if (!room || seat < 0) return;
      if (msg.t === 'i') room.input(seat, msg);
      else if (msg.t === 'reset') room.reset();
      else if (msg.t === 'chat') room.chat(seat, msg.text);
      else if (msg.t === 'bye') { room.drop(seat, true); room = null; seat = -1; }
    });
    ws.on('close', () => {
      if (room && seat >= 0 && room.seatOf(ws) === seat) room.drop(seat, false);
    });
  }

  return { http, connect, close: () => clearInterval(timer) };
}
