import type { OnlineSession, RoomInfo } from '../net/session';
import { onLanguageChange, t } from './i18n';
import { icon } from './icons';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const narrow = () => window.matchMedia?.('(max-width: 899px)').matches ?? false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

type RoomState = 'waiting' | 'empty' | 'full';
const roomState = (room: RoomInfo): RoomState => room.count >= room.max ? 'full' : room.count > 0 ? 'waiting' : 'empty';
const stateLabel = (state: RoomState) => t(state === 'full' ? 'lobby.full' : state === 'waiting' ? 'room.waitingOpponent' : 'room.empty');

export interface Lobby {
  /** Updates the header connection pill; cheap enough to call every frame. */
  syncNet(): void;
}

export function setupLobby(session: OnlineSession): Lobby {
  const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const list = byId('online-rooms');
  const detail = byId('room-detail');
  const split = byId('online-split');
  const statusEl = byId('online-status');
  const count = byId('lobby-count');
  const players = byId('online-players');
  const search = byId<HTMLInputElement>('lobby-search');
  const hasPlayers = byId<HTMLInputElement>('lobby-has-players');
  const notFull = byId<HTMLInputElement>('lobby-not-full');
  const sort = byId<HTMLSelectElement>('lobby-sort');
  const refreshButton = byId<HTMLButtonElement>('online-refresh');
  const newButton = byId<HTMLButtonElement>('online-new');
  const createPanel = byId<HTMLFormElement>('create-panel');
  const titleInput = byId<HTMLInputElement>('online-title');
  const passInput = byId<HTMLInputElement>('online-pass');
  const createButton = byId<HTMLButtonElement>('online-create');
  const netPill = byId('net-status');
  const netText = byId('net-status-text');
  const offlineBanner = byId('offline-banner');
  const filterButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-lobby-filter]')];

  let selected = 'official';
  let roomPassword = '';
  let showPassword = false;
  let creating = false;
  let shownPlayers = 0;
  let tickerFrame = 0;

  function placeholders(): void {
    search.placeholder = t('lobby.search');
    titleInput.placeholder = t('online.roomName');
    passInput.placeholder = t('online.password');
    byId<HTMLInputElement>('online-name').placeholder = t('online.name');
    byId<HTMLInputElement>('online-chat').placeholder = t('online.chat');
  }

  function filtered(): RoomInfo[] {
    const query = search.value.trim().toLowerCase();
    const mode = filterButtons.find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.lobbyFilter ?? 'all';
    let rooms = session.rooms.filter(room => {
      if (mode === 'official' && !room.official) return false;
      if (mode === 'private' && room.official) return false;
      if (hasPlayers.checked && room.count < 1) return false;
      if (notFull.checked && room.count >= room.max) return false;
      if (query && !`${room.name} ${room.host ?? ''}`.toLowerCase().includes(query)) return false;
      return true;
    });
    if (sort.value === 'busy') rooms = [...rooms].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    if (sort.value === 'quiet') rooms = [...rooms].sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));
    return rooms;
  }
  function clearFilters(): void {
    search.value = ''; hasPlayers.checked = false; notFull.checked = false;
    filterButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === 0)));
    render();
  }

  function seatsMeter(room: RoomInfo): HTMLElement {
    const meter = el('span', 'seat-meter');
    meter.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < room.max; i++) meter.append(el('i', i < room.count ? `filled p${i + 1}` : ''));
    return meter;
  }
  function badge(label: string, tone = ''): HTMLElement { return el('span', `badge${tone ? ` ${tone}` : ''}`, label); }

  function stateBlock(kind: 'loading' | 'error' | 'empty' | 'offline'): HTMLElement {
    const box = el('div', `list-state ${kind}`);
    if (kind === 'loading') {
      box.setAttribute('aria-busy', 'true');
      box.setAttribute('aria-label', t('rooms.loading'));
      for (let i = 0; i < 4; i++) {
        const row = el('div', 'skeleton-row');
        row.append(el('i', 'sk sk-meter'), el('i', 'sk sk-title'), el('i', 'sk sk-badge'));
        box.append(row);
      }
      return box;
    }
    const iconName = kind === 'empty' ? 'search' : kind === 'offline' ? 'wifiOff' : 'alert';
    box.insertAdjacentHTML('beforeend', `<span class="state-icon">${icon(iconName)}</span>`);
    box.append(el('strong', '', t(kind === 'empty' ? 'rooms.emptyFiltered' : kind === 'offline' ? 'net.offline' : 'rooms.error')));
    box.append(el('p', '', t(kind === 'empty' ? 'lobby.empty' : kind === 'offline' ? 'net.offlineDetail' : 'rooms.errorDetail')));
    const action = el('button', 'btn sm outline');
    action.type = 'button';
    if (kind === 'empty') { action.textContent = t('rooms.clearFilters'); action.onclick = clearFilters; }
    else {
      action.innerHTML = `${icon('refresh')}<span>${t('rooms.retry')}</span>`;
      action.disabled = kind === 'offline' && !navigator.onLine;
      action.onclick = () => { void session.refresh(); };
    }
    if (kind !== 'offline' || navigator.onLine) box.append(action);
    return box;
  }

  let listKey = '';
  let detailKey = '';
  let joinAttempt = '';
  const inlineError = () => session.status.tone === 'error' && joinAttempt !== '' && joinAttempt === selected ? session.status.text : '';
  function renderList(rooms: RoomInfo[]): void {
    const key = JSON.stringify([session.roomsPhase, navigator.onLine, selected, rooms]);
    if (key === listKey) return;
    listKey = key;
    const hadFocus = list.contains(document.activeElement);
    list.replaceChildren();
    list.setAttribute('aria-busy', String(session.roomsPhase === 'loading'));
    if (session.roomsPhase === 'loading') { list.append(stateBlock('loading')); return; }
    if (session.roomsPhase === 'error') { list.append(stateBlock(navigator.onLine ? 'error' : 'offline')); return; }
    if (!rooms.length) { list.append(stateBlock('empty')); return; }
    for (const room of rooms) {
      const state = roomState(room);
      const row = el('div', `room-row state-${state}`);
      row.id = `room-opt-${room.id}`;
      row.setAttribute('role', 'option');
      row.dataset.roomId = room.id;
      const isSelected = room.id === selected;
      row.setAttribute('aria-selected', String(isSelected));
      row.tabIndex = isSelected ? 0 : -1;
      const main = el('span', 'room-main');
      const title = el('span', 'room-title');
      title.append(el('strong', 'room-name', room.name));
      if (room.official) title.append(badge(t('lobby.official'), 'brand'));
      if (room.locked) title.insertAdjacentHTML('beforeend', `<span class="lock" title="${t('room.lockedDesc')}">${icon('lock')}</span>`);
      const sub = el('span', 'room-sub', room.host ? t('lobby.host', { name: room.host }) : t(room.official ? 'room.officialDesc' : 'lobby.openSeat'));
      main.append(title, sub);
      const side = el('span', 'room-side');
      side.append(el('span', 'room-count', `${room.count}/${room.max}`), badge(stateLabel(state), state === 'waiting' ? 'ok' : state === 'full' ? 'muted' : ''));
      row.append(seatsMeter(room), main, side);
      row.insertAdjacentHTML('beforeend', icon('chevronRight', 'row-chevron'));
      row.addEventListener('click', () => select(room.id, true));
      row.addEventListener('dblclick', () => join(room));
      list.append(row);
    }
    if (hadFocus) (list.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.querySelector<HTMLElement>('[role="option"]'))?.focus({ preventScroll: true });
  }

  function renderDetail(room: RoomInfo | undefined): void {
    const key = JSON.stringify([session.roomsPhase, navigator.onLine, session.joining, room, inlineError()]);
    if (key === detailKey) return;
    detailKey = key;
    const active = document.activeElement as HTMLInputElement | null;
    const focusId = active && detail.contains(active) ? active.id : '';
    const caret = focusId === 'room-pass' ? [active!.selectionStart, active!.selectionEnd] as const : null;
    paintDetail(room);
    if (!focusId) return;
    const target = detail.querySelector<HTMLInputElement>(`#${focusId}`);
    if (!target || target.disabled) return;
    target.focus({ preventScroll: true });
    if (caret) target.setSelectionRange(caret[0], caret[1]);
  }

  function paintDetail(room: RoomInfo | undefined): void {
    detail.replaceChildren();
    const back = el('button', 'btn ghost sm detail-back');
    back.type = 'button';
    back.id = 'room-back';
    back.innerHTML = `${icon('arrowLeft')}<span>${t('room.back')}</span>`;
    back.onclick = () => showList(true);
    if (!room) {
      const empty = el('div', 'detail-empty');
      empty.insertAdjacentHTML('beforeend', `<span class="state-icon">${icon('door')}</span>`);
      empty.append(el('p', '', session.roomsPhase === 'ready' ? t('room.select') : session.roomsPhase === 'loading' ? t('rooms.loading') : t('rooms.errorDetail')));
      detail.append(back, empty);
      return;
    }
    const state = roomState(room);
    const head = el('div', 'detail-head');
    const title = el('h3', 'detail-title', room.name);
    const badges = el('div', 'detail-badges');
    badges.append(badge(t(room.official ? 'lobby.official' : 'lobby.private'), room.official ? 'brand' : ''));
    if (room.locked) { const lock = badge(t('online.locked')); lock.insertAdjacentHTML('afterbegin', icon('lock')); badges.append(lock); }
    badges.append(badge(stateLabel(state), state === 'waiting' ? 'ok' : state === 'full' ? 'muted' : ''));
    head.append(title, badges, el('p', 'detail-desc', t(room.official ? 'room.officialDesc' : 'room.privateDesc')));

    const seats = el('ol', 'seat-list');
    for (let i = 0; i < room.max; i++) {
      const taken = i < room.count;
      const item = el('li', `seat ${taken ? 'taken' : 'open'} p${i + 1}`);
      item.append(el('span', 'seat-tag', `P${i + 1}`));
      const who = el('span', 'seat-who');
      who.append(el('strong', '', taken ? (i === 0 && room.host ? room.host : t('room.taken')) : t('room.open')));
      who.append(el('small', '', t('room.seat', { n: i + 1 })));
      item.append(who);
      if (i === 0 && taken && room.host) item.insertAdjacentHTML('beforeend', `<span class="seat-crown" title="${t('lobby.host', { name: room.host })}">${icon('crown')}</span>`);
      seats.append(item);
    }

    const form = el('form', 'join-form');
    form.noValidate = true;
    if (room.locked && state !== 'full') {
      const field = el('label', 'field');
      field.append(el('span', '', t('room.password')));
      const wrap = el('span', 'input-wrap');
      const input = el('input');
      input.id = 'room-pass';
      input.type = showPassword ? 'text' : 'password';
      input.maxLength = 16;
      input.autocomplete = 'off';
      input.value = roomPassword;
      input.placeholder = t('online.password');
      input.oninput = () => { roomPassword = input.value; };
      const toggle = el('button', 'input-addon');
      toggle.type = 'button';
      toggle.id = 'room-pass-toggle';
      toggle.setAttribute('aria-label', t(showPassword ? 'room.hidePassword' : 'room.showPassword'));
      toggle.setAttribute('aria-pressed', String(showPassword));
      toggle.innerHTML = icon(showPassword ? 'eyeOff' : 'eye');
      toggle.onclick = () => { showPassword = !showPassword; input.type = showPassword ? 'text' : 'password'; toggle.innerHTML = icon(showPassword ? 'eyeOff' : 'eye'); toggle.setAttribute('aria-pressed', String(showPassword)); toggle.setAttribute('aria-label', t(showPassword ? 'room.hidePassword' : 'room.showPassword')); input.focus(); };
      wrap.append(input, toggle);
      field.append(wrap);
      form.append(field);
    }
    const error = inlineError();
    if (error) {
      const line = el('p', 'join-error', error);
      line.id = 'room-join-error';
      line.setAttribute('role', 'alert');
      line.insertAdjacentHTML('afterbegin', icon('alert'));
      form.append(line);
      form.querySelector('#room-pass')?.setAttribute('aria-invalid', 'true');
      form.querySelector('#room-pass')?.setAttribute('aria-describedby', line.id);
    }
    const joinButton = el('button', 'btn brand lg join-btn');
    joinButton.type = 'submit';
    joinButton.id = 'room-join';
    const joiningThis = session.joining === room.id;
    joinButton.disabled = state === 'full' || joiningThis || !navigator.onLine;
    joinButton.setAttribute('aria-busy', String(joiningThis));
    joinButton.innerHTML = joiningThis ? `<span class="spinner" aria-hidden="true"></span><span>${t('room.joining')}</span>` : state === 'full' ? `<span>${t('room.full')}</span>` : `${icon('swords')}<span>${t('room.join')}</span>`;
    form.append(joinButton);
    form.onsubmit = event => { event.preventDefault(); join(room); };

    const hint = el('p', 'detail-hint');
    hint.insertAdjacentHTML('beforeend', icon('keyboard'));
    hint.append(el('span', '', t('online.hint')));
    detail.append(back, head, seats, form, hint);
  }

  function render(): void {
    const rooms = filtered();
    if (session.roomsPhase === 'ready' && session.rooms.length && !session.rooms.some(room => room.id === selected)) selected = rooms[0]?.id ?? session.rooms[0].id;
    count.textContent = String(session.roomsPhase === 'ready' ? rooms.length : 0);
    renderList(rooms);
    renderDetail(session.roomsPhase === 'ready' ? session.rooms.find(room => room.id === selected) : undefined);
    statusEl.textContent = inlineError() ? '' : session.status.text;
    statusEl.dataset.tone = session.status.tone;
    refreshButton.classList.toggle('spinning', session.refreshing);
    refreshButton.setAttribute('aria-busy', String(session.refreshing));
    tick(session.roomsPhase === 'ready' ? session.rooms.reduce((sum, room) => sum + room.count, 0) : -1);
    syncNet();
  }

  function tick(target: number): void {
    cancelAnimationFrame(tickerFrame);
    if (target < 0) { players.textContent = '\u00a0'; return; }
    const from = shownPlayers, start = performance.now(), duration = reducedMotion() ? 0 : 600;
    const step = (now: number) => {
      const k = duration ? Math.min(1, (now - start) / duration) : 1;
      shownPlayers = Math.round(from + (target - from) * (1 - (1 - k) ** 3));
      players.textContent = t('online.playersOnline', { count: shownPlayers });
      if (k < 1) tickerFrame = requestAnimationFrame(step);
    };
    step(start);
  }

  function select(id: string, openDetail = false): void {
    if (selected !== id) { selected = id; roomPassword = ''; showPassword = false; joinAttempt = ''; }
    render();
    if (openDetail && narrow()) {
      split.dataset.view = 'detail';
      detail.querySelector<HTMLElement>('#room-pass, #room-join:not(:disabled), #room-back')?.focus({ preventScroll: true });
      split.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }
  function showList(focus: boolean): void {
    split.dataset.view = 'list';
    if (focus) list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }
  function join(room: RoomInfo): void {
    if (room.count >= room.max) return;
    if (room.locked && !roomPassword) {
      select(room.id, narrow());
      joinAttempt = room.id;
      session.setStatus(t('lobby.needPassword'), 'error');
      detail.querySelector<HTMLInputElement>('#room-pass')?.focus();
      return;
    }
    joinAttempt = room.id;
    session.join(room.id, room.locked ? roomPassword : '');
  }

  function openCreate(open: boolean): void {
    createPanel.hidden = !open;
    newButton.setAttribute('aria-expanded', String(open));
    if (open) titleInput.focus();
    else newButton.focus();
  }

  list.addEventListener('keydown', event => {
    const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    if (!options.length) return;
    const index = Math.max(0, options.findIndex(option => option.dataset.roomId === selected));
    let next = -1;
    if (event.key === 'ArrowDown') next = Math.min(options.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const room = session.rooms.find(item => item.id === selected);
      if (!room) return;
      if (narrow() || event.key === ' ') select(room.id, true);
      else join(room);
      return;
    }
    if (next < 0) return;
    event.preventDefault();
    selected = options[next].dataset.roomId!;
    roomPassword = ''; showPassword = false;
    render();
    list.querySelector<HTMLElement>(`[data-room-id="${CSS.escape(selected)}"]`)?.focus();
  });
  detail.addEventListener('keydown', event => { if (event.key === 'Escape' && split.dataset.view === 'detail') { event.preventDefault(); showList(true); } });

  for (const input of [search, hasPlayers, notFull, sort]) { input.addEventListener('input', render); input.addEventListener('change', render); }
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape' && search.value) { event.preventDefault(); search.value = ''; render(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); list.querySelector<HTMLElement>('[aria-selected="true"], [role="option"]')?.focus(); }
  });
  filterButtons.forEach(button => button.addEventListener('click', () => {
    filterButtons.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    render();
  }));
  refreshButton.addEventListener('click', () => { void session.refresh(); });
  newButton.addEventListener('click', () => openCreate(newButton.getAttribute('aria-expanded') !== 'true'));
  byId('create-cancel').addEventListener('click', () => openCreate(false));
  createPanel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); openCreate(false); } });
  createPanel.addEventListener('submit', async event => {
    event.preventDefault();
    if (creating) return;
    creating = true;
    createButton.disabled = true;
    createButton.setAttribute('aria-busy', 'true');
    const ok = await session.create(titleInput.value, passInput.value);
    creating = false;
    createButton.disabled = false;
    createButton.setAttribute('aria-busy', 'false');
    if (ok) { titleInput.value = ''; passInput.value = ''; createPanel.hidden = true; newButton.setAttribute('aria-expanded', 'false'); }
  });
  byId('online-official').addEventListener('click', () => session.join('official', ''));
  document.addEventListener('keydown', event => {
    if (byId('lobby').hidden || event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
    event.preventDefault();
    search.focus();
    search.select();
  });
  window.matchMedia?.('(max-width: 899px)').addEventListener('change', () => { if (!narrow()) split.dataset.view = 'list'; });
  window.addEventListener('online', render);
  window.addEventListener('offline', render);

  let lastNet = '';
  function syncNet(): void {
    const offline = !navigator.onLine;
    const state = offline ? 'offline' : session.reconnecting ? 'warn' : session.inRoom ? 'room' : session.roomsPhase === 'loading' ? 'checking' : session.roomsPhase === 'error' ? 'down' : 'ready';
    const label = offline ? t('net.offline') : session.reconnecting ? t('net.reconnecting') : session.inRoom ? t('net.inRoom', { room: session.roomName }) : t(state === 'checking' ? 'net.checking' : state === 'down' ? 'net.down' : 'net.ready');
    const key = `${state}|${label}`;
    if (key === lastNet) return;
    lastNet = key;
    netPill.dataset.state = state;
    netText.textContent = label;
    offlineBanner.hidden = !offline;
  }

  session.subscribe(render);
  onLanguageChange(() => { placeholders(); lastNet = ''; listKey = ''; detailKey = ''; render(); });
  placeholders();
  render();
  return { syncNet };
}
