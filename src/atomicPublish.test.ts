import { afterEach, describe, expect, it, vi } from 'vitest';

import fsSync from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { replaceFileBreakingHardLinks } from './utils';
import { atomicWriteBinary, atomicWriteBuffer } from './nativeInstallation';

// Every tooth plays out on a small stand-in "image" file in a throwaway
// directory: the suite never touches a real Claude installation, and every
// directory it creates is removed again in afterEach.
const dirs: string[] = [];

const makeDir = (): string => {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'tweakcc-atomic-'));
  dirs.push(dir);
  return dir;
};

const makeContent = (byte: number, size = 256 * 1024): Buffer =>
  Buffer.alloc(size, byte);

const writeTarget = (
  dir: string,
  name: string,
  content: Buffer,
  mode = 0o755
): string => {
  const target = path.join(dir, name);
  fsSync.writeFileSync(target, content, { mode });
  return target;
};

// A publish must leave no sibling temp file behind, whatever happened.
const tempLeftovers = (dir: string, name: string): string[] =>
  fsSync
    .readdirSync(dir)
    .filter(
      entry => entry.startsWith(`${name}.tmp.`) || entry.endsWith('.tmp')
    );

describe('atomic publish: parallel writers never share a temp file', () => {
  it('two concurrent replaces of one target both succeed and publish one complete payload', async () => {
    const dir = makeDir();
    const target = writeTarget(dir, 'image', makeContent(0x11));

    const contentA = makeContent(0xaa);
    const contentB = makeContent(0xbb);

    // Hold the first rename call back: without per-writer temp names the
    // second writer consumes the shared temp file and the first rename then
    // fails (or publishes the other writer's bytes).
    const realRename = fsPromises.rename.bind(fsPromises);
    let held = true;
    vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
      if (held) {
        held = false;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return realRename(from, to);
    });

    const results = await Promise.allSettled([
      replaceFileBreakingHardLinks(target, contentA, 'restore'),
      replaceFileBreakingHardLinks(target, contentB, 'restore'),
    ]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');

    const published = fsSync.readFileSync(target);
    expect(published.equals(contentA) || published.equals(contentB)).toBe(true);
    expect(tempLeftovers(dir, 'image')).toEqual([]);
  });

  it('every native-road write gets its own pid-stamped sibling temp file', () => {
    const dir = makeDir();
    const original = writeTarget(dir, 'original', makeContent(0x11), 0o754);
    const target = path.join(dir, 'cli');

    const stubBinary = (bytes: Buffer) =>
      ({
        write: (p: string) => fsSync.writeFileSync(p, bytes),
      }) as unknown as Parameters<typeof atomicWriteBinary>[0];

    const realRenameSync = fsSync.renameSync.bind(fsSync);
    const tempPaths: string[] = [];
    vi.spyOn(fsSync, 'renameSync').mockImplementation((from, to) => {
      tempPaths.push(String(from));
      return realRenameSync(from, to);
    });

    atomicWriteBuffer(makeContent(0xaa), target, original);
    atomicWriteBuffer(makeContent(0xbb), target, original);
    atomicWriteBinary(stubBinary(makeContent(0xcc)), target, original);

    expect(tempPaths).toHaveLength(3);
    expect(new Set(tempPaths).size).toBe(3);
    for (const tempPath of tempPaths) {
      expect(path.dirname(tempPath)).toBe(path.dirname(target));
      expect(tempPath.startsWith(`${target}.tmp.${process.pid}.`)).toBe(true);
    }

    const published = fsSync.readFileSync(target);
    for (const content of [
      makeContent(0xaa),
      makeContent(0xbb),
      makeContent(0xcc),
    ]) {
      if (published.equals(content)) return;
    }
    throw new Error('published content matched none of the written buffers');
  });
});

describe('atomic publish: hard links keep the old inode', () => {
  it('a hard link still reads the old content after a replace', async () => {
    const dir = makeDir();
    const oldContent = makeContent(0x11);
    const newContent = makeContent(0x22);
    const target = writeTarget(dir, 'image', oldContent);
    const link = path.join(dir, 'hardlink');
    fsSync.linkSync(target, link);

    await replaceFileBreakingHardLinks(target, newContent, 'restore');

    expect(fsSync.readFileSync(target).equals(newContent)).toBe(true);
    expect(fsSync.readFileSync(link).equals(oldContent)).toBe(true);
  });

  it('a hard link still reads the old content after a native-road write', () => {
    const dir = makeDir();
    const oldContent = makeContent(0x11);
    const newContent = makeContent(0x22);
    const original = writeTarget(dir, 'original', oldContent, 0o754);
    const target = writeTarget(dir, 'cli', oldContent);
    const link = path.join(dir, 'hardlink');
    fsSync.linkSync(target, link);

    atomicWriteBuffer(newContent, target, original);

    expect(fsSync.readFileSync(target).equals(newContent)).toBe(true);
    expect(fsSync.readFileSync(link).equals(oldContent)).toBe(true);
  });
});

describe('atomic publish: the target never disappears mid-restore', () => {
  it('a reader polling the target sees only complete old or complete new content', async () => {
    const dir = makeDir();
    const oldContent = makeContent(0x11, 512 * 1024);
    const newContent = makeContent(0x22, 512 * 1024);
    const target = writeTarget(dir, 'image', oldContent);

    // Slow the write down so the publish window is wide enough to observe:
    // this models a large image on a busy disk.
    const realWriteFile = fsPromises.writeFile.bind(fsPromises);
    vi.spyOn(fsPromises, 'writeFile').mockImplementation(
      async (p, data, options) => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return realWriteFile(p, data, options);
      }
    );

    let observing = true;
    let samples = 0;
    let missing = 0;
    let partial = 0;
    const observe = async (): Promise<void> => {
      while (observing) {
        try {
          const data = await fsPromises.readFile(target);
          samples++;
          if (!data.equals(oldContent) && !data.equals(newContent)) {
            partial++;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            missing++;
          } else {
            throw error;
          }
        }
        await new Promise(resolve => setImmediate(resolve));
      }
    };

    const observer = observe();
    await replaceFileBreakingHardLinks(target, newContent, 'restore');
    observing = false;
    await observer;

    expect(samples).toBeGreaterThan(0);
    expect(missing).toBe(0);
    expect(partial).toBe(0);
    expect(fsSync.readFileSync(target).equals(newContent)).toBe(true);
    expect(tempLeftovers(dir, 'image')).toEqual([]);
  });
});

describe('atomic publish: permissions are set before publication', () => {
  it('the async road chmods the temp file before renaming it into place', async () => {
    const dir = makeDir();
    // 0754 is deliberately not a plausible default: passing this tooth means
    // the mode was carried over, not recreated by chance.
    const target = writeTarget(dir, 'image', makeContent(0x11), 0o754);

    const realRename = fsPromises.rename.bind(fsPromises);
    let modeAtPublish: number | undefined;
    vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
      modeAtPublish = fsSync.statSync(String(from)).mode & 0o777;
      return realRename(from, to);
    });

    await replaceFileBreakingHardLinks(target, makeContent(0x22), 'restore');

    expect(modeAtPublish).toBe(0o754);
    expect(fsSync.statSync(target).mode & 0o777).toBe(0o754);
  });

  it('the native road chmods the temp file before renaming it into place', () => {
    const dir = makeDir();
    const original = writeTarget(dir, 'original', makeContent(0x11), 0o754);
    const target = writeTarget(dir, 'cli', makeContent(0x11));

    const realRenameSync = fsSync.renameSync.bind(fsSync);
    let modeAtPublish: number | undefined;
    vi.spyOn(fsSync, 'renameSync').mockImplementation((from, to) => {
      modeAtPublish = fsSync.statSync(String(from)).mode & 0o777;
      return realRenameSync(from, to);
    });

    atomicWriteBuffer(makeContent(0x22), target, original);

    expect(modeAtPublish).toBe(0o754);
    expect(fsSync.statSync(target).mode & 0o777).toBe(0o754);
  });
});

describe('atomic publish: a failed publish cleans up after itself', () => {
  it('the async road: a write failure leaves no temp and an intact target', async () => {
    const dir = makeDir();
    const oldContent = makeContent(0x11);
    const target = writeTarget(dir, 'image', oldContent);

    // A read-only directory makes creating the temp file fail.
    fsSync.chmodSync(dir, 0o555);
    let failure: unknown;
    try {
      await replaceFileBreakingHardLinks(target, makeContent(0x22));
      throw new Error('the replace was expected to fail');
    } catch (error) {
      failure = error;
    } finally {
      fsSync.chmodSync(dir, 0o755);
    }
    expect((failure as NodeJS.ErrnoException).code).toBe('EACCES');

    expect(fsSync.readFileSync(target).equals(oldContent)).toBe(true);
    expect(tempLeftovers(dir, 'image')).toEqual([]);
  });

  it('the async road: a rename failure leaves no temp and an intact target', async () => {
    const dir = makeDir();
    const oldContent = makeContent(0x11);
    const target = writeTarget(dir, 'image', oldContent);

    vi.spyOn(fsPromises, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('rename refused: simulated EIO'), {
        code: 'EIO',
      })
    );

    await expect(
      replaceFileBreakingHardLinks(target, makeContent(0x22))
    ).rejects.toThrow('simulated EIO');

    expect(fsSync.readFileSync(target).equals(oldContent)).toBe(true);
    expect(tempLeftovers(dir, 'image')).toEqual([]);
  });

  it('the native road: a write failure leaves no temp and an intact target', () => {
    const dir = makeDir();
    const oldContent = makeContent(0x11);
    const original = writeTarget(dir, 'original', oldContent, 0o754);
    const target = writeTarget(dir, 'cli', oldContent);

    fsSync.chmodSync(dir, 0o555);
    let failure: unknown;
    try {
      atomicWriteBuffer(makeContent(0x22), target, original);
      throw new Error('the write was expected to fail');
    } catch (error) {
      failure = error;
    } finally {
      fsSync.chmodSync(dir, 0o755);
    }
    expect((failure as NodeJS.ErrnoException).code).toBe('EACCES');

    expect(fsSync.readFileSync(target).equals(oldContent)).toBe(true);
    expect(tempLeftovers(dir, 'cli')).toEqual([]);

    // A write that dies halfway (model: no space left mid-write) must not
    // leave the half-written temp file behind.
    const realWriteFileSync = fsSync.writeFileSync.bind(fsSync);
    vi.spyOn(fsSync, 'writeFileSync').mockImplementation((p, data, options) => {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
      realWriteFileSync(p, bytes.subarray(0, 100), options);
      throw Object.assign(new Error('write refused: simulated disk full'), {
        code: 'ENOSPC',
      });
    });

    expect(() =>
      atomicWriteBuffer(makeContent(0x22), target, original)
    ).toThrow('simulated disk full');

    expect(fsSync.readFileSync(target).equals(oldContent)).toBe(true);
    expect(tempLeftovers(dir, 'cli')).toEqual([]);
  });

  it('the native road: a rename failure leaves no temp and an intact target', () => {
    const dir = makeDir();
    const oldContent = makeContent(0x11);
    const original = writeTarget(dir, 'original', oldContent, 0o754);
    const target = writeTarget(dir, 'cli', oldContent);

    vi.spyOn(fsSync, 'renameSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('rename refused: simulated EIO'), {
        code: 'EIO',
      });
    });

    expect(() =>
      atomicWriteBuffer(makeContent(0x22), target, original)
    ).toThrow('simulated EIO');

    expect(fsSync.readFileSync(target).equals(oldContent)).toBe(true);
    expect(tempLeftovers(dir, 'cli')).toEqual([]);
  });

  it('the native road: a busy executable still reports the running-instance refusal', () => {
    const dir = makeDir();
    const oldContent = makeContent(0x11);
    const original = writeTarget(dir, 'original', oldContent, 0o754);
    const target = writeTarget(dir, 'cli', oldContent);

    vi.spyOn(fsSync, 'renameSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('rename refused: simulated ETXTBSY'), {
        code: 'ETXTBSY',
      });
    });

    expect(() =>
      atomicWriteBuffer(makeContent(0x22), target, original)
    ).toThrow(
      'Cannot update the Claude executable while it is running.\n' +
        'Please close all Claude instances and try again.'
    );

    expect(fsSync.readFileSync(target).equals(oldContent)).toBe(true);
    expect(tempLeftovers(dir, 'cli')).toEqual([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    fsSync.rmSync(dir, { recursive: true, force: true });
  }
});
