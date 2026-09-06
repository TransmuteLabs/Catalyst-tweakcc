// utils.ts imports ./patches/modelSelector, which imports ../config, so a
// module graph entered through utils reaches getConfigDir() while utils itself
// is still evaluating. Import order below reproduces that entry; keep it.
import '../utils';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect } from 'vitest';
import { CONFIG_DIR, CONFIG_FILE } from '../config';

describe('config home resolution under the utils import cycle', () => {
  it('honours TWEAKCC_CONFIG_DIR when the graph is entered through utils', () => {
    const pinned = process.env.TWEAKCC_CONFIG_DIR;
    expect(pinned).toBeTruthy();
    expect(CONFIG_DIR).toBe(path.resolve(pinned as string));
    expect(CONFIG_FILE).toBe(
      path.join(path.resolve(pinned as string), 'config.json')
    );
  });

  it('does not resolve to a config home in use', () => {
    const realHomes = [
      path.join(os.homedir(), '.tweakcc'),
      path.join(os.homedir(), '.claude', 'tweakcc'),
    ];
    for (const home of realHomes) {
      expect(CONFIG_DIR).not.toBe(home);
    }
  });
});
