import { useState, useEffect, useCallback } from 'react';

export interface TabPreferences {
  enabled: boolean;
  maxTabs: number;
  showPinButton: boolean;
  warnOnClose: boolean;
  restoreTabs: boolean;
  tabPosition: 'top' | 'bottom';
}

const DEFAULT_PREFERENCES: TabPreferences = {
  enabled: true, // Feature flag - enabled for testing
  maxTabs: 100, // High default - EditorPool manages memory with sleep state (max 20 rendered)
  showPinButton: true,
  warnOnClose: true,
  restoreTabs: true,
  tabPosition: 'top'
};

const STORAGE_KEY = 'tabPreferences';

export function useTabPreferences() {
  const [preferences, setPreferences] = useState<TabPreferences>(DEFAULT_PREFERENCES);

  // Load preferences from the app-settings store on mount (via IPC).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await window.electronAPI.invoke('app-settings:get', STORAGE_KEY) as Partial<TabPreferences> | undefined;
        if (!cancelled && saved) {
          setPreferences({ ...DEFAULT_PREFERENCES, ...saved });
        }
      } catch (error) {
        console.error('Failed to load tab preferences:', error);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Save preferences to the app-settings store (via IPC).
  const savePreferences = useCallback((newPreferences: Partial<TabPreferences>) => {
    const updated = { ...preferences, ...newPreferences };
    setPreferences(updated);
    window.electronAPI.invoke('app-settings:set', STORAGE_KEY, updated)
      .catch((error) => console.error('Failed to save tab preferences:', error));
  }, [preferences]);

  // Toggle tabs enabled/disabled
  const toggleTabs = useCallback(() => {
    savePreferences({ enabled: !preferences.enabled });
  }, [preferences.enabled, savePreferences]);

  // Update max tabs
  const setMaxTabs = useCallback((maxTabs: number) => {
    if (maxTabs >= 1 && maxTabs <= 1000) {
      savePreferences({ maxTabs });
    }
  }, [savePreferences]);

  // Reset to defaults
  const resetToDefaults = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
    window.electronAPI.invoke('app-settings:set', STORAGE_KEY, DEFAULT_PREFERENCES)
      .catch((error) => console.error('Failed to reset tab preferences:', error));
  }, []);

  return {
    preferences,
    savePreferences,
    toggleTabs,
    setMaxTabs,
    resetToDefaults
  };
}