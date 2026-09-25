import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TweakccConfig } from '../types';

const STORED_PHASES = ['·', '✢', '✳', '✶', '✻', '✽'];
const originalPlatform = process.platform;
const originalTerm = process.env.TERM;

async function loadUnder(platform: NodeJS.Platform, term: string | undefined) {
  Object.defineProperty(process, 'platform', { value: platform });
  if (term === undefined) delete process.env.TERM;
  else process.env.TERM = term;
  vi.resetModules();
  const { DEFAULT_SETTINGS } = await import('../defaultSettings');
  const { isPatchEnabledByConfig } = await import('../applyPlan');
  return { DEFAULT_SETTINGS, isPatchEnabledByConfig };
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  if (originalTerm === undefined) delete process.env.TERM;
  else process.env.TERM = originalTerm;
  vi.resetModules();
});

describe('thinkingStyle default does not depend on platform or TERM (#385)', () => {
  const cases: Array<[NodeJS.Platform, string | undefined]> = [
    ['darwin', 'xterm-256color'],
    ['linux', 'xterm-256color'],
    ['win32', undefined],
    ['darwin', 'xterm-ghostty'],
    ['linux', 'xterm-ghostty'],
  ];

  for (const [platform, term] of cases) {
    it(`${platform} TERM=${term ?? '<unset>'}: default phases are the one fixed set`, async () => {
      const { DEFAULT_SETTINGS } = await loadUnder(platform, term);
      expect(DEFAULT_SETTINGS.thinkingStyle.phases).toEqual(STORED_PHASES);
    });

    it(`${platform} TERM=${term ?? '<unset>'}: a stored default config plans no thinker-symbol patch`, async () => {
      const { DEFAULT_SETTINGS, isPatchEnabledByConfig } = await loadUnder(
        platform,
        term
      );
      const config = {
        settings: {
          ...DEFAULT_SETTINGS,
          thinkingStyle: {
            ...DEFAULT_SETTINGS.thinkingStyle,
            phases: [...STORED_PHASES],
          },
        },
      } as TweakccConfig;
      expect(
        isPatchEnabledByConfig('thinker-symbol-chars', config, '2.1.282')
      ).toBe(false);
      expect(
        isPatchEnabledByConfig('thinker-symbol-width', config, '2.1.282')
      ).toBe(false);
    });
  }

  it('a customised config still plans both thinker-symbol patches on linux', async () => {
    const { DEFAULT_SETTINGS, isPatchEnabledByConfig } = await loadUnder(
      'linux',
      'xterm-256color'
    );
    const config = {
      settings: {
        ...DEFAULT_SETTINGS,
        thinkingStyle: {
          ...DEFAULT_SETTINGS.thinkingStyle,
          phases: ['·', '✢', '*', '✶', '✻', '✽'],
        },
      },
    } as TweakccConfig;
    expect(
      isPatchEnabledByConfig('thinker-symbol-chars', config, '2.1.282')
    ).toBe(true);
    expect(
      isPatchEnabledByConfig('thinker-symbol-width', config, '2.1.282')
    ).toBe(true);
  });
});
