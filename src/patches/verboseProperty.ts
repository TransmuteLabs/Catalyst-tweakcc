// Please see the note about writing patches in ./index

import { LocationResult, showDiff } from './index';

const getVerbosePropertyLocation = (oldFile: string): LocationResult | null => {
  // CC >=2.1.x compiles the UI with the React JSX automatic runtime, so the
  // spinner element is emitted as `X.jsx(C,{...})` / `X.jsxs(C,{...})` rather
  // than `X.createElement(C,{...})`. From 2.1.242 the bundle is code-split and
  // each chunk imports the runtime as a plain binding, so the call is a bare
  // `a(C,{...})` with no recognisable callee name at all. Accept all four
  // forms: what identifies this site is the property set, not the callee --
  // the four lookaheads together occur three times in the 2.1.246 bundle and
  // only one of those also carries `verbose:`.
  const createElementPattern =
    /(?:[$\w]+\.)?(?:createElement|jsxs?|[$\w]+)\([$\w]+,\{(?=[^}]*responseLengthRef:)(?=[^}]*spinnerSuffix:)(?=[^}]*thinkingStatus:)(?=[^}]*isCompacting:)[^}]*verbose:[^,}]+[^}]*\}/;
  const legacyCreateElementPattern =
    /(?:createElement|jsxs?)\([$\w]+,\{[^}]+spinnerTip[^}]+overrideMessage[^}]+\}/;
  const createElementMatch =
    oldFile.match(createElementPattern) ??
    oldFile.match(legacyCreateElementPattern);

  if (!createElementMatch || createElementMatch.index === undefined) {
    console.error(
      'patch: verbose: failed to find createElement with verbose spinner props'
    );
    return null;
  }

  const extractedString = createElementMatch[0];

  const verbosePattern = /verbose:[^,}]+/;
  const verboseMatch = extractedString.match(verbosePattern);

  if (!verboseMatch || verboseMatch.index === undefined) {
    console.error('patch: verbose: failed to find verbose property');
    return null;
  }

  // Calculate absolute positions in the original file
  const absoluteVerboseStart = createElementMatch.index + verboseMatch.index;
  const absoluteVerboseEnd = absoluteVerboseStart + verboseMatch[0].length;

  return {
    startIndex: absoluteVerboseStart,
    endIndex: absoluteVerboseEnd,
  };
};

export const writeVerboseProperty = (oldFile: string): string | null => {
  const location = getVerbosePropertyLocation(oldFile);
  if (!location) {
    return null;
  }

  const newCode = 'verbose:true';
  const newFile =
    oldFile.slice(0, location.startIndex) +
    newCode +
    oldFile.slice(location.endIndex);

  showDiff(oldFile, newFile, newCode, location.startIndex, location.endIndex);
  return newFile;
};
