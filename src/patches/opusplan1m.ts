// Please see the note about writing patches in ./index
//
// This patch adds support for the "opusplan[1m]" model alias, which combines:
// - Opus for plan mode (complex reasoning)
// - Sonnet with 1M context for execution mode (reduces "context anxiety")
//
// The trick comes from Cognition's Devin team: using the 1M context model makes
// Claude believe it has plenty of room, reducing shortcuts and incomplete tasks
// that occur when Claude thinks it's near its context limit.
//
// See: https://github.com/Piebald-AI/tweakcc/issues/108

import { showDiff } from './index';

/**
 * Patch 1: Fix the mode-switching function (bF) to recognize opusplan[1m]
 *
 * The bF function determines which model to use based on mode. Currently it does
 * an exact match: K8A() === "opusplan". We need it to also match "opusplan[1m]".
 *
 * Original:
 *   if (K8A() === "opusplan" && K === "plan" && !Y) return q8A();
 *
 * Patched:
 *   if ((K8A() === "opusplan" || K8A() === "opusplan[1m]") && K === "plan" && !Y) return q8A();
 */
const patchModeSwitchingFunction = (oldFile: string): string | null => {
  // Pattern matches: if (FUNC() === "opusplan" && VAR === "plan" && !VAR) return FUNC();
  // We need to be careful to match the exact structure while allowing for minified variable names
  const pattern =
    /if\s*\(\s*([$\w]+)\(\)\s*===\s*"opusplan"\s*&&\s*([$\w]+)\s*===\s*"plan"\s*&&\s*!([$\w]+)\s*\)\s*return\s*([$\w]+)\(\);/;

  const match = oldFile.match(pattern);
  if (!match || match.index === undefined) {
    const nativePattern =
      /if\s*\(\s*\(?[$\w]+\s*===\s*"opusplan"\s*\|\|\s*[$\w]+\s*===\s*"opusplan\[1m\]"\)?\s*&&\s*[$\w]+\s*===\s*"plan"\s*&&\s*![$\w]+\s*\)/;
    if (nativePattern.test(oldFile)) return oldFile;

    // 2.1.251 rewrote the chooser: the inline test above no longer exists at
    // all. The alias is now resolved by a family mapper the chooser calls
    //   function qde(e){if(e==="opusplan"||e==="opusplan[1m]")return"opus"; ...}
    //   function hp(e){let{permissionMode:t,...,exceeds200kTokens:o=!1}=e;
    //                  if(t!=="plan")return r;let u=lf(),d=qde(u); ...}
    // and the 1M flavour is picked further down by `e==="opusplan[1m]"||YS()`.
    // Recognising the mapper ALONE would be a false pass: a build whose plan
    // chooser stopped calling it, or that dropped the 1M arm, would read as
    // "already native" and the feature would vanish silently. So all three
    // halves are required, and each missing half names itself.
    const nativeAliasMapper =
      /function\s+([$\w]+)\(\s*([$\w]+)\s*\)\s*\{\s*if\s*\(\s*\2\s*===\s*"opusplan"\s*\|\|\s*\2\s*===\s*"opusplan\[1m\]"\s*\)\s*return\s*"opus"\s*;/;
    const mapperMatch = oldFile.match(nativeAliasMapper);
    if (mapperMatch) {
      const mapperName = mapperMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // From the destructuring's closing brace to the call: no braces allowed,
      // so the call cannot be borrowed from a neighbouring function. A future
      // chooser that puts a block between the two fails CLOSED here, which is
      // the outcome this patch wants when it can no longer prove the wiring.
      const nativePlanChooser = new RegExp(
        'permissionMode\\s*:[^}]{0,80}exceeds200kTokens[^}]{0,40}\\}\\s*=\\s*[$\\w]+\\s*;' +
          '[^{}]{0,300}?(?<![$\\w])' +
          mapperName +
          '\\s*\\('
      );
      // `x==="opusplan[1m]"||...` — the test that picks the 1M variant of the
      // plan model. The mapper's own comparison is followed by `)`, never `||`,
      // so this cannot be satisfied by the mapper itself.
      const nativeOneMillionArm = /===\s*"opusplan\[1m\]"\s*\|\|/;
      const chooserOk = nativePlanChooser.test(oldFile);
      const oneMillionOk = nativeOneMillionArm.test(oldFile);
      if (chooserOk && oneMillionOk) return oldFile;

      console.error(
        'patch: opusplan1m: patchModeSwitchingFunction: the alias mapper ' +
          `${mapperMatch[1]}() knows opusplan[1m], but ` +
          (!chooserOk
            ? 'the plan-mode chooser does not call it'
            : 'nothing selects the 1M variant of the plan model') +
          ' — refusing to report native support that is not wired up'
      );
      return null;
    }

    console.error(
      'patch: opusplan1m: patchModeSwitchingFunction: failed to find mode switching pattern'
    );
    return null;
  }

  const [fullMatch, k8aFunc, modeVar, exceedsVar, opusFunc] = match;

  // Build the replacement with OR condition for opusplan[1m]
  const replacement = `if((${k8aFunc}()==="opusplan"||${k8aFunc}()==="opusplan[1m]")&&${modeVar}==="plan"&&!${exceedsVar})return ${opusFunc}();`;

  const newFile =
    oldFile.slice(0, match.index) +
    replacement +
    oldFile.slice(match.index + fullMatch.length);

  showDiff(
    oldFile,
    newFile,
    replacement,
    match.index,
    match.index + fullMatch.length
  );
  return newFile;
};

/**
 * Patch 2: Add "opusplan[1m]" to the model aliases list (k0A)
 *
 * Original:
 *   k0A = ["sonnet", "opus", "haiku", "sonnet[1m]", "opusplan"]
 *
 * Patched:
 *   k0A = ["sonnet", "opus", "haiku", "sonnet[1m]", "opusplan", "opusplan[1m]"]
 */
const patchModelAliasesList = (oldFile: string): string | null => {
  // Pattern matches the model aliases array assignment
  const pattern = /(\[(?:"[^"]+",)*"opusplan")/;

  const match = oldFile.match(pattern);
  if (!match || match.index === undefined) {
    console.error(
      'patch: opusplan1m: patchModelAliasesList: failed to find model aliases list'
    );
    return null;
  }

  // Add opusplan[1m] to the list
  const replacement = match[0] + ',"opusplan[1m]"';

  const newFile =
    oldFile.slice(0, match.index) +
    replacement +
    oldFile.slice(match.index + match[0].length);

  showDiff(
    oldFile,
    newFile,
    replacement,
    match.index,
    match.index + match[0].length
  );
  return newFile;
};

/**
 * Patch 3: Fix the description function (Zm3) to handle opusplan[1m]
 *
 * Original:
 *   if (A === "opusplan") return "Opus 4.6 in plan mode, else Sonnet 4.6";
 *
 * Patched:
 *   if (A === "opusplan") return "Opus 4.6 in plan mode, else Sonnet 4.6";
 *   if (A === "opusplan[1m]") return "Opus 4.6 in plan mode, else Sonnet 4.6 (1M context)";
 */
const patchDescriptionFunction = (oldFile: string): string | null => {
  // Pattern matches old versioned and new generic opusplan descriptions.
  const pattern =
    /(if\s*\(\s*([$\w]+)\s*===\s*"opusplan"\s*\)\s*return\s*"([^"]*Opus[^"]*plan mode[^"]*Sonnet[^"]*)";)/;

  const match = oldFile.match(pattern);
  if (!match || match.index === undefined) {
    console.error(
      'patch: opusplan1m: patchDescriptionFunction: failed to find description pattern'
    );
    return null;
  }

  const [fullMatch, , varName, description] = match;

  // Add the opusplan[1m] case right after the opusplan case
  const replacement =
    fullMatch +
    `if(${varName}==="opusplan[1m]")return"${description} (1M context)";`;

  const newFile =
    oldFile.slice(0, match.index) +
    replacement +
    oldFile.slice(match.index + fullMatch.length);

  showDiff(
    oldFile,
    newFile,
    replacement,
    match.index,
    match.index + fullMatch.length
  );
  return newFile;
};

/**
 * Patch 4: Fix the label function (Tq4) to handle opusplan[1m]
 *
 * Original:
 *   if (A === "opusplan") return "Opus Plan";
 *
 * Patched:
 *   if (A === "opusplan") return "Opus Plan";
 *   if (A === "opusplan[1m]") return "Opus Plan 1M";
 */
const patchLabelFunction = (oldFile: string): string | null => {
  // Pattern matches: if (VAR === "opusplan") return "Opus Plan";
  const pattern =
    /(if\s*\(\s*([$\w]+)\s*===\s*"opusplan"\s*\)\s*return\s*"Opus Plan";)/;

  const match = oldFile.match(pattern);
  if (!match || match.index === undefined) {
    console.error(
      'patch: opusplan1m: patchLabelFunction: failed to find label pattern'
    );
    return null;
  }

  const [fullMatch, , varName] = match;

  // Add the opusplan[1m] case right after the opusplan case
  const replacement =
    fullMatch + `if(${varName}==="opusplan[1m]")return"Opus Plan 1M";`;

  const newFile =
    oldFile.slice(0, match.index) +
    replacement +
    oldFile.slice(match.index + fullMatch.length);

  showDiff(
    oldFile,
    newFile,
    replacement,
    match.index,
    match.index + fullMatch.length
  );
  return newFile;
};

/**
 * Patch 5: Add opusplan[1m] menu option function (similar to Mm3)
 *
 * We need to add a function that returns the menu option for opusplan[1m],
 * and inject it into the model selector options.
 *
 * The existing Mm3 function:
 *   Mm3 = () => {
 *     return {
 *       value: "opusplan",
 *       label: "Opus Plan Mode",
 *       description: "Use Opus 4.6 in plan mode, Sonnet 4.6 otherwise",
 *     };
 *   };
 *
 * We'll add a similar function for opusplan[1m] and inject it where opusplan options are added.
 */
const patchModelSelectorOptions = (oldFile: string): string | null => {
  // The construct has taken three shapes across versions, differing only in how
  // the array is wrapped:
  //   <=2.1.206  if(K==="opusplan")return[...A,Mm3()];
  //              if(K==="opusplan")return v1A([...A,Mm3()]);
  //   >=2.1.233  else if(s==="opusplan")return P([...o,ct()],n);
  // The 2.1.233 shape is what the old locator missed: it allowed a wrapper call
  // but not a second argument to it. Rather than enumerate wrappers, the call is
  // reproduced verbatim around a new array — group 2 is the callee with its open
  // paren, group 5 any further arguments, group 6 the closing paren, and only the
  // array contents change.
  const pattern =
    /if\s*\(\s*([$\w]+)\s*===\s*"opusplan"\s*\)\s*return\s*(?:([$\w]+)\(\s*)?\[\s*\.\.\.([$\w]+)\s*,\s*([$\w]+)\(\)\s*\]((?:\s*,\s*[$\w]+)*)\s*(\)?)\s*;/;

  const match = oldFile.match(pattern);
  if (!match || match.index === undefined) {
    console.error(
      'patch: opusplan1m: patchModelSelectorOptions: failed to find model selector pattern'
    );
    return null;
  }

  const [fullMatch, varName, wrapFn, listVar, , extraArgs, closeParen] = match;

  // A wrapper without its closing paren (or the reverse) means the regex latched
  // onto something that only looks like the call. Emitting from it would produce
  // unbalanced parentheses in a 30MB bundle, which surfaces as a startup crash
  // rather than as a failed patch.
  if (!!wrapFn !== !!closeParen) {
    console.error(
      'patch: opusplan1m: patchModelSelectorOptions: the model list call is not ' +
        'balanced (wrapper and closing parenthesis disagree), refusing to rewrite it'
    );
    return null;
  }

  const newEntry = `{value:"opusplan[1m]",label:"Opus Plan Mode 1M",description:"Use Opus in plan mode, Sonnet (1M context) otherwise"}`;
  const returnExpr =
    (wrapFn ? `${wrapFn}(` : '') +
    `[...${listVar},${newEntry}]` +
    extraArgs +
    closeParen;

  // Appended as `else if`, not as a fresh `if`: from 2.1.233 this statement is a
  // link in an else-if chain, and a fresh `if` would adopt the rest of the chain
  // as its own else branch. That happens to behave the same today only because
  // every earlier branch returns; `else` keeps it correct without that argument.
  const replacement =
    fullMatch + `else if(${varName}==="opusplan[1m]")return ${returnExpr};`;

  const newFile =
    oldFile.slice(0, match.index) +
    replacement +
    oldFile.slice(match.index + fullMatch.length);

  showDiff(
    oldFile,
    newFile,
    replacement,
    match.index,
    match.index + fullMatch.length
  );
  return newFile;
};

/**
 * Patch 6: Add opusplan[1m] to the model selector list so it's ALWAYS visible
 *
 * This injects push statements to add opusplan and opusplan[1m] to the model list
 * so they always appear in the /model menu, not just when selected.
 *
 * We find the point right after the conditional check `if(K===null||A.some(...))`
 * and inject before the opusplan conditional return.
 */
const patchAlwaysShowInModelSelector = (oldFile: string): string | null => {
  // if(K===null||A.some((V)=>V.value===K))return A;   -- the pushes go before it.
  // Same 2.1.233 change as in patch 5: the wrapper around the list gained a
  // second argument (`return WAt(r,t)`), which the old locator's `[$\w]+\)?;`
  // tail could not cross. Since only the injection point matters here, the tail
  // is matched loosely but the three names are tied together by backreference,
  // so this cannot latch onto an unrelated `.some()` check.
  const pattern =
    /if\s*\(\s*([$\w]+)\s*===\s*null\s*\|\|\s*([$\w]+)\.some\s*\(\s*\(\s*([$\w]+)\s*\)\s*=>\s*\3\.value\s*===\s*\1\s*\)\s*\)\s*return\s*(?:[$\w]+\(\s*)?\2((?:\s*,\s*[$\w]+)*)\s*\)?\s*;/;

  const match = oldFile.match(pattern);
  if (!match || match.index === undefined) {
    console.error(
      'patch: opusplan1m: patchAlwaysShowInModelSelector: failed to find model list check pattern'
    );
    return null;
  }

  const listVar = match[2];

  // Inject pushes BEFORE the conditional return
  // This ensures opusplan and opusplan[1m] are always in the list
  const inject =
    `${listVar}.push({value:"opusplan",label:"Opus Plan Mode",description:"Use Opus in plan mode, Sonnet otherwise"});` +
    `${listVar}.push({value:"opusplan[1m]",label:"Opus Plan Mode 1M",description:"Use Opus in plan mode, Sonnet (1M context) otherwise"});`;

  const newFile =
    oldFile.slice(0, match.index) + inject + oldFile.slice(match.index);

  showDiff(oldFile, newFile, inject, match.index, match.index);
  return newFile;
};

/**
 * Main entry point: Apply all opusplan[1m] patches
 */
export const writeOpusplan1m = (oldFile: string): string | null => {
  let newFile = oldFile;

  // Patch 1: Mode switching function
  let result = patchModeSwitchingFunction(newFile);
  if (result) {
    newFile = result;
  } else {
    console.error('patch: opusplan1m: failed to apply mode switching patch');
    return null;
  }

  // Patch 2: Model aliases list
  result = patchModelAliasesList(newFile);
  if (result) {
    newFile = result;
  } else {
    console.error(
      'patch: opusplan1m: failed to apply model aliases list patch'
    );
    return null;
  }

  // Patch 3: Description function
  result = patchDescriptionFunction(newFile);
  if (result) {
    newFile = result;
  } else {
    console.error(
      'patch: opusplan1m: failed to apply description function patch'
    );
    return null;
  }

  // Patch 4: Label function
  result = patchLabelFunction(newFile);
  if (result) {
    newFile = result;
  } else {
    console.error('patch: opusplan1m: failed to apply label function patch');
    return null;
  }

  // Patch 5: Model selector options (conditional show when selected)
  result = patchModelSelectorOptions(newFile);
  if (result) {
    newFile = result;
  } else {
    console.error(
      'patch: opusplan1m: failed to apply model selector options patch'
    );
    return null;
  }

  // Patch 6: Always show in model selector (push to list)
  result = patchAlwaysShowInModelSelector(newFile);
  if (result) {
    newFile = result;
  } else {
    console.error(
      'patch: opusplan1m: failed to apply always-show-in-selector patch'
    );
    return null;
  }

  return newFile;
};
