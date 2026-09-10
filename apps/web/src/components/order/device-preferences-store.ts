'use client';

import { useEffect, useState } from 'react';
import { EMPTY_DEVICE_PREFERENCES, readDevicePreferences, subscribeDevicePreferences, type DevicePreferences } from './device-preferences';

export function useDevicePreferences(slug: string, enabled = true) {
  const [state, setState] = useState<{ slug: string; preferences: DevicePreferences; hydrated: boolean; error: string | null }>(() => ({ slug, preferences: EMPTY_DEVICE_PREFERENCES, hydrated: false, error: null }));
  useEffect(() => {
    if (!enabled) return;
    let alive = true, generation = 0;
    const read = async () => {
      const run = ++generation;
      try {
        const preferences = await readDevicePreferences(slug);
        if (alive && generation === run) setState({ slug, preferences, hydrated: true, error: null });
      } catch {
        if (alive && generation === run) setState({ slug, preferences: EMPTY_DEVICE_PREFERENCES, hydrated: true, error: 'Les préférences de cet appareil ne peuvent pas être relues.' });
      }
    };
    void read(); const changed = () => { void read(); };
    const unsubscribe = subscribeDevicePreferences(slug, changed);
    window.addEventListener('focus', changed); window.addEventListener('pageshow', changed);
    // Expired convenience choices must not persist in a long-lived storefront.
    const timer = window.setInterval(changed, 60_000);
    return () => { alive = false; generation++; unsubscribe(); window.clearInterval(timer); window.removeEventListener('focus', changed); window.removeEventListener('pageshow', changed); };
  }, [slug, enabled]);
  return enabled && state.slug === slug ? state : { slug, preferences: EMPTY_DEVICE_PREFERENCES, hydrated: !enabled, error: null };
}
