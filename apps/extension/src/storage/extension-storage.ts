import type { TranslationProviderConfig } from '@translate/contracts';
import { DEFAULT_MOCK_PROFILE, DEFAULT_PROFILES } from './default-configs';

export interface ExtensionSettings {
  activeProfileId: string;
  profiles: TranslationProviderConfig[];
  targetLanguage: string;
  sourceLanguage: string;
  autoTranslate: boolean;
  bilingualDisplay: boolean;
  showFloatingControl: boolean;
  mockDelayMs: number;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  activeProfileId: DEFAULT_MOCK_PROFILE.profileId,
  profiles: DEFAULT_PROFILES,
  targetLanguage: 'zh-CN',
  sourceLanguage: 'auto',
  autoTranslate: false,
  bilingualDisplay: true,
  showFloatingControl: true,
  mockDelayMs: 120,
};

const STORAGE_KEY = 'omni_translate_settings';

// 内存回退，以防在无 chrome.storage 环境（纯单元测试或独立页面）中报错
let memoryFallback: ExtensionSettings = { ...DEFAULT_SETTINGS };

export async function loadSettings(): Promise<ExtensionSettings> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      if (data && data[STORAGE_KEY]) {
        return {
          ...DEFAULT_SETTINGS,
          ...data[STORAGE_KEY],
        };
      }
    }
  } catch (err) {
    console.warn('[Storage] Failed to read chrome.storage.local, using fallback', err);
  }
  return { ...memoryFallback };
}

export async function saveSettings(
  partial: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const updated: ExtensionSettings = {
    ...current,
    ...partial,
  };

  memoryFallback = { ...updated };

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: updated });
    }
  } catch (err) {
    console.warn('[Storage] Failed to save to chrome.storage.local', err);
  }

  return updated;
}

export async function getActiveProfile(): Promise<TranslationProviderConfig> {
  const settings = await loadSettings();
  const found = settings.profiles.find((p) => p.profileId === settings.activeProfileId);
  return found || settings.profiles[0] || DEFAULT_MOCK_PROFILE;
}

export async function saveProfile(profile: TranslationProviderConfig): Promise<void> {
  const settings = await loadSettings();
  const index = settings.profiles.findIndex((p) => p.profileId === profile.profileId);
  const updatedProfiles = [...settings.profiles];

  if (index >= 0) {
    updatedProfiles[index] = { ...profile, revision: (profile.revision || 1) + 1 };
  } else {
    updatedProfiles.push({ ...profile, revision: 1 });
  }

  await saveSettings({ profiles: updatedProfiles });
}

export async function deleteProfile(profileId: string): Promise<void> {
  const settings = await loadSettings();
  const updatedProfiles = settings.profiles.filter((p) => p.profileId !== profileId);
  const newActiveId =
    settings.activeProfileId === profileId
      ? updatedProfiles[0]?.profileId || DEFAULT_MOCK_PROFILE.profileId
      : settings.activeProfileId;

  await saveSettings({
    profiles: updatedProfiles,
    activeProfileId: newActiveId,
  });
}
