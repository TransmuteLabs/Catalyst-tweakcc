// Please see the note about writing patches in ./index

import { LocationResult, showDiff } from './index';

const getShowMoreItemsInSelectMenusLocation = (
  oldFile: string
): LocationResult[] => {
  const results: LocationResult[] = [];

  // Find all instances of visibleOptionCount:varName=number pattern (destructured props with default values)
  const pattern = /visibleOptionCount:[\w$]+=(\d+)/g;
  let match;

  while ((match = pattern.exec(oldFile)) !== null) {
    // We want to replace just the number part
    const numberStart = match.index + match[0].indexOf('=') + 1;
    results.push({
      startIndex: numberStart,
      endIndex: numberStart + match[1].length,
    });
  }

  return results;
};

/**
 * Outcome of the menu-height arm.
 *
 * `notApplicable` is not a failure: since CC 2.1.152 the product computes how
 * many items physically fit instead of capping the menu to half the terminal,
 * so there is no arbitrary cap left to lift. Reporting that as "failed to find
 * the pattern" would be a false alarm, and treating it as "pattern moved, adapt
 * the replacement" is what produced the defect this arm used to carry.
 */
type MenuHeightOutcome =
  | { kind: 'patched'; file: string }
  | { kind: 'notApplicable' }
  | { kind: 'unknown' };

/**
 * Lift the half-terminal cap on the help/command menu, where such a cap exists.
 *
 * CC <= 2.1.150 (HelpV2.tsx) computed a HEIGHT and arbitrarily halved it:
 *
 *   const maxHeight = Math.floor(rows / 2);      // {rows:R,columns:C}=F(),H=Math.floor(R/2)
 *
 * Removing the `/2` there is unit-correct: the value is a height in rows, and
 * using the whole terminal instead of half of it is exactly what this feature
 * promises. That arm is kept.
 *
 * CC >= 2.1.152 replaced it with a fit computation (verified on the 2.1.246
 * payload, chunk 528):
 *
 *   function Di(wp,za){
 *     let Ga=za===void 0?"compact":za,
 *         {rows:kp}=xn(hn()),
 *         Cp=Ga==="expanded"?3:Ga==="compact"?1:2,   // ROWS PER ITEM
 *         Mp=Math.max(1,Math.floor((kp-8)/Cp));      // items that fit on screen
 *     return Math.min(wp,Mp);                        // clamp the request
 *   }
 *
 * and the caller is `Di(Tf,Sf?"compact-vertical":yt)` with `Tf=na===void 0?5:na`
 * -- that is, `visibleOptionCount`, the very default this feature rewrites to 25.
 * So the feature already works end to end: the request becomes 25 and `Di` clamps
 * it to what the terminal can actually show.
 *
 * `Cp` is a rows-per-item divisor, NOT a cap. This arm used to rewrite
 * `Math.max(1,Math.floor((kp-Rs)/Cp))` into `Math.max(1,kp-Rs)`, which is a unit
 * error: it makes the menu claim up to 3x more items than fit (expanded mode) and
 * destroys the only clamp keeping the list inside the terminal. The pattern was
 * matched by shape while the meaning underneath it had changed.
 *
 * The old half-cap shape has ZERO occurrences in 2.1.246, so on such builds there
 * is nothing to lift and the correct action is to leave the payload alone.
 */
const patchHelpMenuHeight = (file: string): MenuHeightOutcome => {
  // CC <= 2.1.150: {rows:VAR,columns:VAR}=FUNC(),VAR=Math.floor(VAR/2)
  const halfHeightPattern =
    /\{rows:([\w$]+),columns:[\w$]+\}=[\w$]+\(\),([\w$]+)=Math\.floor\(\1\/2\)/;
  const halfHeightMatch = file.match(halfHeightPattern);

  if (halfHeightMatch && halfHeightMatch.index !== undefined) {
    const assignStart =
      halfHeightMatch.index +
      halfHeightMatch[0].indexOf(halfHeightMatch[2] + '=Math.floor(');
    const assignEnd = halfHeightMatch.index + halfHeightMatch[0].length;
    const replacement = `${halfHeightMatch[2]}=${halfHeightMatch[1]}`;

    const newFile =
      file.slice(0, assignStart) + replacement + file.slice(assignEnd);

    showDiff(file, newFile, replacement, assignStart, assignEnd);
    return { kind: 'patched', file: newFile };
  }

  // CC >= 2.1.152: the fit computation, recognised by its rows-per-item table.
  // Recognised so its absence can be told apart from an unknown build shape --
  // never rewritten.
  const fitPattern =
    /Math\.max\(1,Math\.floor\(\(([\w$]+)-([\w$]+)\)\/([\w$]+)\)\)/g;
  let fitMatch: RegExpExecArray | null;
  while ((fitMatch = fitPattern.exec(file)) !== null) {
    const nearby = file.slice(Math.max(0, fitMatch.index - 250), fitMatch.index);
    if (nearby.includes('"expanded"?3') && nearby.includes('"compact"?1:2')) {
      return { kind: 'notApplicable' };
    }
  }

  return { kind: 'unknown' };
};

/**
 * Recognise the Commands.tsx visible-count formula, so its presence is not
 * mistaken for a missing patch site.
 *
 * On 2.1.246 (chunk 1318):
 *
 *   let xo=Math.max(1,Math.floor((fe-10)/2));
 *   ... o(K,{options:No,visibleOptionCount:xo,layout:"compact-vertical",...})
 *
 * The result is handed to the select as `visibleOptionCount` for a
 * `compact-vertical` layout -- the layout whose rows-per-item is 2. The `/2` is
 * therefore the same rows-per-item conversion as `Cp` above, computed at the call
 * site, and `-10` is the dialog's own chrome.
 *
 * This arm used to rewrite the whole expression to `Math.max(1,fe-3)`, roughly
 * doubling the claim. Combined with the divisor removal above -- which took away
 * the clamp that would have caught it -- the two edits together let the list
 * render past the bottom of the terminal.
 *
 * Nothing here is a cap, so nothing here is patched.
 */
const hasCommandsFitFormula = (file: string): boolean =>
  /Math\.max\(1,Math\.floor\(\([\w$]+-10\)\/2\)\)/.test(file);

/**
 * Patch the slash command autocomplete suggestions cap.
 *
 * Original: Math.min(6, Math.max(1, rows - 3))
 * Patched:  Math.max(1, rows - 3)
 *
 * The Math.min(6,...) hardcaps visible suggestions to 6.
 */
const patchSuggestionsCap = (file: string): string | null => {
  const pattern = /Math\.min\(6,Math\.max\(1,([\w$]+)-3\)\)/;
  const match = file.match(pattern);

  if (!match || match.index === undefined) {
    return null;
  }

  const rowsVar = match[1];
  const replacement = `Math.max(1,${rowsVar}-3)`;

  const newFile =
    file.slice(0, match.index) +
    replacement +
    file.slice(match.index + match[0].length);

  showDiff(
    file,
    newFile,
    replacement,
    match.index,
    match.index + match[0].length
  );

  return newFile;
};

export const writeShowMoreItemsInSelectMenus = (
  oldFile: string,
  numberOfItems: number
): string | null => {
  const locations = getShowMoreItemsInSelectMenusLocation(oldFile);
  if (locations.length === 0) {
    console.error(
      'patch: writeShowMoreItemsInSelectMenus: failed to find locations'
    );
    return null;
  }

  // Sort locations by start index in descending order to apply from end to beginning
  const sortedLocations = locations.sort((a, b) => b.startIndex - a.startIndex);

  let newFile = oldFile;
  for (const location of sortedLocations) {
    const newContent = numberOfItems.toString();
    const updatedFile =
      newFile.slice(0, location.startIndex) +
      newContent +
      newFile.slice(location.endIndex);

    showDiff(
      newFile,
      updatedFile,
      newContent,
      location.startIndex,
      location.endIndex
    );
    newFile = updatedFile;
  }

  // Lift the half-terminal cap on the help/command menu where one exists.
  // On builds that compute the fit instead of capping, there is nothing to lift:
  // the visibleOptionCount default rewritten above is the whole feature, and the
  // product's own clamp keeps the list inside the terminal.
  const heightOutcome = patchHelpMenuHeight(newFile);
  if (heightOutcome.kind === 'patched') {
    newFile = heightOutcome.file;
  } else if (heightOutcome.kind === 'unknown' && !hasCommandsFitFormula(newFile)) {
    console.error(
      'patch: writeShowMoreItemsInSelectMenus: failed to find help menu height pattern'
    );
  }

  // Also patch the slash command autocomplete suggestions cap when present.
  // Math.min(6,Math.max(1,rows-3)) → Math.max(1,rows-3)
  // CC 2.1.138 removed this obsolete non-overlay fallback, so absence is OK.
  const suggestionsPatched = patchSuggestionsCap(newFile);
  if (suggestionsPatched) {
    newFile = suggestionsPatched;
  }

  return newFile;
};
