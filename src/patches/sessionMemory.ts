// Session Memory Patch - Force-enable session memory in Claude Code
//
// Enables both:
// 1. Session memory extraction (tengu_session_memory) - auto-extracts notes during conversation
// 2. Past session search (tengu_coral_fern) - adds system prompt for searching past sessions
//
// These are logically one feature - extraction creates session memories, search lets you use them.
//
// Extraction pattern (CC 2.1.27):
// ```diff
//  function l28() {
// +  return true;
//    return $_("tengu_session_memory", !1)
//  }
// ```
//
// Past sessions pattern (CC ≤2.1.37):
// ```diff
//  function AQ8() {
// -  if (!$_("tengu_coral_fern", !1)) return null;
//    return `# Accessing Past Sessions...
//  }
// ```
//
// Past sessions pattern (CC ≥2.1.38):
// ```diff
// -if(uL("tengu_coral_fern",!1)){
// +if(true){
//    let M=wX(YL());E.push("## Searching past context",...
//  }
// ```
//
// Env-var tuning knobs (CC_SM_*):
// CC ~2.1.217 replaced the single-session-memory-file model (a fixed
// `# Session Title` file with per-section / total token budgets and a declarative
// update-threshold config object) with the multi-file memory system. That removed
// most of the constructs these knobs targeted, so they split by Claude Code era:
//   - LEGACY-ONLY (pre-refactor bundles): CC_SM_PER_SECTION_TOKENS,
//     CC_SM_TOTAL_FILE_LIMIT (patchTokenLimits), CC_SM_MINIMUM_MESSAGE_TOKENS_TO_INIT,
//     CC_SM_MINIMUM_TOKENS_BETWEEN_UPDATE (patchUpdateThresholds). Their anchors no
//     longer exist on current CC; the sub-patches no-op non-fatally there.
//   - CURRENT: CC_SM_TOOL_CALLS_BETWEEN_UPDATES. The update-cadence role is now
//     served by the GrowthBook flag `tengu_bramble_lintel`; patchUpdateThresholds
//     re-anchors the same env var onto it (see below). The name is retained for
//     continuity with the legacy knob; the flag gates an extraction-cycle cadence,
//     not a literal tool-call count.

import { showDiff, globalReplace } from './index';

const LEGACY_EXTRACTION_GATE =
  /function [$\w]+\(\)\{return [$\w]+\("tengu_session_memory"/;

/**
 * Patch 1: Bypass tengu_session_memory flag check for extraction
 */

// Index of the `)` that closes the `if(...)` condition enclosing position
// `from`, or null when no enclosing `if(` exists. Walks left at zero relative
// paren depth; a depth-zero `(` that is not `if(` is a non-if ancestor whose
// match lies to the right and is simply passed through.
const enclosingGuardCloseParen = (
  file: string,
  from: number
): number | null => {
  let depth = 0;
  for (let i = from - 1; i >= 0; i--) {
    const ch = file[i];
    if (ch === ')') {
      depth++;
      continue;
    }
    if (ch !== '(') continue;
    if (depth > 0) {
      depth--;
      continue;
    }
    const precededByIf =
      file.slice(Math.max(0, i - 2), i) === 'if' &&
      (i < 3 || !/[$\w]/.test(file[i - 3]));
    if (!precededByIf) continue;
    let guardDepth = 0;
    for (let j = i; j < file.length; j++) {
      if (file[j] === '(') guardDepth++;
      else if (file[j] === ')') {
        guardDepth--;
        if (guardDepth === 0) return j;
      }
    }
    return null;
  }
  return null;
};

// True when `needle` occurs between `from` and the `}` that closes the block
// containing `from`. Depth starts at zero and the scan stops at the first `}`
// that would take it negative, so the search cannot leak past the end of the
// enclosing function into an unrelated neighbour.
const blockTailCarries = (
  file: string,
  from: number,
  needle: string
): boolean => {
  let depth = 0;
  for (let i = from; i < file.length; i++) {
    const ch = file[i];
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      if (depth === 0) return false;
      depth--;
      continue;
    }
    if (file.startsWith(needle, i)) return true;
  }
  return false;
};

// The index range of the extract-mode gate's own flag read: a
// `X("tengu_passport_quail",!1)` call whose enclosing `if(...)` is followed by
// exactly `return!1;` and whose function still carries the escape-hatch flag.
// The `return;` shape belongs to patchExtraction and is passed over here, which
// keeps the two sites from stealing each other.
const findExtractModeFlagCall = (file: string): [number, number] | null => {
  for (const call of file.matchAll(/([$\w]+)\("tengu_passport_quail",!1\)/g)) {
    if (call.index === undefined) continue;
    const guardClose = enclosingGuardCloseParen(file, call.index);
    if (guardClose === null) continue;
    if (!file.startsWith('return!1;', guardClose + 1)) continue;
    if (!blockTailCarries(file, guardClose + 1, '"tengu_slate_thimble"')) {
      continue;
    }
    return [call.index, call.index + call[0].length];
  }
  return null;
};

const patchExtraction = (file: string): string | null => {
  const match = file.match(LEGACY_EXTRACTION_GATE);

  if (match && match.index !== undefined) {
    const insertIndex = match.index + match[0].indexOf('{') + 1;
    const insertion = 'return true;';

    const newFile =
      file.slice(0, insertIndex) + insertion + file.slice(insertIndex);

    showDiff(file, newFile, insertion, insertIndex, insertIndex);
    return newFile;
  }

  const anchor = 'querySource:"extract_memories",forkLabel:"extract_memories"';

  // 2.1.270 carries the anchor twice (the CCR/MCP memory path repeats it), so
  // every occurrence gets its own 8000-char forward window; calls are deduped
  // by index because the windows can overlap.
  const acceptedCalls: Array<[number, number]> = [];
  const seenCalls = new Set<number>();
  let anchorIndex = file.indexOf(anchor);
  while (anchorIndex !== -1) {
    const windowEnd = Math.min(file.length, anchorIndex + 8000);
    const window = file.slice(anchorIndex, windowEnd);
    for (const call of window.matchAll(
      /([$\w]+)\("tengu_passport_quail",!1\)/g
    )) {
      if (call.index === undefined) continue;
      const callStart = anchorIndex + call.index;
      if (seenCalls.has(callStart)) continue;
      seenCalls.add(callStart);
      // Only a call whose enclosing `if(...)` is a bare `return;` statement
      // qualifies: the `)return!1;` shape belongs to the extract-mode gate
      // consumed by the rewrite in writeSessionMemory, and touching it here
      // would break that rewrite's own locator.
      const guardClose = enclosingGuardCloseParen(file, callStart);
      if (guardClose !== null && file.startsWith('return;', guardClose + 1)) {
        acceptedCalls.push([callStart, callStart + call[0].length]);
      }
    }
    anchorIndex = file.indexOf(anchor, anchorIndex + 1);
  }

  if (acceptedCalls.length > 0) {
    // Neutralize only the flag read, never the whole `if(...)return;`
    // statement: excising it silently takes responsibility for conjuncts this
    // patch never read (267 -> 270 grew `!pe&&` in front of the flag call).
    // Same idiom as the extract-mode rewrite below -- only the flag gate is
    // removed. Sites are patched back-to-front so earlier indices stay valid.
    let newFile = file;
    for (const [startIndex, endIndex] of acceptedCalls.sort(
      (a, b) => b[0] - a[0]
    )) {
      const patchedFile =
        newFile.slice(0, startIndex) + '!0' + newFile.slice(endIndex);
      showDiff(newFile, patchedFile, '!0', startIndex, endIndex);
      newFile = patchedFile;
    }
    console.log(
      `patch: sessionMemory: neutralized ${acceptedCalls.length} extraction gate flag call(s)`
    );
    return newFile;
  }

  console.error('patch: sessionMemory: failed to find extraction gate');
  return null;
};

/**
 * Patch 2: Bypass tengu_coral_fern flag check for past session search
 *
 * CC ≤2.1.37: negative guard with early return
 *   if(!fn("tengu_coral_fern",!1))return null;
 *
 * CC ≥2.1.38: positive conditional block
 *   if(fn("tengu_coral_fern",!1)){...}
 */
const patchPastSessions = (file: string): string | null => {
  // Try new pattern first (CC ≥2.1.38): positive conditional block
  const newPattern = /if\([$\w]+\("tengu_coral_fern",!1\)\)\{/;
  const newMatch = file.match(newPattern);

  if (newMatch && newMatch.index !== undefined) {
    const replacement = 'if(true){';
    const newFile =
      file.slice(0, newMatch.index) +
      replacement +
      file.slice(newMatch.index + newMatch[0].length);

    showDiff(
      file,
      newFile,
      replacement,
      newMatch.index,
      newMatch.index + newMatch[0].length
    );
    return newFile;
  }

  // Fall back to old pattern (CC ≤2.1.37, CC ≥2.1.69): negative guard with early return
  const oldPattern =
    /if\(![$\w]+\("tengu_coral_fern",!1\)\)return\s*(?:null|\[\]);/;
  const oldMatch = file.match(oldPattern);

  if (oldMatch && oldMatch.index !== undefined) {
    const newFile =
      file.slice(0, oldMatch.index) +
      file.slice(oldMatch.index + oldMatch[0].length);

    showDiff(
      file,
      newFile,
      '',
      oldMatch.index,
      oldMatch.index + oldMatch[0].length
    );
    return newFile;
  }

  // CC >= 2.1.152 appears to have removed the old tengu_coral_fern gate while
  // keeping the session search UI/event path present. Treat this as already enabled.
  if (
    file.includes('tengu_session_search_toggled') ||
    file.includes('tengu_session_all_projects_toggled')
  ) {
    return file;
  }

  console.error('patch: sessionMemory: failed to find past sessions gate');
  return null;
};

/**
 * Patch 3 (LEGACY-ONLY): Make per-section and total file token limits configurable
 * via env vars. The `# Session Title`-anchored budget constants were removed in the
 * ~2.1.217 multi-file memory refactor, so this no-ops on current bundles (non-fatal
 * unless the legacy extraction gate was used). See the CC_SM_* note at the top.
 */
const patchTokenLimits = (
  file: string,
  logFailure: boolean = true
): string | null => {
  // Pattern matches: =2000 ... =12000 ... # Session Title
  const pattern =
    /(=)2000((?:.|\n){0,15}?=)12000((?:.|\n){0,20}# Session Title)/;
  const match = file.match(pattern);

  if (!match || match.index === undefined) {
    if (logFailure) {
      console.error(
        'patch: sessionMemory: failed to find token limits pattern'
      );
    }
    return null;
  }

  const perSectionCode = 'Number(process.env.CC_SM_PER_SECTION_TOKENS??2000)';
  const totalFileCode = 'Number(process.env.CC_SM_TOTAL_FILE_LIMIT??12000)';

  const replacement =
    match[1] + perSectionCode + match[2] + totalFileCode + match[3];
  const startIndex = match.index;
  const endIndex = startIndex + match[0].length;

  const newFile =
    file.slice(0, startIndex) + replacement + file.slice(endIndex);

  showDiff(file, newFile, replacement, startIndex, endIndex);
  return newFile;
};

/**
 * Patch 4: Make session memory update thresholds configurable via env vars.
 * Handles both the legacy declarative config object (pre-refactor CC) and the
 * current CC >= 2.1.218 `tengu_bramble_lintel` cadence flag. Succeeds if any of
 * them matched (current bundles match only the cadence).
 */
const patchUpdateThresholds = (
  file: string,
  logFailure: boolean = true
): string | null => {
  let newFile = file;

  // LEGACY (CC before the ~2.1.217 memory-model refactor): the declarative
  // `{minimumMessageTokensToInit, minimumTokensBetweenUpdate, toolCallsBetweenUpdates}`
  // config object. These fields were removed upstream when session memory moved
  // to the multi-file model, so on current bundles the three replacements below
  // no-op and only the tengu_bramble_lintel cadence re-anchor (further down)
  // matches. Kept for older bundles that still carry the declarative object.
  newFile = globalReplace(
    newFile,
    /([,{;])minimumMessageTokensToInit:1e4([,;}])/g,
    '$1minimumMessageTokensToInit:Number(process.env.CC_SM_MINIMUM_MESSAGE_TOKENS_TO_INIT??1e4)$2'
  );

  newFile = globalReplace(
    newFile,
    /([,{;])minimumTokensBetweenUpdate:5000([,;}])/g,
    '$1minimumTokensBetweenUpdate:Number(process.env.CC_SM_MINIMUM_TOKENS_BETWEEN_UPDATE??5000)$2'
  );

  newFile = globalReplace(
    newFile,
    /([,{;])toolCallsBetweenUpdates:3([,;}])/g,
    '$1toolCallsBetweenUpdates:Number(process.env.CC_SM_TOOL_CALLS_BETWEEN_UPDATES??3)$2'
  );

  // CC >= 2.1.218: the update-cadence role is served by a GrowthBook-gated flag
  // `getFlag("tengu_bramble_lintel",null)??<n>` (the one update-cadence knob that
  // remains after the memory-model refactor removed the declarative object above).
  // Re-anchor the same env var onto it, keeping the flag's precedence and carrying
  // the upstream numeric default ($2) through rather than hard-coding it.
  newFile = globalReplace(
    newFile,
    /([$\w]+\("tengu_bramble_lintel",null\)\?\?)(\d+)(?![\d.eExX])/g,
    '$1Number(process.env.CC_SM_TOOL_CALLS_BETWEEN_UPDATES??$2)'
  );

  // Check if any replacements were made
  if (newFile === file) {
    if (logFailure) {
      console.error(
        'patch: sessionMemory: failed to find update thresholds patterns'
      );
    }
    return null;
  }

  return newFile;
};

/**
 * Combined patch - applies extraction, past sessions, token limits, and update thresholds
 */
export const writeSessionMemory = (oldFile: string): string | null => {
  let newFile = patchExtraction(oldFile);
  if (!newFile) return null;

  const usedLegacyExtraction = LEGACY_EXTRACTION_GATE.test(oldFile);

  const withPastSessions = patchPastSessions(newFile);
  if (!withPastSessions) {
    return null;
  }
  newFile = withPastSessions;

  // Force the feature flag, keep the product's own interactivity condition.
  //
  // On 2.1.246 (chunk 133) the gate is
  //
  //   function _Z(){if(!D("tengu_passport_quail",!1))return!1;
  //                 return!ge()||D("tengu_slate_thimble",!1)}
  //
  // and `ge` resolves through the chunk 812 re-export `Rd as jmd` to chunk 28:
  //
  //   function Rd(){return!n().host.launchOptions.isInteractive()}
  //
  // so `!ge()` is "this session is interactive" and `tengu_slate_thimble` is the
  // product's own escape hatch for running anyway. Rewriting the whole body to
  // `return!0` forced extraction in NON-interactive sessions too -- print mode,
  // background agents, SDK sessions -- which is a behaviour change this feature
  // never promised and which costs a model call per extraction cycle in exactly
  // the contexts that run unattended.
  //
  // Only the flag gate is removed. The returned expression is carried over
  // verbatim from the match rather than re-spelled, so the minified names of the
  // interactivity helper and the escape-hatch flag reader cannot drift out from
  // under us.
  //
  // The locator used to be a single regex over the whole function body, which
  // pinned two things it never needed: that the flag guard is the FIRST
  // statement, and that the body holds nothing else. 2.1.270 took the site away
  // with neither of those changing meaning -- it inserted an early return in
  // front of the guard:
  //
  //   function bat(){if(f0e()!==null)return!0;
  //                  if(!I("tengu_passport_quail",!1))return!1;
  //                  return!ke()||I("tengu_slate_thimble",!1)}
  //
  // so the site is now found by structure (a flag read inside a guard that
  // returns !1, in a function that still carries the escape hatch) and only the
  // flag READ is neutralized. The guard statement, the new early return and the
  // returned expression all stay upstream-owned byte for byte, which serves the
  // carry-it-over-verbatim requirement above more strictly than re-spelling the
  // body can.
  const extractModeCall = findExtractModeFlagCall(newFile);
  if (extractModeCall) {
    const [startIndex, endIndex] = extractModeCall;
    const beforePatch = newFile;
    newFile = newFile.slice(0, startIndex) + '!0' + newFile.slice(endIndex);
    showDiff(beforePatch, newFile, '!0', startIndex, endIndex);
  } else if (
    !usedLegacyExtraction &&
    newFile.includes('"tengu_passport_quail"')
  ) {
    // The build still carries the flag but no longer wears this shape: the
    // force-on would silently not happen. Legacy builds have no such function at
    // all, so they are exempt rather than noisy.
    console.error(
      'patch: sessionMemory: the extract-mode gate is present but reshaped; ' +
        'session memory may stay off despite this patch reporting success'
    );
  }

  const tokenLimitsFile = patchTokenLimits(newFile, usedLegacyExtraction);
  if (tokenLimitsFile) {
    newFile = tokenLimitsFile;
  } else if (usedLegacyExtraction) {
    return null;
  }

  const updateThresholdsFile = patchUpdateThresholds(
    newFile,
    usedLegacyExtraction
  );
  if (updateThresholdsFile) {
    newFile = updateThresholdsFile;
  } else if (usedLegacyExtraction) {
    return null;
  }

  return newFile;
};
