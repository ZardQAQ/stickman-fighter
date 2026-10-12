import rules from '../data/rules.json';
import type { HitLevel } from '../data/schema';
import { BUTTON_MASK, neutralInput, type RawInput } from '../input/types';
import type { ContactPose, Fighter, FighterState, GameState } from '../simulation/types';
import type { RoundState } from '../simulation/rounds';

const FIGHTER_STATES: readonly FighterState[] = ['Idle', 'Walk', 'Crouch', 'CrouchWalk', 'JumpSquat', 'Airborne', 'Landing', 'Attack', 'Hitstun', 'Blockstun', 'Knockdown', 'KO'];
const HIT_LEVELS: readonly HitLevel[] = ['LOW', 'MID', 'HIGH'];
const PHASES: readonly RoundState['phase'][] = ['fighting', 'roundOver', 'matchOver'];

export interface WireInput { left: boolean; right: boolean; up: boolean; down: boolean; buttons: number; taps: number }

/** Visual fields the canvas and HUD need. Input history stays on the server. */
export interface NetFighter {
  x: number; y: number; vx: number; vy: number;
  facing: -1 | 1; attackFacing: -1 | 1;
  state: FighterState; stateFrame: number; hp: number; crouching: boolean;
  moveId: string | null; moveFrame: number;
  hitReaction?: 'middlePunch';
  revenge: number; special: number;
}

export interface NetContact {
  attacker: number; defender: number; blocked: boolean; frame: number;
  hitLevel?: HitLevel;
  poses?: ContactPose[];
}

export interface NetRound {
  phase: RoundState['phase'];
  number: number; timer: number;
  wins: [number, number];
  winner: number | null;
  reason: RoundState['reason'];
}

export interface NetSnap {
  t: 's';
  st: number;
  frame: number;
  hitstop: number;
  fighters: [NetFighter, NetFighter];
  contact: NetContact | null;
  round: NetRound;
  waiting: boolean;
  names: [string, string];
  seats: [boolean, boolean];
}

export interface SnapMeta {
  st: number;
  waiting: boolean;
  names: [string, string];
  seats: [boolean, boolean];
}

const flag = (value: unknown): boolean => value === true || value === 1;
const bits = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n & BUTTON_MASK : 0;
};

export function sanitizeInput(value: unknown): WireInput {
  const msg = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { left: flag(msg.left), right: flag(msg.right), up: flag(msg.up), down: flag(msg.down), buttons: bits(msg.b), taps: bits(msg.tap) };
}

export function toRaw(input: WireInput, taps = input.taps): RawInput {
  return { left: input.left, right: input.right, up: input.up, down: input.down, buttons: input.buttons & BUTTON_MASK, taps: taps & BUTTON_MASK };
}

export function rawToWire(raw: RawInput): WireInput {
  return { left: raw.left, right: raw.right, up: raw.up, down: raw.down, buttons: raw.buttons & BUTTON_MASK, taps: (raw.taps ?? 0) & BUTTON_MASK };
}

function facingOf(value: number): -1 | 1 { return value < 0 ? -1 : 1; }

function packFighter(f: Fighter): NetFighter {
  return {
    x: f.x, y: f.y, vx: f.vx, vy: f.vy, facing: facingOf(f.facing), attackFacing: facingOf(f.attackFacing),
    state: f.state, stateFrame: f.stateFrame, hp: f.hp, crouching: f.crouching,
    moveId: f.moveId, moveFrame: f.moveFrame, hitReaction: f.hitReaction,
    revenge: f.resources.revenge.current, special: f.resources.special.current,
  };
}

function packContact(game: GameState): NetContact | null {
  const contact = game.lastContact;
  if (!contact) return null;
  return {
    attacker: contact.attacker, defender: contact.defender, blocked: contact.blocked, frame: contact.frame, hitLevel: contact.hitLevel,
    poses: game.hitstop > 0 && contact.poses ? contact.poses.map(pose => ({ ...pose })) : undefined,
  };
}

export function packState(game: GameState, meta: SnapMeta): NetSnap {
  return {
    t: 's', st: meta.st, frame: game.frame, hitstop: game.hitstop,
    fighters: [packFighter(game.fighters[0]), packFighter(game.fighters[1])],
    contact: packContact(game),
    round: {
      phase: game.round.phase, number: game.round.number, timer: game.round.timer,
      wins: [game.round.wins[0], game.round.wins[1]], winner: game.round.winner, reason: game.round.reason,
    },
    waiting: meta.waiting, names: meta.names, seats: meta.seats,
  };
}

function applyFighter(f: Fighter, snap: NetFighter): void {
  f.x = snap.x; f.y = snap.y; f.vx = snap.vx; f.vy = snap.vy;
  f.facing = facingOf(snap.facing); f.attackFacing = facingOf(snap.attackFacing);
  f.state = FIGHTER_STATES.includes(snap.state) ? snap.state : 'Idle';
  f.stateFrame = snap.stateFrame; f.hp = snap.hp; f.crouching = snap.crouching;
  f.moveId = snap.moveId; f.moveFrame = snap.moveFrame;
  f.hitReaction = snap.hitReaction === 'middlePunch' ? 'middlePunch' : undefined;
  f.resources.revenge.current = snap.revenge; f.resources.special.current = snap.special;
}

function applyContact(snap: NetContact | null): GameState['lastContact'] {
  if (!snap) return null;
  const hitLevel = snap.hitLevel && HIT_LEVELS.includes(snap.hitLevel) ? snap.hitLevel : undefined;
  return {
    attacker: snap.attacker, defender: snap.defender, blocked: snap.blocked, frame: snap.frame, hitLevel,
    poses: snap.poses?.map(pose => ({ ...pose, hitLevel: pose.hitLevel && HIT_LEVELS.includes(pose.hitLevel) ? pose.hitLevel : undefined })),
  };
}

export function applySnap(game: GameState, snap: NetSnap): void {
  game.frame = snap.frame;
  game.hitstop = snap.hitstop;
  applyFighter(game.fighters[0], snap.fighters[0]);
  applyFighter(game.fighters[1], snap.fighters[1]);
  game.lastContact = applyContact(snap.contact);
  game.round = {
    phase: PHASES.includes(snap.round.phase) ? snap.round.phase : 'fighting',
    number: snap.round.number, timer: snap.round.timer,
    wins: [snap.round.wins[0], snap.round.wins[1]],
    transition: 0, winner: snap.round.winner, reason: snap.round.reason,
  };
  game.training = { enabled: false, dummy: 'stand' };
}

export function neutralWire(): WireInput {
  const raw = neutralInput();
  return rawToWire(raw);
}

export const FRAME_MS = 1000 / rules.hz;
