import { describe, expect, it, vi } from 'vitest';

import { writeSessionMemory } from './sessionMemory';

describe('writeSessionMemory', () => {
  // Claude Code >= 2.1.217 refactored the session-memory config: the extraction
  // gate moved to the `querySource:"extract_memories"` path, the `# Session Title`
  // landmark and the token-limit / update-threshold constants were removed, and
  // `tengu_session_memory` now survives only as telemetry event names
  // (tengu_session_memory_rated, ...). The legacy-fatal branch keys off whether
  // the *legacy extraction gate* was patched, not whether that substring appears.
  it('applies on refactored CC (new querySource path + extract-mode rewrite) even though the token-limit patterns are gone and tengu_session_memory survives as telemetry', () => {
    const input =
      // telemetry-only occurrence of the substring (the false-positive trigger)
      'O("tengu_session_memory_rated",{rating:1});' +
      // new extraction path: anchor + passport_quail gate that patchExtraction strips
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      'if(!Qz("tengu_passport_quail",!1))return;' +
      // extract-mode gate: the flag READ is neutralized, the guard statement
      // and the interactivity term stay
      'function JXn(){if(!Ke("tengu_passport_quail",!1))return!1;return!un()||Ke("tengu_slate_thimble",!1)}' +
      // past-sessions fallback anchor (coral_fern gate already removed upstream)
      'if(Wf("tengu_session_search_toggled",!1)){}';

    const result = writeSessionMemory(input);

    // Core feature must still apply, and both force-enable rewrites must run:
    expect(result).not.toBeNull();
    // The flag gate is forced on...
    expect(result).not.toContain('tengu_passport_quail');
    // ...but `!un()` -- the product's own "this session is interactive" test --
    // and its escape hatch survive verbatim. Rewriting the body to `return!0`
    // turned session memory on for print mode, background agents and SDK
    // sessions, which this feature never promised.
    expect(result).toContain(
      'function JXn(){if(!!0)return!1;return!un()||Ke("tengu_slate_thimble",!1)}'
    );
    expect(result).not.toContain('function JXn(){return!0}');
  });

  it('reports a reshaped extract-mode gate instead of silently not forcing it', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const input =
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      'if(!Qz("tengu_passport_quail",!1))return;' +
      // same flag, a shape this patch does not know
      'function JXn(){return Ke("tengu_passport_quail",!1)&&somethingElse()}' +
      'if(Wf("tengu_session_search_toggled",!1)){}';

    writeSessionMemory(input);

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('extract-mode gate is present but reshaped')
    );
    errSpy.mockRestore();
  });

  it('does not treat a telemetry event wrapped in a returning function as the legacy extraction gate', () => {
    const input =
      // near-match: a returning fn whose string is tengu_session_memory_RATED,
      // not the real gate `("tengu_session_memory",!1)`
      'function zz(){return O("tengu_session_memory_rated",{rating:1})}' +
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      'if(!Qz("tengu_passport_quail",!1))return;' +
      'if(Wf("tengu_session_search_toggled",!1)){}';

    const result = writeSessionMemory(input);

    // The near-match must not flip usedLegacyExtraction, so the missing
    // token-limit pattern stays non-fatal and the feature still applies.
    expect(result).not.toBeNull();
    expect(result).not.toContain('tengu_passport_quail');
  });

  // Legacy fixture (CC <= ~2.1.158 shapes): synthesized to satisfy the token-limit
  // and update-threshold regexes, which no longer exist in current bundles.
  it('injects the configurable env-var limits on legacy CC where the patterns are present', () => {
    const input =
      'function l28(){return $_("tengu_session_memory",!1)}' +
      'if(Wf("tengu_session_search_toggled",!1)){}' +
      'let cfg={x=2000,y=12000;z="# Session Title"};' +
      'let up={minimumMessageTokensToInit:1e4,minimumTokensBetweenUpdate:5000,toolCallsBetweenUpdates:3};';

    const result = writeSessionMemory(input);

    expect(result).not.toBeNull();
    expect(result).toContain('CC_SM_PER_SECTION_TOKENS');
    expect(result).toContain(
      'minimumMessageTokensToInit:Number(process.env.CC_SM_MINIMUM_MESSAGE_TOKENS_TO_INIT'
    );
    expect(result).toContain(
      'toolCallsBetweenUpdates:Number(process.env.CC_SM_TOOL_CALLS_BETWEEN_UPDATES'
    );
    // the consumed object delimiters must be restored, keeping the literal valid:
    // `...??1e4),minimumTokensBetweenUpdate...??3)}` (comma between props, closing brace)
    expect(result).toContain('??1e4),minimumTokensBetweenUpdate:Number(');
    expect(result).toContain('??5000),toolCallsBetweenUpdates:Number(');
    expect(result).toContain('??3)}');
  });

  it('stays fatal on genuine legacy CC extraction gate when the token-limit pattern is absent', () => {
    const input =
      // legacy extraction fn-gate (patchExtraction branch 1)
      'function l28(){return $_("tengu_session_memory",!1)}' +
      'if(Wf("tengu_session_search_toggled",!1)){}';

    // Legacy bundles are expected to carry the token-limit pattern; its absence
    // here is a real breakage and must remain fatal (preserves #761 behavior).
    expect(writeSessionMemory(input)).toBeNull();
  });

  it('returns null when no session-memory extraction anchor is present', () => {
    expect(writeSessionMemory('function foo(){return 1}')).toBeNull();
  });

  // CC 2.1.218 replaced the old `toolCallsBetweenUpdates:3` config field with a
  // GrowthBook-gated cadence `getFlag("tengu_bramble_lintel",null)??1`. It is the
  // one update-cadence knob that survived the memory-model refactor, so the
  // CC_SM_TOOL_CALLS_BETWEEN_UPDATES env var must re-anchor onto it (preserving
  // the flag's precedence and its numeric default).
  it('re-anchors CC_SM_TOOL_CALLS_BETWEEN_UPDATES onto the 2.1.218 tengu_bramble_lintel cadence flag', () => {
    const input =
      // refactored extraction path (keeps usedLegacyExtraction false)
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      'if(!Qz("tengu_passport_quail",!1))return;' +
      'function JXn(){if(!Ke("tengu_passport_quail",!1))return!1;return!un()||Ke("tengu_slate_thimble",!1)}' +
      'if(Wf("tengu_session_search_toggled",!1)){}' +
      // new cadence construct (the surviving knob)
      'let g=Xe("tengu_bramble_lintel",null)??1,y=mvo(p);';

    const result = writeSessionMemory(input);

    expect(result).not.toBeNull();
    // flag precedence preserved; only the numeric default becomes env-configurable.
    // Assert through the trailing continuation so a comma-eating mutation is caught.
    expect(result).toContain(
      'Xe("tengu_bramble_lintel",null)??Number(process.env.CC_SM_TOOL_CALLS_BETWEEN_UPDATES??1),y=mvo(p)'
    );
  });

  it('preserves the upstream cadence default when re-anchoring the tengu_bramble_lintel flag', () => {
    // A future bundle could ship a different numeric default; the patch must
    // carry it through rather than hard-coding 1.
    const input =
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      'if(!Qz("tengu_passport_quail",!1))return;' +
      'if(Wf("tengu_session_search_toggled",!1)){}' +
      'let g=Xe("tengu_bramble_lintel",null)??4,y=mvo(p);';

    const result = writeSessionMemory(input);

    expect(result).not.toBeNull();
    expect(result).toContain(
      'Xe("tengu_bramble_lintel",null)??Number(process.env.CC_SM_TOOL_CALLS_BETWEEN_UPDATES??4),y=mvo(p)'
    );
  });

  it('re-anchors only tengu_bramble_lintel, leaving other GrowthBook cadence flags untouched', () => {
    // Guards against over-broadening the flag literal: an unrelated
    // `("tengu_*",null)??<n>` read must not be rewritten.
    const input =
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      'if(!Qz("tengu_passport_quail",!1))return;' +
      'if(Wf("tengu_session_search_toggled",!1)){}' +
      'let h=Xe("tengu_unrelated_flag",null)??2,g=Xe("tengu_bramble_lintel",null)??1;';

    const result = writeSessionMemory(input);

    expect(result).not.toBeNull();
    // the unrelated flag keeps its raw default
    expect(result).toContain('Xe("tengu_unrelated_flag",null)??2,');
    expect(result).not.toContain(
      'tengu_unrelated_flag",null)??Number(process.env'
    );
    // and the real cadence flag is still re-anchored
    expect(result).toContain(
      'Xe("tengu_bramble_lintel",null)??Number(process.env.CC_SM_TOOL_CALLS_BETWEEN_UPDATES??1)'
    );
  });

  it('does not re-anchor a tengu_bramble_lintel cadence with a non-integer default', () => {
    // The lookahead `(?![\d.eExX])` must reject float/exponent/hex defaults
    // rather than splitting them (e.g. `??1.5` -> `??Number(...??1).5`).
    const input =
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      'if(!Qz("tengu_passport_quail",!1))return;' +
      'if(Wf("tengu_session_search_toggled",!1)){}' +
      'let g=Xe("tengu_bramble_lintel",null)??1.5,y=mvo(p);';

    const result = writeSessionMemory(input);

    expect(result).not.toBeNull();
    // left untouched: no partial-number corruption
    expect(result).toContain('Xe("tengu_bramble_lintel",null)??1.5,');
    expect(result).not.toContain('CC_SM_TOOL_CALLS_BETWEEN_UPDATES');
  });

  // --- CC 2.1.270: the guard grew a `!pe&&` conjunct in front of the flag
  // read and the anchor now appears twice (main path + CCR/MCP memory path).
  // The gate statement is no longer excised: only the flag call is
  // neutralized, so conjuncts the patch never read stay upstream-owned.
  // The context slices below concatenate to verbatim bundle bytes.
  it('neutralizes only the flag call on the 2.1.270 shape, keeping the statement and the !pe conjunct', () => {
    const context270 =
      '.some((Se)=>zt(Se,Mvr)))){t("[extractMemories] skipping (mcp) — CCR ' +
      'memory server not mounted");return}if(!pe&&!H("tengu_passport_quail",' +
      '!1))return;if(!pe&&!ra())return;if(Zn()!==null)return;if(d){t("[extr';
    const input =
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      context270 +
      'if(Wf("tengu_session_search_toggled",!1)){}';

    const result = writeSessionMemory(input);

    expect(result).not.toBeNull();
    const out = result as string;
    // the flag read became `!0` inside the kept statement, so the conjunct
    // survives as `!pe&&!!0` (always false: the gate can never fire)
    expect(out).toContain('if(!pe&&!!0)return;');
    // the neighbouring guards must survive untouched
    expect(out).toContain('if(!pe&&!ra())return;');
    expect(out).toContain('if(Zn()!==null)return;');
    expect(out).not.toContain('tengu_passport_quail');
    // the CCR/MCP skip site sharing this window is not disturbed
    expect(out).toContain('CCR memory server not mounted');
  });

  it('neutralizes only the flag call on the 2.1.267 shape (plain guard, still working)', () => {
    const context267 =
      'ystemMessage:Pe.appendSystemMessage,isTrailingRun:!0})}}async ' +
      'function E(M,D){if(M.toolUseContext.agentId)return;if(!H(' +
      '"tengu_passport_quail",!1))return;if(!ya())return;if(Gn()!==null)' +
      'return;if(d){t("[extractMe';
    const input =
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      context267 +
      'if(Wf("tengu_session_search_toggled",!1)){}';

    const result = writeSessionMemory(input);

    expect(result).not.toBeNull();
    const out = result as string;
    expect(out).toContain('if(!!0)return;');
    expect(out).toContain('if(!ya())return;');
    expect(out).toContain('if(Gn()!==null)return;');
    expect(out).toContain('if(M.toolUseContext.agentId)return;');
    expect(out).not.toContain('tengu_passport_quail');
  });

  it('leaves the )return!1; flag consumer to the extract-mode rewrite (no false "reshaped")', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const input =
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      'if(!Qz("tengu_passport_quail",!1))return;' +
      'function JXn(){if(!Ke("tengu_passport_quail",!1))return!1;return!un()||Ke("tengu_slate_thimble",!1)}' +
      'if(Wf("tengu_session_search_toggled",!1)){}';

    const result = writeSessionMemory(input);

    expect(result).not.toBeNull();
    const out = result as string;
    // site 1 (`)return;` shape): neutralized in place, not excised
    expect(out).toContain('if(!!0)return;');
    // site 2 (`)return!1;` shape): still consumed by the extract-mode rewrite,
    // which only matches the flag call it owns -- patchExtraction must not
    // have touched it
    expect(out).toContain(
      'function JXn(){if(!!0)return!1;return!un()||Ke("tengu_slate_thimble",!1)}'
    );
    expect(out).not.toContain('tengu_passport_quail');
    expect(errSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('extract-mode gate is present but reshaped')
    );
    errSpy.mockRestore();
  });

  // --- CC 2.1.270 also inserted an early return in FRONT of the extract-mode
  // gate, which the old whole-body regex could not survive. The gate line below
  // is verbatim 2.1.270 bundle bytes.
  it('neutralizes the 2.1.270 extract-mode gate that no longer opens the function', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const input =
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      'if(!pe&&!I("tengu_passport_quail",!1))return;' +
      'function bat(){if(f0e()!==null)return!0;if(!I("tengu_passport_quail",!1))' +
      'return!1;return!ke()||I("tengu_slate_thimble",!1)}' +
      'if(Wf("tengu_session_search_toggled",!1)){}';

    const result = writeSessionMemory(input);

    expect(result).not.toBeNull();
    const out = result as string;
    // upstream's own early return and escape hatch survive byte for byte
    expect(out).toContain(
      'function bat(){if(f0e()!==null)return!0;if(!!0)return!1;' +
        'return!ke()||I("tengu_slate_thimble",!1)}'
    );
    expect(out).not.toContain('tengu_passport_quail');
    expect(errSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('extract-mode gate is present but reshaped')
    );
    errSpy.mockRestore();
  });

  it('does not take a )return!1; flag guard from a function without the escape hatch', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const input =
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      'if(!Qz("tengu_passport_quail",!1))return;' +
      // same guard shape, but this is not the extract-mode gate: no escape hatch
      'function zz(){if(!Ke("tengu_passport_quail",!1))return!1;return!un()}' +
      'if(Wf("tengu_session_search_toggled",!1)){}';

    const result = writeSessionMemory(input);

    expect(result).not.toBeNull();
    const out = result as string;
    // the foreign guard is left exactly as upstream wrote it
    expect(out).toContain(
      'function zz(){if(!Ke("tengu_passport_quail",!1))return!1;return!un()}'
    );
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('extract-mode gate is present but reshaped')
    );
    errSpy.mockRestore();
  });

  it('refuses (failed to find extraction gate + null) when no flag call sits in a )return; statement', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // anchor present and the flag call present, but the enclosing statement
    // is the extract-mode `)return!1;` shape: nothing may be accepted
    const input =
      'D8({querySource:"extract_memories",forkLabel:"extract_memories"});' +
      'if(!pe&&!H("tengu_passport_quail",!1))return!1;' +
      'if(Wf("tengu_session_search_toggled",!1)){}';

    const result = writeSessionMemory(input);

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'patch: sessionMemory: failed to find extraction gate'
      )
    );
    errSpy.mockRestore();
  });
});
