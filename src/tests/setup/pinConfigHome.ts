import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Setup file: it is imported before the test file's own module graph, which is
// the only moment that works -- src/config.ts resolves CONFIG_DIR once, at
// import time, so an env var set inside a test arrives too late.
//
// The pin uses TWEAKCC_CONFIG_DIR, the same override the product honours first
// in getConfigDir(); nothing test-only is added to the resolution order.

const REGISTRY = Symbol.for('tweakcc.tests.pinnedConfigHomes');

const realConfigHomeCandidates = (): string[] => {
  const home = os.homedir();
  const xdg = process.env.XDG_CONFIG_HOME;
  const candidates = [
    path.join(home, '.tweakcc'),
    path.join(home, '.claude', 'tweakcc'),
  ];
  if (xdg) {
    candidates.push(path.join(xdg, 'tweakcc'));
  }
  return candidates.map(c => path.resolve(c));
};

const isInside = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(parent + path.sep);

const pinTarget = (): string => {
  const requested = process.env.TWEAKCC_TEST_CONFIG_DIR?.trim();
  if (requested && requested.length > 0) {
    const resolved = path.resolve(requested);
    // The bench (scripts/find-live-home-writer.sh) aims the suite at a COPY of
    // a config home; aiming it at a real one is the defect this file exists to
    // make impossible, so it is refused rather than honoured.
    for (const candidate of realConfigHomeCandidates()) {
      if (isInside(resolved, candidate)) {
        throw new Error(
          `TWEAKCC_TEST_CONFIG_DIR points at a real tweakcc config home (${candidate}). ` +
            'Point it at a copy instead: the test suite never runs against a home in use.'
        );
      }
    }
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  }

  // One throwaway home per test file: a home shared between files would let one
  // file's written config decide another file's reads.
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tweakcc-test-home-'));
};

const target = pinTarget();
process.env.TWEAKCC_CONFIG_DIR = target;

if (!process.env.TWEAKCC_TEST_CONFIG_DIR) {
  const globals = globalThis as Record<symbol, unknown>;
  let registry = globals[REGISTRY] as string[] | undefined;
  if (!registry) {
    registry = [];
    globals[REGISTRY] = registry;
    // Registered once per worker process: setup files re-evaluate for every
    // test file, and a listener per file would trip the max-listeners warning.
    process.once('exit', () => {
      for (const dir of registry as string[]) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // A leftover temp directory is not worth failing a green run over.
        }
      }
    });
  }
  registry.push(target);
}
