import { afterEach, describe, expect, it } from 'vitest';

import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAG_DESCRIPTIONS,
  FEATURE_FLAG_OVERRIDE_PREFIX,
  FEATURE_FLAGS,
  __resetFeatureFlagsForTests,
  __setFeatureFlagForTests,
  clearFeatureFlagOverride,
  configureFeatureFlagRuntimeDefaults,
  featureFlagOverrideKey,
  getFeatureFlagSnapshot,
  isFeatureEnabled,
  isFeatureFlagId,
  setFeatureFlagOverride,
} from './feature-flags';

describe('feature flag contract', () => {
  afterEach(() => {
    __resetFeatureFlagsForTests();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('exposes the v0.4 flags plus the v0.5 workbench flag (ADR-003)', () => {
    expect([...FEATURE_FLAGS].sort()).toEqual([
      'v04Assistant',
      'v04Canvas',
      'v04CollabGateway',
      'v04Collaboration',
      'v04Research',
      'v04Shell',
      'v04Study',
      'v05Workbench',
    ]);
  });

  it('every flag defaults to off (release gate: nothing ships enabled)', () => {
    for (const flag of FEATURE_FLAGS) {
      expect(FEATURE_FLAG_DEFAULTS[flag]).toBe(false);
    }
  });

  it('every flag has a human description', () => {
    for (const flag of FEATURE_FLAGS) {
      expect(FEATURE_FLAG_DESCRIPTIONS[flag].length).toBeGreaterThan(0);
    }
  });

  it('isFeatureFlagId is a closed guard', () => {
    for (const flag of FEATURE_FLAGS) {
      expect(isFeatureFlagId(flag)).toBe(true);
    }
    expect(isFeatureFlagId('v99Unknown')).toBe(false);
    expect(isFeatureFlagId('')).toBe(false);
    expect(isFeatureFlagId(null)).toBe(false);
  });

  it('isFeatureEnabled returns the default when nothing is overridden', () => {
    expect(isFeatureEnabled('v04Shell')).toBe(false);
    expect(isFeatureEnabled('v04Assistant')).toBe(false);
    expect(isFeatureEnabled('v04Research')).toBe(false);
  });

  it('storage override can flip a flag at runtime', () => {
    setFeatureFlagOverride('v04Shell', true);
    expect(isFeatureEnabled('v04Shell')).toBe(true);
    expect(isFeatureEnabled('v04Assistant')).toBe(false); // unaffected
    clearFeatureFlagOverride('v04Shell');
    expect(isFeatureEnabled('v04Shell')).toBe(false);
  });

  it('uses runtime defaults below explicit storage overrides', () => {
    configureFeatureFlagRuntimeDefaults({
      v04Shell: true,
      v04Study: true,
      v04Research: true,
    });
    expect(isFeatureEnabled('v04Shell')).toBe(true);
    expect(isFeatureEnabled('v04Assistant')).toBe(false);
    expect(getFeatureFlagSnapshot().find((s) => s.id === 'v04Study')).toEqual({
      id: 'v04Study',
      value: true,
      source: 'runtime',
    });

    setFeatureFlagOverride('v04Shell', false);
    expect(isFeatureEnabled('v04Shell')).toBe(false);
  });

  it('storage override accepts "1"/"0" and "true"/"false"', () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(featureFlagOverrideKey('v04Assistant'), 'true');
    expect(isFeatureEnabled('v04Assistant')).toBe(true);
    localStorage.setItem(featureFlagOverrideKey('v04Assistant'), '0');
    expect(isFeatureEnabled('v04Assistant')).toBe(false);
    localStorage.setItem(featureFlagOverrideKey('v04Assistant'), 'false');
    expect(isFeatureEnabled('v04Assistant')).toBe(false);
    localStorage.setItem(featureFlagOverrideKey('v04Assistant'), '1');
    expect(isFeatureEnabled('v04Assistant')).toBe(true);
  });

  it('storage override ignores garbage values', () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(featureFlagOverrideKey('v04Research'), 'maybe');
    // Falls back to default.
    expect(isFeatureEnabled('v04Research')).toBe(false);
  });

  it('test overrides take precedence over storage', () => {
    setFeatureFlagOverride('v04Shell', false);
    __setFeatureFlagForTests('v04Shell', true);
    expect(isFeatureEnabled('v04Shell')).toBe(true);
    __setFeatureFlagForTests('v04Shell', false);
    expect(isFeatureEnabled('v04Shell')).toBe(false);
  });

  it('storage key is namespaced under studykit.v04.feature.', () => {
    expect(featureFlagOverrideKey('v04Shell')).toBe(
      `${FEATURE_FLAG_OVERRIDE_PREFIX}v04Shell`,
    );
  });

  it('snapshot reports the source of every value', () => {
    // Two defaults.
    expect(getFeatureFlagSnapshot()).toEqual([
      { id: 'v04Shell', value: false, source: 'default' },
      { id: 'v04Assistant', value: false, source: 'default' },
      { id: 'v04Study', value: false, source: 'default' },
      { id: 'v04Research', value: false, source: 'default' },
      { id: 'v04Canvas', value: false, source: 'default' },
      { id: 'v04Collaboration', value: false, source: 'default' },
      { id: 'v04CollabGateway', value: false, source: 'default' },
      { id: 'v05Workbench', value: false, source: 'default' },
    ]);
    // Flip one via storage.
    setFeatureFlagOverride('v04Assistant', true);
    const snap = getFeatureFlagSnapshot();
    expect(snap.find((s) => s.id === 'v04Assistant')).toEqual({
      id: 'v04Assistant',
      value: true,
      source: 'storage',
    });
    // Test override wins.
    __setFeatureFlagForTests('v04Research', true);
    expect(getFeatureFlagSnapshot().find((s) => s.id === 'v04Research')).toEqual({
      id: 'v04Research',
      value: true,
      source: 'test',
    });
  });

  it('clearFeatureFlagOverride falls back to the default', () => {
    setFeatureFlagOverride('v04Assistant', true);
    clearFeatureFlagOverride('v04Assistant');
    expect(isFeatureEnabled('v04Assistant')).toBe(false);
  });
});
