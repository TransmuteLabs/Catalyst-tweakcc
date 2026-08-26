import { debug } from '../utils';
import { showDiff } from './index';

export const writeInputChevronColor = (
  file: string,
  resolvedColor: string
): string | null => {
  const pattern =
    // The gap between the destructuring and the render is BOUNDED. The bundle
    // is a join of ~1400 chunks, and an unbounded lazy span is free to pair a
    // head in one module with a tail in another -- a match that looks right and
    // edits a site in a different chunk. 600 covers every real bundle measured
    // (the widest is well under it).
    //
    // The chevron element is emitted through whatever JSX call form the bundle
    // uses. Up to 2.1.244 that was a React namespace -- `X.jsx(Text, {...})`.
    // From 2.1.245 the chunk imports the runtime as a plain binding, so the
    // same call reads `i(Text, {...})`. Both forms are accepted; nothing else
    // about this site changed across that boundary.
    /,\{isLoading:([$\w]+),(?:[$\w]+:[$\w]+,)*themeColor:([$\w]+)\}=[$\w]+,([$\w]+)=\2\?\?void 0[,;][\s\S]{0,600}?if\([^)]*!==\3[^)]*\|\|[^)]*!==\1[^)]*\)[$\w]+=(?:[$\w]+\.jsxs?|[$\w]+)\([$\w]+,\{color:\3,dimColor:\1,children:/;

  const match = file.match(pattern);

  if (!match || match.index === undefined) {
    debug('patch: inputChevronColor: failed to find chevron component pattern');
    return null;
  }

  const isLoadingVar = match[1];
  const resolvedColorVar = match[3];

  const oldColorPart = `color:${resolvedColorVar},dimColor:${isLoadingVar}`;
  const newColorPart = `color:${isLoadingVar}?${resolvedColorVar}:${JSON.stringify(resolvedColor)},dimColor:!1`;

  const colorPartIndex = match[0].lastIndexOf(oldColorPart);
  const startIndex = match.index + colorPartIndex;
  const endIndex = startIndex + oldColorPart.length;

  const newFile =
    file.slice(0, startIndex) + newColorPart + file.slice(endIndex);

  showDiff(file, newFile, newColorPart, startIndex, endIndex);

  return newFile;
};
