import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Runs in the main vitest process, whose TWEAKCC_CONFIG_DIR is never the one
// the workers get pinned to. The subject is the OPERATOR'S real config file,
// resolved from the account record rather than $HOME: os.homedir() returns
// $HOME when it is set, so a probe that redirects HOME would carry the guard's
// subject along with it -- the guard would then name a throwaway path as "the
// live home" and stop watching the real one. Falling back to os.homedir() only
// where the account record cannot be read at all.
const liveConfigFile = (): string => {
  let home: string;
  try {
    home = os.userInfo().homedir;
  } catch {
    home = os.homedir();
  }
  return path.join(home, '.tweakcc', 'config.json');
};

interface Stamp {
  exists: boolean;
  md5: string | null;
  mtimeMs: number | null;
}

const stampOf = (file: string): Stamp => {
  try {
    const stat = fs.statSync(file);
    const md5 = crypto
      .createHash('md5')
      .update(fs.readFileSync(file))
      .digest('hex');
    return { exists: true, md5, mtimeMs: stat.mtimeMs };
  } catch {
    return { exists: false, md5: null, mtimeMs: null };
  }
};

const describeStamp = (s: Stamp): string =>
  s.exists ? `md5=${s.md5} mtimeMs=${s.mtimeMs}` : 'absent';

let before: Stamp;
let rescueCopy: string | null = null;

export function setup(): void {
  const file = liveConfigFile();
  before = stampOf(file);

  // A byte-identical rescue copy is taken before the suite so that a run which
  // trips this guard can still be undone: the guard reports, it does not
  // repair, and a silent repair would hide the very write it exists to catch.
  if (before.exists) {
    rescueCopy = path.join(
      os.tmpdir(),
      `tweakcc-live-config-rescue.${process.pid}.json`
    );
    fs.copyFileSync(file, rescueCopy);
  }
}

export function teardown(): void {
  const file = liveConfigFile();
  const after = stampOf(file);

  if (
    after.exists === before.exists &&
    after.md5 === before.md5 &&
    after.mtimeMs === before.mtimeMs
  ) {
    // The copy exists ONLY to undo a run that tripped this guard; a green run
    // has nothing to undo. Without this the suite left one 28 KB file per run
    // in the temp dir forever -- measured: 118 of them had accumulated before
    // this branch existed. Failure to remove it is not worth failing on.
    if (rescueCopy !== null) {
      try {
        fs.rmSync(rescueCopy, { force: true });
      } catch {
        /* a leftover copy is harmless; reddening a green suite over it is not */
      }
    }
    return;
  }

  throw new Error(
    [
      `The test run touched the live tweakcc config home: ${file}`,
      `  before: ${describeStamp(before)}`,
      `  after:  ${describeStamp(after)}`,
      rescueCopy
        ? `  byte-for-byte copy taken before the run: ${rescueCopy}`
        : '  no copy was taken: the file did not exist before the run',
      'Tests must reach their config home through TWEAKCC_CONFIG_DIR, which',
      'src/tests/setup/pinConfigHome.ts pins to a throwaway directory.',
    ].join('\n')
  );
}
