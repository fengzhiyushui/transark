import type { TranslationProviderConfig, DisplayMode } from '@translate/contracts';
import type { CloudServiceConfig } from '../cloud/client';
import { DEFAULT_PROFILES, DEFAULT_OPENAI_CHAT_PROFILE } from './default-configs';

export interface ExtensionSettings {
  activeProfileId: string;
  profiles: TranslationProviderConfig[];
  targetLanguage: string;
  sourceLanguage: string;
  autoTranslate: boolean;
  bilingualDisplay: boolean;
  displayMode: DisplayMode;
  showFloatingControl: boolean;
  cloud: CloudServiceConfig;
}

export const DEFAULT_CLOUD_CONFIG: CloudServiceConfig = {
  endpoint: 'http://127.0.0.1:8780',
  apiKey: '',
  enabled: false,
  asrFallback: true,
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  activeProfileId: DEFAULT_OPENAI_CHAT_PROFILE.profileId,
  profiles: DEFAULT_PROFILES,
  targetLanguage: 'zh-CN',
  sourceLanguage: 'auto',
  autoTranslate: false,
  bilingualDisplay: true,
  displayMode: 'bilingual',
  showFloatingControl: true,
  cloud: DEFAULT_CLOUD_CONFIG,
};

const STORAGE_KEY = 'omni_translate_settings';

// 内存回退，以防在无 chrome.storage 环境（纯单元测试或独立页面）中报错
let memoryFallback: ExtensionSettings = { ...DEFAULT_SETTINGS };

export async function loadSettings(): Promise<ExtensionSettings> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      if (data && data[STORAGE_KEY]) {
        const stored = data[STORAGE_KEY] as Partial<ExtensionSettings>;
        // 旧版本存在「本地接入」Profile；该模式已移除，加载时静默清理。
        const rawProfiles = (
          Array.isArray(stored.profiles) ? stored.profiles : DEFAULT_SETTINGS.profiles
        ) as Array<TranslationProviderConfig & { accessMode?: string }>;
        const profiles = rawProfiles.filter((profile) => profile?.accessMode !== 'local');
        const normalizedProfiles = profiles.length > 0 ? profiles : DEFAULT_SETTINGS.profiles;
        const activeProfileId = normalizedProfiles.some(
          (profile) => profile.profileId === stored.activeProfileId
        )
          ? (stored.activeProfileId as string)
          : normalizedProfiles[0]?.profileId || DEFAULT_SETTINGS.activeProfileId;

        return {
          ...DEFAULT_SETTINGS,
          ...stored,
          profiles: normalizedProfiles,
          activeProfileId,
          // 旧版本没有 cloud 字段；嵌套合并避免用户已填配置被默认值覆盖
          cloud: { ...DEFAULT_CLOUD_CONFIG, ...(stored.cloud || {}) },
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
  return found || settings.profiles[0] || DEFAULT_OPENAI_CHAT_PROFILE;
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
      ? updatedProfiles[0]?.profileId || DEFAULT_OPENAI_CHAT_PROFILE.profileId
      : settings.activeProfileId;

  await saveSettings({
    profiles: updatedProfiles,
    activeProfileId: newActiveId,
  });
}
