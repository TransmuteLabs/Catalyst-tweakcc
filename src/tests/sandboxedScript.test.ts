import { describe, it, expect } from 'vitest';
import { runSandboxedScript } from '../commands';

// ResolvedVars is not exported; the cast targets the function's own parameter
// type so the fixture vars stay type-checked at the call boundary.
type SandboxVars = Parameters<typeof runSandboxedScript>[2];

// These tests spawn real node processes (child_process is not mocked): the
// guarded property is an OS limit on a single argv element, which only a real
// spawn exercises.

describe('runSandboxedScript', () => {
  it('runs a payload bigger than every argv ceiling (3 MiB exceeds darwin ARG_MAX 1 048 576 and linux MAX_ARG_STRLEN 131 072)', async () => {
    const targetSize = 3_145_728;
    const head = '/*';
    const tail = '*/ return js + vars.marker;';
    const script =
      head + 'x'.repeat(targetSize - head.length - tail.length) + tail;
    expect(Buffer.byteLength(script)).toBeGreaterThanOrEqual(targetSize);

    const result = await runSandboxedScript(
      script,
      'INPUT',
      { marker: 'M' } as unknown as SandboxVars,
      true
    );

    expect(result).toBe('INPUTM');
  });

  it('carries non-ASCII (Cyrillic, emoji) through the stdin envelope byte-exactly', async () => {
    const label = 'привет 🌍 мир';
    const script = 'return js + vars.label;';
    const header = JSON.stringify({ script, vars: { label } }) + '\n';
    const headerBytes = Buffer.byteLength(header);

    // Each 'ф' (2 UTF-8 bytes) straddles a 64 KiB pipe-chunk boundary, so
    // only byte-exact chunk concatenation survives: per-chunk decoding
    // splits the char and turns it into U+FFFD. One straddle is placed in
    // envelope coordinates (header + input), one in bare-input coordinates.
    const input =
      'x'.repeat(65535 - headerBytes) +
      'ф' +
      'y'.repeat(headerBytes - 2) +
      'ф' +
      'хвост 🚀 конец';

    const envelopeBytes = Buffer.from(header + input);
    expect(envelopeBytes.subarray(65535, 65537).toString('utf8')).toBe('ф');
    const inputBytes = Buffer.from(input);
    expect(inputBytes.subarray(65535, 65537).toString('utf8')).toBe('ф');

    const result = await runSandboxedScript(
      script,
      input,
      { label } as unknown as SandboxVars,
      true
    );

    expect(result).toBe(input + label);
  });

  it('rejects with the script error message when the script throws', async () => {
    const script = 'throw new Error("sandbox-canary-boom")';
    await expect(
      runSandboxedScript(script, 'INPUT', {} as unknown as SandboxVars, true)
    ).rejects.toThrow('sandbox-canary-boom');
  });
});
