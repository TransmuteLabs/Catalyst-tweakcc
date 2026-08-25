// Please see the note about writing patches in ./index

import { showDiff } from './index';

/**
 * CC v2.0.50
 * ```diff
 *  case "thinking":
 * -  if (!V && !I) return null;
 *    return w3.createElement(Q$Q, {
 *      addMargin: B,
 *      param: A,
 * -    isTranscriptMode: V,
 * +    isTranscriptMode: true,
 *      verbose: I,
 *    });
 * ```
 *
 * CC v2.1.18
 * ```diff
 *  case "thinking": {
 * -  if (!D && !H) return null;
 *    let T = D && !(!P || f === P),
 *      k;
 *    if (K[22] !== Y || K[23] !== D || K[24] !== q || K[25] !== T || K[26] !== H)
 *      k = Y9.createElement(YW1, {
 *        addMargin: Y,
 *        param: q,
 * -      isTranscriptMode: D,
 * +      isTranscriptMode: true,
 *        verbose: H,
 *        hideInTranscript: T,
 *      });
 *  }
 * ```
 */

export const writeThinkingVisibility = (oldFile: string): string | null => {
  // What ties the guard to the element is the pair of variable names, not their
  // position: the early return is `if(!A&&!B)` exactly when the element carries
  // `isTranscriptMode:A,verbose:B`. Anchoring on that pair instead of on the
  // distance between them is what survived 2.1.239, where a `shouldShowDot`
  // branch moved in between and pushed the guard out of the old 80-character
  // window. Measured across every bundle from 2.1.81 to 2.1.246: exactly one
  // match in each, and the same edit as before on the versions that already
  // worked.
  //   1 `case"thinking":` (+/- `{`)
  //   2 whatever the case opens with, which may be a whole sibling branch
  //   3 the early return to delete
  //   4,5 the transcript-mode and verbose variables
  //   6 up to and including `isTranscriptMode:`, whose value becomes `true`
  //   7 the `verbose:B` tail, carried over untouched
  const pattern =
    /(case"thinking":\{?)((?:(?!case")[\s\S]){0,800}?)(if\(!([$\w]+)&&!([$\w]+)\)\s*(?:\{\s*return null\s*;?\s*\}|return null\s*;?))((?:(?!case")[\s\S]){0,800}?isTranscriptMode:)\4\s*,(\s*verbose:\5\s*[,}])/g;

  const matches = [...oldFile.matchAll(pattern)];

  if (matches.length === 0) {
    console.error(
      'patch: thinkingVisibility: failed to find thinking visibility pattern'
    );
    return null;
  }

  // Two candidates would mean the pair no longer identifies the site, and the
  // loser is a thinking block that keeps hiding itself. Refuse rather than guess.
  if (matches.length > 1) {
    console.error(
      `patch: thinkingVisibility: ${matches.length} thinking cases carry the same ` +
        'guard/element pair, refusing to guess which one to unhide'
    );
    return null;
  }

  const match = matches[0];
  if (match.index === undefined) return null;

  // Everything is carried over except the early return, which is dropped, and
  // the transcript-mode value, which becomes `true`.
  const replacement = match[1] + match[2] + match[6] + 'true,' + match[7];

  const startIndex = match.index;
  const endIndex = startIndex + match[0].length;

  const newFile =
    oldFile.slice(0, startIndex) + replacement + oldFile.slice(endIndex);

  showDiff(oldFile, newFile, replacement, startIndex, endIndex);

  return newFile;
};
