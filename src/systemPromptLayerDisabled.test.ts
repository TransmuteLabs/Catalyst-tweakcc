import { describe, expect, it, afterEach, vi, beforeEach } from 'vitest';

import {
  SYSTEM_PROMPT_LAYER_DISABLED_LINE,
  isSystemPromptLayerDisabled,
  preloadStringsFile,
} from './systemPromptSync';
import { downloadStringsFile } from './systemPromptDownload';

vi.mock('./systemPromptDownload');

const KEY = 'TWEAKCC_NO_SYSTEM_PROMPTS';

const emptyStringsFile = { version: '1.0.0', prompts: [] };

beforeEach(() => {
  vi.mocked(downloadStringsFile).mockResolvedValue(emptyStringsFile);
});

afterEach(() => {
  delete process.env[KEY];
  vi.clearAllMocks();
});

describe('system prompt layer knob', () => {
  it('is enabled when the variable is unset', () => {
    delete process.env[KEY];
    expect(isSystemPromptLayerDisabled()).toBe(false);
  });

  // The off-words matter as much as the on-words: a consumer that exports the
  // variable as "0" to mean "keep the layer" must not have the layer silently
  // switched off by the mere presence of the name.
  it.each(['', '  ', '0', 'false', 'FALSE', 'off', 'Off', 'no'])(
    'stays enabled for %o',
    value => {
      process.env[KEY] = value;
      expect(isSystemPromptLayerDisabled()).toBe(false);
    }
  );

  it.each(['1', 'true', 'yes', 'on', ' 1 '])('disables for %o', value => {
    process.env[KEY] = value;
    expect(isSystemPromptLayerDisabled()).toBe(true);
  });

  // The announcement is a contract with the caller, not decoration: a consumer
  // greps this literal to tell "disabled on purpose" from "snapshot
  // unreachable". Changing the text breaks that reader, so it is pinned here.
  it('announces the disabled state with a stable literal', () => {
    expect(SYSTEM_PROMPT_LAYER_DISABLED_LINE).toBe(
      'System prompt layer DISABLED by TWEAKCC_NO_SYSTEM_PROMPTS (no snapshot download, no overlay patch)'
    );
    expect(SYSTEM_PROMPT_LAYER_DISABLED_LINE).not.toContain(
      'System prompts not available'
    );
  });
});

// The knob's promise is "no snapshot download". The startup sync is not the
// only door to the network: preloadStringsFile is reached from the apply path
// and from the interactive app, so the gate lives inside it -- a call site
// added later inherits the disabled state instead of quietly reopening the
// dependency.
describe('preloadStringsFile honours the knob', () => {
  it('does not reach the network when the layer is disabled', async () => {
    process.env[KEY] = '1';
    const result = await preloadStringsFile('2.1.267');
    expect(vi.mocked(downloadStringsFile)).not.toHaveBeenCalled();
    // Not an error: the layer is off by choice, and the callers use this flag
    // only to print a download failure.
    expect(result).toEqual({ success: true });
  });

  it('downloads when the layer is enabled', async () => {
    delete process.env[KEY];
    const result = await preloadStringsFile('2.1.267');
    expect(vi.mocked(downloadStringsFile)).toHaveBeenCalledWith('2.1.267');
    expect(result).toEqual({ success: true });
  });

  // --list-system-prompts asks for the snapshot itself; the knob must not make
  // that flag print nothing.
  it('downloads for an explicit opt-out even while disabled', async () => {
    process.env[KEY] = '1';
    await preloadStringsFile('2.1.267', { ignoreLayerKnob: true });
    expect(vi.mocked(downloadStringsFile)).toHaveBeenCalledWith('2.1.267');
  });
});
