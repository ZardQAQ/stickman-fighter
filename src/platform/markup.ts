import { previewMarkup } from '../debug/animation-preview';
import { stagePickerMarkup, stageSwitchMarkup } from './stage';
import { t, type TranslationKey } from './i18n';
import { icon, type IconName } from './icons';

const text=(key: TranslationKey)=>`data-i18n="${key}">${t(key)}`;
const aria=(key: TranslationKey)=>`data-i18n-aria-label="${key}" aria-label="${t(key)}"`;
const levels=['easy','medium','hard'] as const;
const dummies=['stand','crouch','block','cpu'] as const;

export const LAUNCH_MODES = ['versus','cpu','training','demo'] as const;
export type LaunchMode = typeof LAUNCH_MODES[number];
const modeIcons: Record<LaunchMode, IconName> = { versus:'users', cpu:'bot', training:'target', demo:'monitor' };

export const brandMark = `<svg class="brand-glyph" viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="8" r="3.4"/><path d="M11.6 12.2 13.4 19M12.6 15l-4.8 3.4M12.4 14.2l5.6-1.6 3.4-3.2M13.4 19l-3.6 7.2M13.4 19l9.6-2.6 4-1.4"/><path class="brand-spark" d="M27 9.5l1.2 2.3 2.3 1.2-2.3 1.2-1.2 2.3-1.2-2.3-2.3-1.2 2.3-1.2z"/></svg>`;

const segmented=(name: string, values: readonly string[], key: (value: string)=>TranslationKey, label: TranslationKey)=>
  `<div class="segmented compact" role="radiogroup" ${aria(label)}>${values.map(value=>`<label><input type="radio" name="${name}" value="${value}"><span ${text(key(value))}</span></label>`).join('')}</div>`;

const modeRow=(mode: LaunchMode)=>`<div class="mode-row" data-mode-row="${mode}">
  <label class="mode-option">
    <input type="radio" name="launch-mode" value="${mode}">
    <span class="mode-icon">${icon(modeIcons[mode])}</span>
    <span class="mode-text"><strong ${text(`mode.${mode}`)}</strong><small ${text(`mode.${mode}Desc`)}</small></span>
    <span class="mode-radio" aria-hidden="true"></span>
  </label>
  ${mode==='cpu'?`<div class="mode-extra"><span class="mode-extra-label" ${text('launch.difficulty')}</span>${segmented('launch-difficulty',levels,v=>`difficulty.${v}` as TranslationKey,'launch.difficulty')}</div>`:''}
  ${mode==='training'?`<div class="mode-extra"><span class="mode-extra-label" ${text('launch.dummy')}</span>${segmented('launch-dummy',dummies,v=>`dummy.${v}` as TranslationKey,'launch.dummy')}</div>`:''}
</div>`;

const keyRows: [TranslationKey, string[]][] = [['keys.punch',['LP','MP','HP']],['keys.leftLeg',['LK','LMK','HK']],['keys.rightLeg',['RLK','MK','RHK']]];
const controlsMarkup = [0,1].map(owner=>`<div class="key-player ${owner?'player-two':''}">
  <div class="player-label"><span class="player-chip">P${owner+1}</span><span ${text(owner?'controls.player2':'controls.player1')}</span><small ${text(owner?'controls.arrows':'controls.keyboard')}</small></div>
  <div class="control-grid">
    <div class="key-block"><span class="key-caption" ${text('keys.move')}</span><div class="keys dpad"><i></i><kbd data-owner="${owner}" data-control="up"></kbd><i></i><kbd data-owner="${owner}" data-control="left"></kbd><kbd data-owner="${owner}" data-control="down"></kbd><kbd data-owner="${owner}" data-control="right"></kbd></div></div>
    <div class="key-block attacks">
      <div class="attack-head"><span></span><span ${text('controls.light')}</span><span ${text('controls.med')}</span><span ${text('controls.heavy')}</span></div>
      ${keyRows.map(([label,actions])=>`<div class="attack-row"><span class="key-caption" ${text(label)}</span>${actions.map(action=>`<kbd data-owner="${owner}" data-control="${action}"></kbd>`).join('')}</div>`).join('')}
    </div>
  </div>
</div>`).join('');

export const markup = `
<div class="app-shell">
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <span class="brand-mark">${brandMark}</span>
        <span class="brand-text"><h1 ${text('brand.title')}</h1><span class="brand-tagline" ${text('brand.tagline')}</span></span>
      </div>
      <div class="topbar-actions">
        <span id="net-status" class="net-pill" data-state="checking" role="status"><span class="net-dot" aria-hidden="true"></span><span id="net-status-text">${t('net.checking')}</span></span>
        <button id="language" class="btn icon-btn lang-btn" type="button">EN</button>
        <button id="theme" class="btn icon-btn" type="button" ${aria('theme.dark')} aria-pressed="false"></button>
      </div>
    </div>
    <div id="offline-banner" class="offline-banner" role="status" hidden>${icon('wifiOff')}<strong ${text('net.offline')}</strong><span ${text('net.offlineDetail')}</span></div>
  </header>

  <main id="lobby" class="lobby">
    <section class="launch" aria-labelledby="launch-title">
      <div class="launch-preview spotlight">
        <canvas id="launch-preview" width="960" height="420" aria-hidden="true"></canvas>
        <div class="launch-preview-meta"><span class="vs-tag"><b>P1</b><i>VS</i><b>P2</b></span><span class="rule-tag" ${text('match.bestOfThree')}</span></div>
      </div>
      <div class="launch-body">
        <div class="section-head">
          <h2 id="launch-title" ${text('launch.title')}</h2>
          <p class="section-sub" ${text('launch.lead')}</p>
        </div>
        <div class="field-group">
          <span class="field-label" id="mode-label" ${text('launch.mode')}</span>
          <div class="mode-list" role="radiogroup" aria-labelledby="mode-label">${LAUNCH_MODES.map(modeRow).join('')}</div>
        </div>
        <div class="field-group">
          <span class="field-label" ${text('stage.label')}</span>
          ${stagePickerMarkup}
        </div>
        <button id="enter-local" class="btn brand xl start-btn" type="button" disabled>${icon('play')}<span ${text('launch.start')}</span><span class="beam" aria-hidden="true"></span></button>
        <p class="launch-hint">${icon('keyboard')}<span ${text('launch.keysHint')}</span></p>
      </div>
    </section>

    <section class="online" aria-labelledby="online-heading">
      <div class="online-head">
        <div class="section-head">
          <h2 id="online-heading" ${text('online.title')}</h2>
          <p class="section-sub"><span id="online-players" class="ticker">&nbsp;</span></p>
        </div>
        <div class="online-head-actions">
          <label class="name-field"><span ${text('online.nameLabel')}</span><input id="online-name" maxlength="12" autocomplete="nickname" spellcheck="false" ${aria('online.nameLabel')}></label>
          <button id="online-new" class="btn outline" type="button" aria-expanded="false" aria-controls="create-panel">${icon('plus')}<span ${text('online.newRoom')}</span></button>
          <button id="online-official" class="btn primary" type="button">${icon('zap')}<span ${text('online.quick')}</span></button>
        </div>
      </div>

      <form id="create-panel" class="create-panel" hidden>
        <label class="field"><span ${text('online.roomTitleLabel')}</span><input id="online-title" maxlength="20" autocomplete="off" ${aria('online.roomName')}></label>
        <label class="field"><span ${text('online.roomPassLabel')}</span><input id="online-pass" maxlength="16" type="password" autocomplete="new-password" ${aria('online.password')}></label>
        <div class="create-actions">
          <button id="online-create" class="btn primary" type="submit">${icon('plus')}<span ${text('online.create')}</span></button>
          <button id="create-cancel" class="btn ghost" type="button" ${text('online.cancel')}</button>
        </div>
        <p class="field-hint" ${text('online.createHint')}</p>
      </form>

      <div class="online-toolbar">
        <div class="search-field">${icon('search')}<input id="lobby-search" type="search" autocomplete="off" ${aria('lobby.search')}><kbd class="kbd-hint" title="${t('shortcut.search')}">/</kbd></div>
        <div class="segmented lobby-chips" role="group" ${aria('lobby.rooms')}>
          <button type="button" data-lobby-filter="all" aria-pressed="true" ${text('lobby.all')}</button>
          <button type="button" data-lobby-filter="official" aria-pressed="false" ${text('lobby.official')}</button>
          <button type="button" data-lobby-filter="private" aria-pressed="false" ${text('lobby.private')}</button>
        </div>
        <label class="check-chip"><input id="lobby-has-players" type="checkbox"><span ${text('lobby.hasPlayers')}</span></label>
        <label class="check-chip"><input id="lobby-not-full" type="checkbox"><span ${text('lobby.notFull')}</span></label>
        <select id="lobby-sort" class="select" ${aria('lobby.sort')}>
          <option value="default" ${text('lobby.sortDefault')}</option>
          <option value="busy" ${text('lobby.sortBusy')}</option>
          <option value="quiet" ${text('lobby.sortQuiet')}</option>
        </select>
        <span class="toolbar-spacer"></span>
        <button id="online-refresh" class="btn ghost icon-btn" type="button" ${aria('online.refresh')}>${icon('refresh')}</button>
      </div>

      <div id="online-split" class="online-split" data-view="list">
        <div class="room-list-wrap">
          <div class="room-list-head"><span ${text('rooms.list')}</span><span id="lobby-count" class="count-badge">0</span></div>
          <div id="online-rooms" class="room-list" role="listbox" tabindex="-1" ${aria('rooms.list')}></div>
        </div>
        <aside id="room-detail" class="room-detail"></aside>
      </div>
      <p id="online-status" class="online-status" role="status"></p>
    </section>
  </main>

  <div id="match" class="match" hidden>
    <div class="match-bar">
      <button id="back-lobby" class="btn ghost" type="button">${icon('arrowLeft')}<span ${text('lobby.back')}</span></button>
      <div class="match-title"><span class="live-dot" aria-hidden="true"></span><span id="match-status">${t('status.local')}</span></div>
      <div class="match-bar-right">${stageSwitchMarkup}<span class="rule-tag" ${text('match.bestOfThree')}</span></div>
    </div>
    <div class="arena">
      <div class="hud">
        <div class="health-player">
          <div class="health-label"><strong id="p1-label">${t('fighter.player',{id:'01'})}</strong><span id="hp-0">1000 / 1000</span></div>
          <div class="health-track" role="progressbar" ${aria('health.p1')} aria-valuemin="0" aria-valuemax="1000"><div id="health-0"></div></div>
          <div id="wins-0" class="round-wins"></div>
        </div>
        <div class="timer-wrap">
          <div id="timer">99</div>
          <span id="round-label">${t('hud.round',{round:'01'})}</span>
        </div>
        <div class="health-player player-two">
          <div class="health-label"><span id="hp-1">1000 / 1000</span><strong id="p2-label">${t('fighter.player',{id:'02'})}</strong></div>
          <div class="health-track" role="progressbar" ${aria('health.p2')} aria-valuemin="0" aria-valuemax="1000"><div id="health-1"></div></div>
          <div id="wins-1" class="round-wins"></div>
        </div>
      </div>
      <canvas id="game" width="960" height="420" ${aria('arena.canvas')}></canvas>
      <div class="resource-hud">
        ${[0,1].map(i=>`<div class="resource-player ${i?'player-two':''}">${(['revenge','special'] as const).map(name=>`<div class="${name}"><div class="resource-label"><span data-i18n="meter.${i}.${name}">${t(`meter.${i}.${name}` as TranslationKey)}</span><span id="resource-value-${i}-${name}">0 / 100</span></div><div id="resource-${i}-${name}" class="resource-track" role="progressbar" ${aria(`resource.p${i+1}${name==='revenge'?'Revenge':'Special'}` as TranslationKey)} aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="resource-fill"></div></div></div>`).join('')}</div>`).join('')}
      </div>
      <div class="arena-caption">
        <span id="arena-mode">${t('arena.local',{caption:t('stage.caption.dojo')})}</span>
        <span ${text('arena.tagline')}</span>
      </div>
      <div id="arena-overlay" class="arena-overlay" hidden>
        <div class="overlay-panel" role="group" aria-labelledby="overlay-title">
          <p id="overlay-title" class="overlay-title"></p>
          <p id="overlay-hint" class="overlay-hint"></p>
          <div class="overlay-actions">
            <button id="overlay-primary" class="btn brand" type="button"></button>
            <button id="overlay-secondary" class="btn" type="button"></button>
            <button id="overlay-lobby" class="btn ghost" type="button"></button>
          </div>
        </div>
      </div>
    </div>

    <div class="play-toolbar">
      <div class="toolbar-group">
        <button id="pause" class="btn" type="button">${t('button.pause')}</button>
        <button id="reset" class="btn" type="button">${icon('restart')}<span ${text('button.reset')}</span></button>
        <button id="online-leave" class="btn ghost danger" type="button" hidden>${icon('logOut')}<span ${text('match.leaveRoom')}</span></button>
      </div>
      <div id="opponent-bar" class="opponent-bar">
        <span class="field-label" ${text('match.opponent')}</span>
        <div class="segmented" role="radiogroup" ${aria('match.opponent')}>${LAUNCH_MODES.map(mode=>`<label><input type="radio" name="play-mode" value="${mode}"><span>${icon(modeIcons[mode])}<span ${text(`mode.${mode}`)}</span></span></label>`).join('')}</div>
        <select id="match-difficulty" class="select" ${aria('launch.difficulty')}>${levels.map(level=>`<option value="${level}" data-i18n="difficulty.${level}">${t(`difficulty.${level}`)}</option>`).join('')}</select>
        <select id="match-dummy" class="select" ${aria('launch.dummy')}>${dummies.map(mode=>`<option value="${mode}" data-i18n="dummy.${mode}">${t(`dummy.${mode}`)}</option>`).join('')}</select>
      </div>
    </div>

    <section id="match-chat" class="chat-panel" hidden aria-labelledby="chat-title">
      <div class="panel-head"><h3 id="chat-title">${icon('message')}<span ${text('match.chat')}</span></h3></div>
      <div id="online-log" class="online-log" role="log" aria-live="polite"></div>
      <form id="chat-form" class="chat-form"><input id="online-chat" maxlength="80" autocomplete="off" ${aria('online.chat')}><button class="btn primary icon-btn" type="submit" ${aria('match.send')}>${icon('send')}</button></form>
    </section>

    <div class="match-info">
      <section class="keys-section" aria-labelledby="keys-title">
        <div class="panel-head"><h3 id="keys-title">${icon('keyboard')}<span ${text('keys.title')}</span></h3></div>
        <div class="controls">${controlsMarkup}</div>
      </section>
      <section class="moves-section" aria-labelledby="moves-title">
        <div class="panel-head"><h3 id="moves-title">${icon('zap')}<span ${text('keys.moves')}</span></h3></div>
        <ul id="move-list" class="move-list"></ul>
        <p class="hint" ${text('keys.movesHint')}</p>
      </section>
    </div>
    <details id="settings-details" class="settings-details"><summary>${icon('settings')}<span ${text('settings.summary')}</span>${icon('chevronRight','summary-chevron')}</summary><div id="settings"></div></details>

    <div id="dev-tools" class="dev-tools" hidden>
      <div class="toolbar">
        <div class="toolbar-group">
          <button id="step" class="btn sm" disabled ${text('button.step')}</button>
          <button id="boxes" class="btn sm" aria-pressed="false" ${text('button.boxes')}</button>
          <button id="inputs" class="btn sm" aria-pressed="false" ${text('button.inputs')}</button>
          <button id="states" class="btn sm" aria-pressed="false" ${text('button.states')}</button>
        </div>
        <span class="hint" ${text('controls.hint')}</span>
      </div>
      <div class="training-bar">
        <div class="toolbar-group">
          <button id="training" class="btn sm" aria-pressed="false" ${text('button.training')}</button>
          <button id="dummy" class="btn sm" disabled>${t('training.dummy',{mode:t('dummy.stand')})}</button>
          <button id="cpu" class="btn sm" aria-pressed="false">${t('training.cpu',{state:t('common.off')})}</button>
          <button id="demo" class="btn sm" aria-pressed="false">${t('training.demo',{state:t('common.off')})}</button>
          <label class="cpu-level" id="cpu-level-0-wrap"><span ${text('cpu.label1')}</span> <select id="cpu-level-0" class="select" ${aria('difficulty.p1')}>${levels.map(level=>`<option value="${level}" data-i18n="difficulty.${level}">${t(`difficulty.${level}`)}</option>`).join('')}</select></label>
          <label class="cpu-level"><span ${text('cpu.label2')}</span> <select id="cpu-level" class="select" ${aria('difficulty.p2')}>${levels.map(level=>`<option value="${level}" data-i18n="difficulty.${level}">${t(`difficulty.${level}`)}</option>`).join('')}</select></label>
        </div>
        <div class="toolbar-group">
          <button id="record" class="btn sm" ${text('button.record')}</button>
          <button id="play" class="btn sm" disabled ${text('button.replay')}</button>
          <button id="export-replay" class="btn sm" disabled ${text('button.save')}</button>
          <button id="import-replay" class="btn sm" ${text('button.load')}</button>
          <input id="replay-file" type="file" accept="application/json,.json" hidden>
        </div>
      </div>
      ${previewMarkup}
      <div class="debug" id="debug" hidden><pre id="state-0"></pre><pre id="state-1"></pre><pre id="cpu-debug" hidden></pre></div>
      <div class="debug input-history" id="input-history" hidden>
        <div><span class="eyebrow">P1 / <span ${text('input.latest')}</span></span><pre id="input-0"></pre></div>
        <div><span class="eyebrow">P2 / <span ${text('input.latest')}</span></span><pre id="input-1"></pre></div>
      </div>
    </div>
    <div class="notice" id="notice" role="status"></div>
  </div>
  <footer class="footer"><span ${text('footer.tagline')}</span><span ${text('footer.build')}</span></footer>
</div>`;
