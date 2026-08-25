import {
  LocationResult,
  escapeIdent,
  findBoxComponent,
  findChalkVar,
  findTextComponent,
  getReactVar,
  moduleSliceAround,
  showDiff,
} from './index';

/**
 * PATCH 1: Finds the location of the version output pattern in Claude Code's cli.js
 */
export const findVersionOutputLocation = (
  fileContents: string
): LocationResult | null => {
  // Pattern: }.VERSION} (Claude Code)
  const versionPattern = '}.VERSION} (Claude Code)';
  const versionIndex = fileContents.indexOf(versionPattern);
  if (versionIndex == -1) {
    console.error(
      'patch: patchesAppliedIndication: failed to find versionIndex'
    );
    return null;
  }

  return {
    startIndex: 0,
    endIndex: versionIndex + versionPattern.length,
  };
};

interface JsxHeader {
  /** Element factory to call, e.g. `X.jsx` or a bare `l`. */
  factory: string;
  /** Ink Text component, taken from the header itself. */
  textComponent: string;
  /** Ink Box component of the column the header sits in. */
  boxComponent: string;
  /** Offset just past the version element -- where a sibling child goes. */
  versionElEnd: number;
  /** Offset of the `]` closing the column's children -- where the list goes. */
  columnEnd: number;
}

/**
 * Locates the startup header when it is compiled to the JSX automatic runtime:
 *
 *   HDR = jsxs(TEXT,{children:[BOLD," ",jsxs(TEXT,{dimColor:!0,children:["v",VER]})]})
 *   ...  jsxs(BOX,{flexDirection:"column",children:[HDR,...]})
 *
 * Everything the caller may emit -- the factory, the Text, the Box -- is read
 * out of this one chain, and the whole chain is required to sit inside a single
 * bundle module. That is not belt-and-braces: on 2.1.246 the version element's
 * shape occurs three times, twice in the fleet view, and the Text component `a`
 * there is a different import than the `c` of the real header. Anchoring on
 * shape alone would render the tweakcc line into the wrong screen, or emit a
 * name that does not exist where it lands. Requiring the assignment and the
 * column box to resolve in the same module leaves exactly one candidate.
 *
 * The factory is captured rather than assumed: from 2.1.242 a chunk imports the
 * runtime under a plain name, so the call reads `l(c,{...})` and not
 * `X.jsxs(c,{...})`. `jsx` and `jsxs` differ only in a static-children hint, so
 * whichever one the header used is fine for every element emitted beside it.
 */
const findJsxHeader = (fileContents: string): JsxHeader | null => {
  const versionEl =
    /(?:([$\w]+)\.jsxs?|([$\w]+))\(([$\w]+),\{dimColor:!0,children:\["v",[$\w]+\]\}\)/g;

  const found: JsxHeader[] = [];

  for (const m of fileContents.matchAll(versionEl)) {
    if (m.index === undefined) continue;
    const factory = m[1] ? `${m[1]}.jsx` : m[2];
    const textComponent = m[3];
    const callee = m[1] ? `${escapeIdent(m[1])}\\.jsxs?` : escapeIdent(m[2]);

    const [modStart, modEnd] = moduleSliceAround(fileContents, m.index);
    const mod = fileContents.slice(modStart, modEnd);
    const versionAt = m.index - modStart;

    // Header row: the nearest `VAR=<factory>(TEXT,{children:[` before it.
    const hdrRe = new RegExp(
      `([$\\w]+)=${callee}\\(${escapeIdent(textComponent)},\\{children:\\[`,
      'g'
    );
    let headerVar: string | undefined;
    for (const h of mod.matchAll(hdrRe)) {
      if (h.index === undefined || h.index >= versionAt) break;
      headerVar = h[1];
    }
    if (!headerVar) continue;

    // Column box whose first child is that row. Kept to a window after the
    // header so a far-away column starting with a same-named var cannot win.
    const colRe = new RegExp(
      `${callee}\\(([$\\w]+),\\{flexDirection:"column",children:\\[${escapeIdent(headerVar)}(?:,[^\\]]*)?\\]`
    );
    const windowStr = mod.slice(versionAt, versionAt + 6000);
    const col = windowStr.match(colRe);
    if (!col || col.index === undefined) continue;

    found.push({
      factory,
      textComponent,
      boxComponent: col[1],
      versionElEnd: m.index + m[0].length,
      columnEnd: modStart + versionAt + col.index + col[0].length - 1,
    });
  }

  if (found.length === 0) return null;
  if (found.length > 1) {
    console.error(
      `patch: patchesAppliedIndication: ${found.length} headers resolve a full ` +
        'row-and-column chain, refusing to guess which screen is the startup header'
    );
    return null;
  }
  return found[0];
};

/**
 * PATCH 2: Finds the VyK compact header and returns locations for:
 *   1. Where to insert the tweakcc variable declaration (before the I= assignment)
 *   2. Where to insert the variable reference (before the closing paren of I's createElement)
 */
const findTweakccVersionLocations = (
  fileContents: string
):
  | { jsx: true; insertIndex: number; jsxVar: string; textComponent: string }
  | {
      jsx?: false;
      varInsertIndex: number;
      refInsertIndex: number;
      reactVar: string;
      textComponent: string;
    }
  | null => {
  // CC >=2.1.x compiles the header with the React JSX automatic runtime:
  //   _=X.jsxs(TEXT,{children:[BOLD," ",X.jsxs(TEXT,{dimColor:!0,children:["v",VER]})]})
  // Insert the tweakcc version as a sibling child right after the version element
  // (before the outer children-array `]`).
  const jsxVersionPattern =
    /([$\w]+)\.jsxs?\(([$\w]+),\{dimColor:!0,children:\["v",[$\w]+\]\}\)/;
  const jsxMatch = fileContents.match(jsxVersionPattern);
  if (jsxMatch && jsxMatch.index !== undefined) {
    return {
      jsx: true,
      insertIndex: jsxMatch.index + jsxMatch[0].length,
      jsxVar: jsxMatch[1],
      textComponent: jsxMatch[2],
    };
  }

  // Find: createElement(TEXT,{bold:!0},"Claude Code"),CACHE[N]=x;else x=CACHE[N];
  // This gives us the position right after the x assignment block — where we insert our var
  const boldPattern =
    /createElement\(([$\w]+),\{bold:!0\},"Claude Code"\),([$\w]+)\[\d+\]=[$\w]+;else [$\w]+=([$\w]+)\[\d+\]/;
  const boldMatch = fileContents.match(boldPattern);
  if (!boldMatch || boldMatch.index === undefined) {
    console.error(
      'patch: patchesAppliedIndication: PATCH 2 failed to find bold Claude Code pattern'
    );
    return null;
  }
  const textComponent = boldMatch[1];

  // Find the end of the "else x=q[8];" statement — insert our var declaration after it
  const afterBold = boldMatch.index + boldMatch[0].length;
  // Skip past the semicolon
  const semiIndex = fileContents.indexOf(';', afterBold);
  if (semiIndex === -1) return null;
  const varInsertIndex = semiIndex + 1;

  // Now find the I= createElement that wraps x and the version
  // Pattern: REACT.createElement(TEXT,null,MEMO_VAR," ",REACT.createElement(TEXT,{dimColor:!0},"v",VAR))
  const newPattern =
    /[^$\w]([$\w]+)\.createElement\(([$\w]+),null,[$\w]+," ",([$\w]+)\.createElement\(([$\w]+),\{dimColor:!0\},"v",[$\w]+\)\)/;
  const match = fileContents.match(newPattern);
  if (!match || match.index === undefined) {
    // Fallback: old pattern (pre-React-compiler)
    const oldPattern =
      /[^$\w]([$\w]+)\.createElement\(([$\w]+),\{bold:!0\},"Claude Code"\)," ",([$\w]+)\.createElement\(([$\w]+),\{dimColor:!0\},"v",[$\w]+\)/;
    const oldMatch = fileContents.match(oldPattern);
    if (!oldMatch || oldMatch.index === undefined) {
      console.error(
        'patch: patchesAppliedIndication: PATCH 2 failed to find version createElement'
      );
      return null;
    }
    return {
      varInsertIndex,
      refInsertIndex: oldMatch.index + oldMatch[0].length,
      reactVar: oldMatch[1],
      textComponent,
    };
  }

  // Insert before the last ) of the createElement
  return {
    varInsertIndex,
    refInsertIndex: match.index + match[0].length - 1,
    reactVar: match[1],
    textComponent,
  };
};

/**
 * PATCH 4: Inserts tweakcc version in the indicator view
 * Returns the modified content and the position where the closing paren was added
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const applyIndicatorViewPatch = (
  fileContents: string,
  tweakccVersion: string,
  reactVar: string,
  boxComponent: string,
  textComponent: string,
  chalkVar: string
): { content: string; closingParenIndex: number } | null => {
  // 1. Find alignItems:"center",minHeight:<value>, where value can be a number or ternary
  const alignItemsPattern =
    /alignItems:"center",minHeight:([$\w]+\?\d+:\d+|\d+),?/;
  const alignItemsMatch = fileContents.match(alignItemsPattern);
  if (!alignItemsMatch || alignItemsMatch.index === undefined) {
    console.error(
      'patch: patchesAppliedIndication: failed to find alignItems pattern for PATCH 4'
    );
    return null;
  }

  // 2. Replace alignItems:"center",minHeight:<value>, with just minHeight:<value>,
  const minHeightValue = alignItemsMatch[1];
  let content =
    fileContents.slice(0, alignItemsMatch.index) +
    `minHeight:${minHeightValue},` +
    fileContents.slice(alignItemsMatch.index + alignItemsMatch[0].length);

  // 3. Go back 200 chars from the alignItems location
  const lookbackStart = Math.max(0, alignItemsMatch.index - 200);
  const lookbackSubstring = content.slice(
    lookbackStart,
    alignItemsMatch.index + 'minHeight:9,'.length + '},'.length
  );

  // 4. Find the LAST createElement call in that subsection to get the insertion point
  const createElementPattern =
    /[^$\w]([$\w]+)\.createElement\(([$\w]+),(?:\w+|\{[^}]+\}),/g;
  const matches = Array.from(lookbackSubstring.matchAll(createElementPattern));
  if (matches.length === 0) {
    console.error(
      'patch: patchesAppliedIndication: failed to find createElement for PATCH 4'
    );
    return null;
  }

  const lastMatch = matches[matches.length - 1];

  // Calculate the absolute position after the createElement call
  const matchPositionInFile =
    lookbackStart + lastMatch.index! + lastMatch[0].length;

  // 5. Insert the tweakcc version code after the createElement call
  const insertCode = `${reactVar}.createElement(${textComponent}, null, ${chalkVar}.blue.bold("     + tweakcc v${tweakccVersion}")),${reactVar}.createElement(${boxComponent},{alignItems:"center",flexDirection:"column"},`;

  const oldContent = content;
  content =
    content.slice(0, matchPositionInFile) +
    insertCode +
    content.slice(matchPositionInFile);

  showDiff(
    oldContent,
    content,
    insertCode,
    matchPositionInFile,
    matchPositionInFile
  );

  // 6. Use stack machine to find where to add the closing paren
  let level = 1;
  let currentIndex = matchPositionInFile + insertCode.length;
  let closingParenIndex = -1;

  while (currentIndex < content.length) {
    const ch = content[currentIndex];
    if (ch === '(') {
      level++;
    } else if (ch === ')') {
      if (level === 1) {
        // Found the location - this is where we add the closing paren
        closingParenIndex = currentIndex;
        break;
      }
      level--;
    }
    currentIndex++;
  }

  if (closingParenIndex === -1) {
    console.error(
      'patch: patchesAppliedIndication: failed to find closing paren for PATCH 4'
    );
    return null;
  }

  // 7. Add ")," at the location
  const oldContent2 = content;
  content =
    content.slice(0, closingParenIndex) +
    '),' +
    content.slice(closingParenIndex);

  showDiff(oldContent2, content, '),', closingParenIndex, closingParenIndex);

  return { content, closingParenIndex: closingParenIndex + 2 }; // +2 for the added "),"
};

/**
 * PATCH 5: Inserts patches applied list in the indicator view
 * Uses stack machine starting at level 2 to find insertion point
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const applyIndicatorPatchesListPatch = (
  fileContents: string,
  startIndex: number,
  reactVar: string,
  boxComponent: string,
  textComponent: string,
  chalkVar: string,
  patchesApplies: string[]
): string | null => {
  // Find the insertion point: the closing paren of the Fragment createElement that
  // wraps the entire header component output.
  //
  // Strategy 1 (CC ≥2.1.79): Find createElement(REACT.Fragment,null,...) near the
  // alignItems location and use its closing paren.
  // Strategy 2 (older CC): Use stack machine from startIndex at level 4.
  let insertionIndex = -1;

  // Strategy 1: Look for Fragment createElement after startIndex
  const fragmentPattern = /createElement\([$\w]+\.Fragment,null,/;
  const searchRegion = fileContents.slice(startIndex, startIndex + 5000);
  const fragmentMatch = searchRegion.match(fragmentPattern);

  if (fragmentMatch && fragmentMatch.index !== undefined) {
    // Walk to find the closing paren of this createElement call
    const fragStart = startIndex + fragmentMatch.index;
    let level = 1; // we're right after "createElement("
    const scanFrom = fragStart + fragmentMatch[0].length;
    for (let i = scanFrom; i < fileContents.length; i++) {
      const ch = fileContents[i];
      if (ch === '(') level++;
      else if (ch === ')') {
        level--;
        if (level === 0) {
          insertionIndex = i;
          break;
        }
      }
    }
  }

  // Strategy 2: Stack machine (older CC)
  if (insertionIndex === -1) {
    let level = 4;
    let currentIndex = startIndex;
    while (
      currentIndex < fileContents.length &&
      currentIndex < startIndex + 10000
    ) {
      const ch = fileContents[currentIndex];
      if (ch === '(') {
        level++;
      } else if (ch === ')') {
        if (level === 1) {
          insertionIndex = currentIndex;
          break;
        }
        level--;
      }
      currentIndex++;
    }
  }

  if (insertionIndex === -1) {
    console.error(
      'patch: patchesAppliedIndication: failed to find insertion point for PATCH 5'
    );
    return null;
  }

  // Build the patches applied list (same format as PATCH 3)
  const lines = [];
  lines.push(
    `,${reactVar}.createElement(${boxComponent}, { flexDirection: "column" },`
  );
  lines.push(
    `${reactVar}.createElement(${boxComponent}, null, ${reactVar}.createElement(${textComponent}, {color: "success", bold: true}, "┃ "), ${reactVar}.createElement(${textComponent}, {color: "success", bold: true}, "✓ tweakcc patches are applied")),`
  );
  for (let item of patchesApplies) {
    item = item.replace('CHALK_VAR', chalkVar);
    lines.push(
      `${reactVar}.createElement(${boxComponent}, null, ${reactVar}.createElement(${textComponent}, {color: "success", bold: true}, "┃ "), ${reactVar}.createElement(${textComponent}, {dimColor: true}, \`  * ${item}\`)),`
    );
  }
  lines.push('),');
  const patchesListCode = lines.join('');

  // Insert at the found location
  const oldContent = fileContents;
  const content =
    fileContents.slice(0, insertionIndex) +
    patchesListCode +
    fileContents.slice(insertionIndex);

  showDiff(
    oldContent,
    content,
    patchesListCode,
    insertionIndex,
    insertionIndex
  );

  return content;
};

/**
 * PATCH 3: Finds the location to insert the patches applied list
 */
const findPatchesListLocation = (
  fileContents: string
): LocationResult | null => {
  // CC >=2.1.x JSX automatic runtime: the header row lives inside a column box
  //   HDR=X.jsxs(TEXT,{children:[...,X.jsxs(TEXT,{dimColor:!0,children:["v",VER]})...]})
  //   ...X.jsxs(BOX,{flexDirection:"column",children:[HDR,...]})
  // Insert the patches list as the last child of that column array. identifiers
  // carries [jsxVar, boxVar] to signal jsx mode to the codegen.
  const jsxVerMatch = fileContents.match(
    /([$\w]+)\.jsxs?\([$\w]+,\{dimColor:!0,children:\["v",[$\w]+\]\}\)/
  );
  if (jsxVerMatch && jsxVerMatch.index !== undefined) {
    const jsxVar = jsxVerMatch[1];
    // Header row var = nearest `VAR=<jsxVar>.jsxs(TEXT,{children:[` before the version element.
    const hdrAssignRe = new RegExp(
      `([$\\w]+)=${escapeIdent(jsxVar)}\\.jsxs\\([$\\w]+,\\{children:\\[`,
      'g'
    );
    let hdrVar: string | undefined;
    let m: RegExpExecArray | null;
    while ((m = hdrAssignRe.exec(fileContents)) !== null) {
      if (m.index > jsxVerMatch.index) break;
      hdrVar = m[1];
    }
    if (hdrVar) {
      // Match the column box whose FIRST child is exactly the header row var
      // (require `,`/`]` after it so we don't match a longer var like `_A`).
      // Scope to a window just after the header so a far-away `[_,...]` column
      // (e.g. the IDE-warning box) can't be picked instead.
      const colRe = new RegExp(
        `${escapeIdent(jsxVar)}\\.jsxs\\(([$\\w]+),\\{flexDirection:"column",children:\\[${escapeIdent(hdrVar)}(?:,[^\\]]*)?\\]`
      );
      const windowStart = jsxVerMatch.index;
      const windowStr = fileContents.slice(windowStart, windowStart + 6000);
      const colMatch = windowStr.match(colRe);
      if (colMatch && colMatch.index !== undefined) {
        const boxVar = colMatch[1];
        // Insert before the `]` that closes the column children array.
        const insertIndex =
          windowStart + colMatch.index + colMatch[0].length - 1;
        return {
          startIndex: insertIndex,
          endIndex: insertIndex,
          identifiers: [jsxVar, boxVar],
        };
      }
    }
  }

  // 1. Find the version display area (may already be modified by PATCH 2)
  // Find the "Claude Code" that's near dimColor:!0},"v" (the header version display)
  const versionDisplayPattern =
    /"Claude Code".{0,200}\{dimColor:!0\},"v",[$\w]+\)/;
  const versionDisplayMatch = fileContents.match(versionDisplayPattern);
  if (!versionDisplayMatch || versionDisplayMatch.index === undefined) {
    console.error(
      'patch: patchesAppliedIndication: failed to find version display for patch 3'
    );
    return null;
  }
  const matchResult = { index: versionDisplayMatch.index };

  // 2. Go back 5000 chars from the match start. CC ≥2.1.140 emits a very long
  // React-compiled header function (Cf4) where the version display lives ~1900+ bytes
  // after the function head. PATCH 2's own insertions push that further. 5000 leaves
  // a comfortable margin for future CC builds while still being scoped to "this region".
  const lookbackStart = Math.max(0, matchResult.index - 5000);
  const lookbackSubstring = fileContents.slice(
    lookbackStart,
    matchResult.index
  );

  // 3. Take the last function-declaration boundary. CC ≤2.1.138 emitted these as
  // `}function NAME(` (close-brace immediately followed by `function`). CC 2.1.140
  // emits them as `});function NAME(` (var/IIFE block close + semicolon, then
  // `function`). Allow either `}`, `;`, `)`, or `,` as the boundary char and let
  // arbitrary whitespace sit between the boundary and `function`.
  const functionPattern = /[};]\s*function ([$\w]+)\(/g;
  const functionMatches = Array.from(
    lookbackSubstring.matchAll(functionPattern)
  );
  if (functionMatches.length === 0) {
    console.error(
      'patch: patchesAppliedIndication: failed to find header component function'
    );
    return null;
  }
  const lastFunctionMatch = functionMatches[functionMatches.length - 1];
  const headerComponentName = lastFunctionMatch[1];

  // 4. Search for the createElement call with the header component
  const createHeaderPattern = new RegExp(
    `[^$\\w]([$\\w]+)\\.createElement\\(${escapeIdent(headerComponentName)},null\\),?`
  );
  const createHeaderMatch = fileContents.match(createHeaderPattern);
  if (!createHeaderMatch || createHeaderMatch.index === undefined) {
    console.error(
      'patch: patchesAppliedIndication: failed to find createElement call for header'
    );
    return null;
  }

  // 5. Find the variable assigned from createElement(header,null) and locate
  // where it's used as a child in a parent createElement. Insert after it there.
  // This works regardless of whether PATCH 2 has already modified the area.

  // Look backwards from createElement to find the variable name
  const beforeCreate = fileContents.slice(
    Math.max(0, createHeaderMatch.index - 30),
    createHeaderMatch.index + 1
  );
  // Match: VAR=COND&&  or  VAR=
  const varMatch = beforeCreate.match(/([$\w]+)=(?:[$\w]+&&)?[^$\w]?$/);
  if (varMatch) {
    const headerVar = varMatch[1];
    // Find where this variable is used as a child in a createElement:
    // ,headerVar, or ,headerVar) — in a flexDirection:"column" parent
    const searchAfter = fileContents.slice(
      createHeaderMatch.index,
      createHeaderMatch.index + 2000
    );
    // Look for ,VAR, (used as middle child) or ,VAR) (used as last child)
    const childUsePattern = new RegExp(`,${escapeIdent(headerVar)}([,\\)])`);
    const childUseMatch = searchAfter.match(childUsePattern);
    if (childUseMatch && childUseMatch.index !== undefined) {
      // Insert right after the variable reference (before the , or ))
      const insertIndex =
        createHeaderMatch.index +
        childUseMatch.index +
        childUseMatch[0].length -
        childUseMatch[1].length; // before the trailing , or )
      return {
        startIndex: insertIndex,
        endIndex: insertIndex,
      };
    }
  }

  // Fallback for older CC: insert after the createElement call
  const insertIndex = createHeaderMatch.index + createHeaderMatch[0].length;
  return {
    startIndex: insertIndex,
    endIndex: insertIndex,
  };
};

/**
 * Modifies the CLI to show patches applied indication
 * - PATCH 1: Modifies version output text
 * - PATCH 2: Adds tweakcc version to header
 * - PATCH 3: Adds patches applied list
 */
export const writePatchesAppliedIndication = (
  fileContents: string,
  tweakccVersion: string,
  patchesApplies: string[],
  showTweakccVersion: boolean = true,
  showPatchesApplied: boolean = true
): string | null => {
  // PATCH 1: Version output modification
  const versionOutputLocation = findVersionOutputLocation(fileContents);
  if (!versionOutputLocation) {
    console.error(
      'patch: patchesAppliedIndication: failed to version output location'
    );
    return null;
  }

  const newText = `\\n${tweakccVersion} (tweakcc)`;
  // Patch ALL occurrences of the version pattern (commander help text + console.log early exit)
  const versionPattern = '}.VERSION} (Claude Code)';
  let content = fileContents.replaceAll(
    versionPattern,
    versionPattern + newText
  );

  showDiff(
    fileContents,
    content,
    newText,
    versionOutputLocation.endIndex,
    versionOutputLocation.endIndex
  );

  // Shared lookups for the patches below. None of them is required by PATCH 1,
  // which is already done, and only the classic createElement paths need all
  // three: the JSX-runtime paths take their component and their element factory
  // from the header they matched. Failing here used to discard PATCH 1's work
  // along with everything else -- on a bundle with no React namespace to find,
  // `claude --version` lost its tweakcc line for a reason that had nothing to do
  // with it. Each value is now checked by the branch that actually reads it.
  const chalkVar = findChalkVar(fileContents);
  const textComponent = findTextComponent(fileContents);
  const reactVar = getReactVar(fileContents);

  // PATCH 2: Add tweakcc version to all header paths.
  // Path A: SyK banner borderText (chalk template literal)
  // Path B: SyK compact borderText (chalk call)
  // Path C: VyK compact React createElement (separate variable, like CC does)
  if (showTweakccVersion) {
    // Path A: Banner borderText — ` ${N7("claude",e)("Claude Code")} ${N7("inactive",e)(`v${x}`)} `
    const bannerPattern =
      /(\$\{([$\w]+)\("inactive",([$\w]+)\)\(`v\$\{[$\w]+\}`\)\}) `,/;
    const bannerMatch = content.match(bannerPattern);
    if (bannerMatch && bannerMatch.index !== undefined) {
      const oldStr = bannerMatch[0];
      const n7Fn = bannerMatch[2];
      const themeVar = bannerMatch[3];
      const newStr = `${bannerMatch[1]} \${${n7Fn}("warning",${themeVar})("+ tweakcc v${tweakccVersion}")} \`,`;
      content = content.replace(oldStr, newStr);
    }

    // Path B: SyK compact borderText — K6=N7("claude",e)(" Claude Code ")
    content = content.replace(
      /([$\w]+\("claude",[$\w]+\)\(" Claude Code) ("\))/,
      `$1 + tweakcc v${tweakccVersion} $2`
    );
    const jsxHeader = findJsxHeader(content);
    const locs = jsxHeader ? null : findTweakccVersionLocations(content);
    if (jsxHeader) {
      // Insert the tweakcc version as a sibling child right after the version
      // element. The colour comes from a Text prop rather than from chalk: chalk
      // is resolved file-wide, and on a code-split bundle the name it returns
      // usually belongs to a different module than the one this element lands
      // in, where it is either another value or nothing at all.
      const tweakccEl = `${jsxHeader.factory}(${jsxHeader.textComponent},{color:"#FF8400",bold:true,children:"+ tweakcc v${tweakccVersion}"})`;
      const refCode = `," ",${tweakccEl}`;
      const oldContent2 = content;
      content =
        content.slice(0, jsxHeader.versionElEnd) +
        refCode +
        content.slice(jsxHeader.versionElEnd);
      showDiff(
        oldContent2,
        content,
        refCode,
        jsxHeader.versionElEnd,
        jsxHeader.versionElEnd
      );
    } else if (!locs) {
      console.error(
        'patch: patchesAppliedIndication: patch 2 skipped (header version pattern changed)'
      );
    } else if (locs.jsx) {
      // Reached only when findJsxHeader declined -- the header is JSX but its
      // row or column could not be resolved -- so this keeps the older, shape-only
      // insertion as a fallback.
      if (!chalkVar) {
        console.error(
          'patch: patchesAppliedIndication: patch 2 skipped (no chalk variable for the JSX fallback)'
        );
      } else {
        const tweakccEl = `${locs.jsxVar}.jsx(${locs.textComponent},{children:${chalkVar}.hex("#FF8400").bold("+ tweakcc v${tweakccVersion}")})`;
        const refCode = `," ",${tweakccEl}`;
        const oldContent2 = content;
        content =
          content.slice(0, locs.insertIndex) +
          refCode +
          content.slice(locs.insertIndex);
        showDiff(
          oldContent2,
          content,
          refCode,
          locs.insertIndex,
          locs.insertIndex
        );
      }
    } else if (!chalkVar) {
      console.error(
        'patch: patchesAppliedIndication: patch 2 skipped (no chalk variable)'
      );
    } else {
      // Step 1: Insert variable declaration after the "Claude Code" bold element
      const varName = '_tw';
      const varDecl = `let ${varName}=${locs.reactVar}.createElement(${locs.textComponent},null,${chalkVar}.hex("#FF8400").bold("+ tweakcc v${tweakccVersion}"));`;

      const oldContent2a = content;
      content =
        content.slice(0, locs.varInsertIndex) +
        varDecl +
        content.slice(locs.varInsertIndex);

      showDiff(
        oldContent2a,
        content,
        varDecl,
        locs.varInsertIndex,
        locs.varInsertIndex
      );

      // Step 2: Insert variable reference as sibling in the parent createElement
      // (adjust refInsertIndex for the inserted varDecl)
      const adjustedRefIndex = locs.refInsertIndex + varDecl.length;
      const refCode = `," ",${varName}`;

      const oldContent2b = content;
      content =
        content.slice(0, adjustedRefIndex) +
        refCode +
        content.slice(adjustedRefIndex);

      showDiff(
        oldContent2b,
        content,
        refCode,
        adjustedRefIndex,
        adjustedRefIndex
      );
    }
  }

  // PATCH 3: Add patches applied list (if enabled)
  if (showPatchesApplied) {
    // Re-resolved rather than carried over from PATCH 2: that patch inserts text
    // ahead of this insertion point, so every offset taken before it is stale.
    const listHeader = findJsxHeader(content);
    if (listHeader) {
      // Append the list as the last child of the column the header sits in.
      // Factory, Text and Box all come from that same chain, so every name here
      // is in scope where the code lands. `jsxs` and `jsx` differ only in a
      // static-children hint, so one factory serves rows and leaves alike.
      const { factory, textComponent: text, boxComponent: box } = listHeader;
      const rows: string[] = [];
      rows.push(
        `${factory}(${box},{children:[${factory}(${text},{color:"success",bold:true,children:"┃ "}),${factory}(${text},{color:"success",bold:true,children:"✓ tweakcc patches are applied"})]})`
      );
      for (const item of patchesApplies) {
        rows.push(
          `${factory}(${box},{children:[${factory}(${text},{color:"success",bold:true,children:"┃ "}),${factory}(${text},{dimColor:true,children:\`  * ${item}\`})]})`
        );
      }
      const listEl = `${factory}(${box},{flexDirection:"column",children:[${rows.join(',')}]})`;
      const patchesListCode = `,${listEl}`;
      const oldContent3 = content;
      content =
        content.slice(0, listHeader.columnEnd) +
        patchesListCode +
        content.slice(listHeader.columnEnd);
      showDiff(
        oldContent3,
        content,
        patchesListCode,
        listHeader.columnEnd,
        listHeader.columnEnd
      );
      return content;
    }

    const boxComponent = findBoxComponent(content);
    if (!boxComponent) {
      console.error(
        'patch: patchesAppliedIndication: PATCH 3 skipped (Box component not located on this CC version)'
      );
      return content;
    }
    if (!textComponent) {
      console.error(
        'patch: patchesAppliedIndication: PATCH 3 skipped (Text component not located on this CC version)'
      );
      return content;
    }
    const patchesListLoc = findPatchesListLocation(content);
    if (!patchesListLoc) {
      console.error(
        'patch: patchesAppliedIndication: patch 3 skipped (version display pattern changed by PATCH 2)'
      );
    } else if (
      patchesListLoc.identifiers &&
      patchesListLoc.identifiers.length === 2
    ) {
      // JSX automatic runtime: build the list with jsx-convention calls (children
      // as a prop) using the module's jsx var and the column's box, since the
      // React var has no `.createElement` on these bundles. Insert as the last
      // child of the header's column array.
      const [jsxVar, listBox] = patchesListLoc.identifiers;
      const rows: string[] = [];
      rows.push(
        `${jsxVar}.jsxs(${listBox},{children:[${jsxVar}.jsx(${textComponent},{color:"success",bold:true,children:"┃ "}),${jsxVar}.jsx(${textComponent},{color:"success",bold:true,children:"✓ tweakcc patches are applied"})]})`
      );
      for (let item of patchesApplies) {
        if (chalkVar) item = item.replace('CHALK_VAR', chalkVar);
        rows.push(
          `${jsxVar}.jsxs(${listBox},{children:[${jsxVar}.jsx(${textComponent},{color:"success",bold:true,children:"┃ "}),${jsxVar}.jsx(${textComponent},{dimColor:true,children:\`  * ${item}\`})]})`
        );
      }
      const listEl = `${jsxVar}.jsxs(${listBox},{flexDirection:"column",children:[${rows.join(',')}]})`;
      const patchesListCode = `,${listEl}`;
      const oldContent3 = content;
      content =
        content.slice(0, patchesListLoc.startIndex) +
        patchesListCode +
        content.slice(patchesListLoc.endIndex);
      showDiff(
        oldContent3,
        content,
        patchesListCode,
        patchesListLoc.startIndex,
        patchesListLoc.endIndex
      );
    } else if (!reactVar) {
      console.error(
        'patch: patchesAppliedIndication: PATCH 3 skipped (no React namespace for the createElement list)'
      );
    } else {
      const lines = [];
      lines.push(
        `,${reactVar}.createElement(${boxComponent}, { flexDirection: "column" },`
      );
      lines.push(
        `${reactVar}.createElement(${boxComponent}, null, ${reactVar}.createElement(${textComponent}, {color: "success", bold: true}, "┃ "), ${reactVar}.createElement(${textComponent}, {color: "success", bold: true}, "✓ tweakcc patches are applied")),`
      );
      for (let item of patchesApplies) {
        if (chalkVar) item = item.replace('CHALK_VAR', chalkVar);
        lines.push(
          `${reactVar}.createElement(${boxComponent}, null, ${reactVar}.createElement(${textComponent}, {color: "success", bold: true}, "┃ "), ${reactVar}.createElement(${textComponent}, {dimColor: true}, \`  * ${item}\`)),`
        );
      }
      lines.push('),');
      let patchesListCode = lines.join('\n');

      // Avoid double comma at the start
      if (
        patchesListLoc.startIndex > 0 &&
        content[patchesListLoc.startIndex - 1] === ',' &&
        patchesListCode.startsWith(',')
      ) {
        patchesListCode = patchesListCode.slice(1);
      }

      // Avoid double comma at the end — if patches list ends with ',' and
      // the next char is also ','
      if (
        patchesListCode.endsWith(',') &&
        content[patchesListLoc.startIndex] === ','
      ) {
        patchesListCode = patchesListCode.slice(0, -1);
      }

      const oldContent3 = content;
      content =
        content.slice(0, patchesListLoc.startIndex) +
        patchesListCode +
        content.slice(patchesListLoc.endIndex);

      showDiff(
        oldContent3,
        content,
        patchesListCode,
        patchesListLoc.startIndex,
        patchesListLoc.endIndex
      );
    }
  }

  // PATCH 4 & 5 disabled on CC ≥2.1.86 — the indicator view insertion
  // creates a double-comma syntax error due to changed code structure.
  // Tweakcc version is shown via PATCH 1/2/3.

  return content;
};
