// Please see the note about writing patches in ./index

import { LocationResult, showDiff } from './index';

const getStartupBannerLocation = (oldFile: string): LocationResult | null => {
  // CC <2.1.83: Find the createElement with isBeforeFirstMessage:!1
  const pattern =
    /,[$\w]+\.createElement\([$\w]+,\{isBeforeFirstMessage:!1\}\),/;
  const match = oldFile.match(pattern);

  if (match && match.index !== undefined) {
    return {
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    };
  }

  return null;
};

export const writeHideStartupBanner = (oldFile: string): string | null => {
  const location = getStartupBannerLocation(oldFile);
  if (location) {
    const newFile =
      oldFile.slice(0, location.startIndex) +
      ',' +
      oldFile.slice(location.endIndex);
    showDiff(oldFile, newFile, ',', location.startIndex, location.endIndex);
    return newFile;
  }

  // CC >=2.1.156: the startup card component contains both the full-logo
  // branch and the compact/horizontal card branch. Disable the whole component.
  const modernCardPatterns = [
    /(function [$\w]+\(\)\{)(?=let [$\w]+=[\w$]+\.c\(\d+\),[$\w]+=[\w$]+\(\)\.oauthAccount\?\.displayName\?\?""|let [$\w]+=[\w$]+\(\),[$\w]+=[\w$]+\?\.displayName\?\?"")/,
    /(function [$\w]+\(\)\{)(?=let [$\w]+=[\w$]+\.c\(\d+\),[$\w]+=[\w$]+\(\),[$\w]+=[\w$]+\?\.displayName\?\?"")/,
  ];

  for (const modernCardPattern of modernCardPatterns) {
    const modernCardMatch = oldFile.match(modernCardPattern);
    if (modernCardMatch && modernCardMatch.index !== undefined) {
      const insertIndex = modernCardMatch.index + modernCardMatch[1].length;
      const insertion = 'return null;';
      const newFile =
        oldFile.slice(0, insertIndex) + insertion + oldFile.slice(insertIndex);

      showDiff(oldFile, newFile, insertion, insertIndex, insertIndex);
      return newFile;
    }
  }

  // CC >=2.1.83: The startup banner is a standalone zero-arg component function.
  // It contains both "Apple_Terminal" (for theme branching) and "Welcome to Claude Code".
  // Insert `return null;` at the start of its body.
  // The `Apple_Terminal` theme branch is looked for across the body, closing
  // braces included. `[^}]{0,500}` could not reach it once the component gained
  // an early `if(...){...}`: in 2.1.246 the banner opens with a rows check and
  // the branch sits past several closing braces, so the lookahead failed and
  // the patch went dead. What identifies the component is the pair -- the theme
  // branch AND the welcome text in the same body -- not how few braces separate
  // them.
  const funcPattern =
    /(function ([$\w]+)\(\)\{)(?=[\s\S]{0,2000}Apple_Terminal)/g;

  const candidates: Array<{ name: string; bodyStart: number }> = [];
  let funcMatch: RegExpExecArray | null;
  while ((funcMatch = funcPattern.exec(oldFile)) !== null) {
    const bodyStart = funcMatch.index + funcMatch[0].length;
    if (
      oldFile
        .slice(bodyStart, bodyStart + 5000)
        .includes('Welcome to Claude Code')
    ) {
      candidates.push({ name: funcMatch[2], bodyStart });
    }
  }

  // Taking the first of several would be a coin toss dressed up as a result:
  // the loser is a component that keeps rendering and a banner that is still
  // there. One candidate in every bundle measured (2.1.239 and 2.1.246); more
  // than one means the shape stopped being distinctive and wants looking at.
  if (candidates.length > 1) {
    console.error(
      `patch: hideStartupBanner: ${candidates.length} components carry both the ` +
        `Apple_Terminal branch and the welcome text (${candidates.map(c => c.name).join(', ')}) — ` +
        'refusing to guess which one is the banner'
    );
    return null;
  }
  if (candidates.length === 1) {
    const insertIndex = candidates[0].bodyStart;
    const insertion = 'return null;';

    const newFile =
      oldFile.slice(0, insertIndex) + insertion + oldFile.slice(insertIndex);

    showDiff(oldFile, newFile, insertion, insertIndex, insertIndex);
    return newFile;
  }

  console.error(
    'patch: hideStartupBanner: failed to find startup banner component'
  );
  return null;
};
