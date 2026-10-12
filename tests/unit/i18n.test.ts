import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, getLanguage, isLanguage, loadLanguage, setLanguage, t } from '../../src/platform/i18n';

afterEach(()=>{setLanguage(DEFAULT_LANGUAGE);vi.unstubAllGlobals();});

it('uses Chinese as the default and validates only supported languages',()=>{
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});
  expect(loadLanguage()).toBe('zh');
  expect(isLanguage('zh')).toBe(true);expect(isLanguage('en')).toBe(true);expect(isLanguage('de')).toBe(true);
  for(const value of ['fr','EN','zh-CN','',null,undefined])expect(isLanguage(value)).toBe(false);
});

it('loads a saved language and falls back safely when storage is invalid or blocked',()=>{
  expect(loadLanguage({getItem:()=> 'de'})).toBe('de');
  expect(loadLanguage({getItem:()=> 'fr'})).toBe('zh');
  expect(loadLanguage({getItem:()=>{throw Error('denied');}})).toBe('zh');
});

it('switches dictionaries, interpolates values and persists the selection',()=>{
  const setItem=vi.fn();vi.stubGlobal('localStorage',{getItem:()=>null,setItem});
  setLanguage('de');
  expect(getLanguage()).toBe('de');
  expect(t('button.reset')).toBe('Neustart');
  expect(t('message.replayLoaded',{frames:42})).toContain('42 Frames');
  expect(setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY,'de');
  setLanguage('en');
  expect(t('button.reset')).toBe('Restart');
  setLanguage('zh');
  expect(t('button.reset')).toBe('重新开始');
  expect(t('message.replayLoaded',{frames:42})).toContain('42');
});
