import { describe, expect, it } from 'vitest';

import { patchFailureSummaryLines } from './patchFailureSummary';
import { PatchGroup, PatchResult } from './patches/index';

const NO_EFFECT_LINE =
  'These patching errors do not affect your system prompt patches.';
const STILL_APPLIED_LINE =
  'Your system prompt customizations were still applied successfully.';
const REMAINING_LINE =
  'The remaining system prompt customizations were applied.';
const ISSUE_LINE =
  'Please open an issue on https://github.com/Piebald-AI/tweakcc/issues/new reporting these patching errors.';

const result = (over: Partial<PatchResult> & { id: string }): PatchResult => ({
  name: over.id,
  group: PatchGroup.FEATURES,
  applied: false,
  ...over,
});

describe('patchFailureSummaryLines', () => {
  it('keeps the old wording when nothing in the system prompt group failed', () => {
    // The two sentences below are the pre-existing text, byte for byte: a
    // failure outside the group leaves the old claim true, so it must not move.
    const lines = patchFailureSummaryLines([
      result({ id: 'themes', failed: true }),
      result({
        id: 'doing-tasks',
        group: PatchGroup.SYSTEM_PROMPTS,
        applied: true,
      }),
    ]);

    expect(lines).toEqual([NO_EFFECT_LINE, STILL_APPLIED_LINE, ISSUE_LINE]);
  });

  it('drops the "do not affect" claim entirely once a system prompt failed', () => {
    const lines = patchFailureSummaryLines([
      result({ id: 'themes', failed: true }),
      result({
        id: 'doing-tasks',
        group: PatchGroup.SYSTEM_PROMPTS,
        failed: true,
      }),
      result({
        id: 'memory',
        group: PatchGroup.SYSTEM_PROMPTS,
        applied: true,
      }),
    ]);

    // Asserted over the WHOLE array, not one index: a false claim that merely
    // moved to another line would still be a false claim on the operator's
    // screen.
    expect(lines).not.toContain(NO_EFFECT_LINE);
    expect(lines).not.toContain(STILL_APPLIED_LINE);
    expect(lines[0]).toBe(
      '1 of your system prompt customizations were NOT written to cli.js -- see the rows marked with a cross above.'
    );
    expect(lines).toContain(REMAINING_LINE);
    expect(lines).toContain(ISSUE_LINE);
  });

  it('counts only the system prompt failures, not every failure', () => {
    const lines = patchFailureSummaryLines([
      result({ id: 'themes', failed: true }),
      result({ id: 'thinking-verbs', failed: true }),
      result({
        id: 'doing-tasks',
        group: PatchGroup.SYSTEM_PROMPTS,
        failed: true,
      }),
      result({
        id: 'memory',
        group: PatchGroup.SYSTEM_PROMPTS,
        failed: true,
      }),
    ]);

    // Failures on both sides take the system prompt branch: the group decides,
    // not the count.
    expect(lines).not.toContain(NO_EFFECT_LINE);
    expect(lines[0]).toContain('2 of your system prompt customizations');
  });

  it('omits the "remaining" line when no system prompt was applied at all', () => {
    const lines = patchFailureSummaryLines([
      result({
        id: 'doing-tasks',
        group: PatchGroup.SYSTEM_PROMPTS,
        failed: true,
      }),
      result({
        id: 'memory',
        group: PatchGroup.SYSTEM_PROMPTS,
        applied: false,
        skipped: true,
        skipKind: 'noop',
      }),
    ]);

    expect(lines).not.toContain(REMAINING_LINE);
    expect(lines).toEqual([
      '1 of your system prompt customizations were NOT written to cli.js -- see the rows marked with a cross above.',
      ISSUE_LINE,
    ]);
  });

  it('always names the issue tracker, on either branch', () => {
    // The invitation was unconditional before the split and no branch makes it
    // false, so neither branch may lose it.
    const outsideOnly = patchFailureSummaryLines([
      result({ id: 'themes', failed: true }),
    ]);
    const insideToo = patchFailureSummaryLines([
      result({
        id: 'doing-tasks',
        group: PatchGroup.SYSTEM_PROMPTS,
        failed: true,
      }),
    ]);

    expect(outsideOnly[outsideOnly.length - 1]).toBe(ISSUE_LINE);
    expect(insideToo[insideToo.length - 1]).toBe(ISSUE_LINE);
  });
});

describe('the only consumer of the summary', () => {
  // index.tsx ends in a module-level main(), so importing it would run the CLI
  // and no test can hold its output. Its text is read instead: without this the
  // selector is pinned and its single call site is not, and re-inlining the
  // sentence there would restore the false claim under a green suite.
  const readIndex = async () => {
    const fs = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    return fs.readFileSync(
      fileURLToPath(new URL('./index.tsx', import.meta.url)),
      'utf8'
    );
  };

  it('reaches the wording through the selector and holds none of it inline', async () => {
    const source = await readIndex();

    // Positive control: a mispointed read would satisfy every absence below.
    expect(source).toContain('Customizations applied with some failures.');

    // The call, not its argument's spelling: pinning `(results)` would go red
    // on a rename of a local that this pin does not own. The import line
    // carries no paren, so this matches the call site alone.
    expect(source).toContain('patchFailureSummaryLines(');
    expect(source).not.toContain(NO_EFFECT_LINE);
    expect(source).not.toContain(STILL_APPLIED_LINE);
    expect(source).not.toContain(ISSUE_LINE);
  });
});
