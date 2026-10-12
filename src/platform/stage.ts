import { DEFAULT_STAGE, STAGE_IDS, isStageId, type StageId } from '../render/stages';
import { t } from './i18n';

export const STAGE_STORAGE_KEY = 'stickman.stage';

/** Segmented stage switch in the arena header; presentation state like the theme. */
export const stageSwitchMarkup = `<div class="stage-switch segmented" role="group" data-i18n-aria-label="stage.group" aria-label="${t('stage.group')}">${STAGE_IDS.map(id=>`<button type="button" data-stage="${id}" data-i18n="stage.${id}" aria-pressed="false">${t(`stage.${id}`)}</button>`).join('')}</div>`;

/** Lobby picker: same choice, shown as rendered stage thumbnails. */
export const stagePickerMarkup = `<div class="stage-picker" role="group" data-i18n-aria-label="stage.group" aria-label="${t('stage.group')}">${STAGE_IDS.map(id=>`<button type="button" class="stage-pick" data-stage-pick="${id}" aria-pressed="false"><canvas class="stage-thumb" data-stage-thumb="${id}" width="240" height="106" aria-hidden="true"></canvas><span data-i18n="stage.${id}">${t(`stage.${id}`)}</span></button>`).join('')}</div>`;

export function loadStage(): StageId {
  try { const stored=localStorage.getItem(STAGE_STORAGE_KEY);if(isStageId(stored))return stored; } catch { /* Storage denied: session default. */ }
  return DEFAULT_STAGE;
}

export function setupStage(root: ParentNode, onChange: (stage: StageId) => void): (stage: StageId) => void {
  let stage=loadStage();
  const buttons=[...root.querySelectorAll<HTMLButtonElement>('[data-stage],[data-stage-pick]')];
  function apply(): void {
    for(const button of buttons)button.setAttribute('aria-pressed',String((button.dataset.stage??button.dataset.stagePick)===stage));
    onChange(stage);
  }
  function select(next: StageId): void {
    stage=next;apply();
    try { localStorage.setItem(STAGE_STORAGE_KEY,stage); } catch { /* Keep the applied session preference. */ }
  }
  for(const button of buttons)button.addEventListener('click',()=>{
    const next=button.dataset.stage??button.dataset.stagePick;
    if(isStageId(next))select(next);
  });
  apply();
  return select;
}
