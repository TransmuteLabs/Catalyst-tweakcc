import { describe, expect, it } from 'vitest';

import {
  applyPatchImplementations,
  getAllPatchDefinitions,
  PatchId,
  PatchImplementation,
} from './index';

// The content must PARSE: an applied patch is syntax-checked against the
// original right after it lands, so garbage text would be reported as a failed
// patch and this file would be measuring the parse gate instead of the labels.
const CONTENT = 'const a = 1;\n';

function implementations(
  overrides: Partial<Record<PatchId, PatchImplementation>>
): Record<PatchId, PatchImplementation> {
  const all = {} as Record<PatchId, PatchImplementation>;
  for (const def of getAllPatchDefinitions()) {
    // Default: a locator that runs and matches nothing. That is the outcome
    // with no label of its own before this split, which is why it is the base
    // case here rather than a special one.
    all[def.id] = { fn: c => c };
  }
  return { ...all, ...overrides };
}

function byId(content: string, impls: Record<PatchId, PatchImplementation>) {
  const { results } = applyPatchImplementations(content, impls);
  return Object.fromEntries(results.map(r => [r.id, r]));
}

describe('applyPatchImplementations: why a patch produced no change', () => {
  it('labels config, version, noop, landed and failed apart', () => {
    const results = byId(
      CONTENT,
      implementations({
        'verbose-property': { fn: c => c + 'const landed = 2;\n' },
        opusplan1m: { fn: () => null },
        'clear-screen': { fn: c => c + 'const off = 3;\n', condition: false },
        'fix-lsp-support': {
          fn: c => c + 'const old = 4;\n',
          versionCondition: false,
        },
      })
    );

    expect(results['verbose-property']?.applied).toBe(true);
    expect(results['verbose-property']?.skipKind).toBeUndefined();

    expect(results['opusplan1m']?.failed).toBe(true);
    expect(results['opusplan1m']?.skipKind).toBeUndefined();

    expect(results['clear-screen']?.applied).toBe(false);
    expect(results['clear-screen']?.skipKind).toBe('config');

    expect(results['fix-lsp-support']?.applied).toBe(false);
    expect(results['fix-lsp-support']?.skipKind).toBe('version');

    // Tried and changed nothing: a locator that silently matched no site. It
    // used to be indistinguishable from a patch switched off on purpose.
    expect(results['session-color']?.applied).toBe(false);
    expect(results['session-color']?.failed).toBe(false);
    expect(results['session-color']?.skipKind).toBe('noop');
  });

  it('asks the version before the config when both say no', () => {
    // Order carries the OWNER of the cause: on a version that cannot carry the
    // patch at all, the operator's setting decides nothing, and blaming the
    // config would hand the cause to the wrong owner.
    const results = byId(
      CONTENT,
      implementations({
        'conversation-title': {
          fn: c => c + 'const both = 5;\n',
          condition: false,
          versionCondition: false,
        },
      })
    );

    expect(results['conversation-title']?.skipKind).toBe('version');
  });

  it('labels patches held back by an explicit filter', () => {
    const { results } = applyPatchImplementations(
      CONTENT,
      implementations({
        'verbose-property': { fn: c => c + 'const only = 6;\n' },
      }),
      ['verbose-property']
    );
    const map = Object.fromEntries(results.map(r => [r.id, r]));

    expect(map['verbose-property']?.applied).toBe(true);
    expect(map['opusplan1m']?.skipKind).toBe('filter');
  });

  it('leaves no skipped result without a named cause', () => {
    const { results } = applyPatchImplementations(
      CONTENT,
      implementations({
        'verbose-property': { fn: c => c + 'const landed = 7;\n' },
        opusplan1m: { fn: () => null },
      })
    );

    // The whole point of the field: every outcome that is neither landed nor
    // failed names its own cause. An unlabelled one would print the same sign
    // as a deliberate switch-off and be counted as one.
    //
    // The invariant belongs to the FIELD and binds BOTH producers of
    // PatchResult; this pin measures only applyPatchImplementations. The other
    // producer is applySystemPrompts, pinned in systemPrompts.test.ts
    // ('every outcome of applySystemPrompts names its own cause'), and that pin
    // also carries a positive denominator, because a filter of this shape
    // cannot see a branch that creates no result at all.
    const unlabelled = results.filter(
      r => !r.applied && !r.failed && r.skipKind === undefined
    );
    expect(unlabelled).toEqual([]);
  });
});
