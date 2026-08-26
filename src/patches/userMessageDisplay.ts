// Please see the note about writing patches in ./index
import {
  escapeIdent,
  findBoxComponent,
  findChalkVar,
  findTextComponent,
  moduleScopeBindings,
  moduleSliceAround,
  showDiff,
} from './index';
import { UserMessageDisplayConfig } from '../types';

/**
 * CC 0.2.9:
 * ```diff
 *  function Cf2({ addMargin: I, param: { text: d } }) {
 *    let { columns: G } = G9();
 *    if (!d) return (X0("No content found in user prompt message"), null);
 *    return XU.default.createElement(
 *      p,
 *      { flexDirection: "row", marginTop: I ? 1 : 0, width: "100%" },
 * -    XU.default.createElement(
 * -      p,
 * -      { minWidth: 2, width: 2 },
 * -      XU.default.createElement(u, { color: r1().secondaryText }, ">"),
 * -    ),
 *      XU.default.createElement(
 *        p,
 *        { flexDirection: "column", width: G - 4 },
 *        XU.default.createElement(
 *          u,
 * -        { color: r1().secondaryText, wrap: "wrap" },
 * -        d,
 * +        null,
 * +        CHALK.styles.here(`${d}`)
 *        ),
 *      ),
 *    );
 *  }
 * ```
 *
 * CC 1.0.50
 * ```diff
 *  function vj2({ addMargin: A, param: { text: B } }) {
 *    let { columns: Q } = w9();
 *    if (!B)
 *      return (b1(new Error("No content found in user prompt message")), null);
 *    return ec.default.createElement(
 *      b,
 *      { flexDirection: "row", marginTop: A ? 1 : 0, width: "100%" },
 * -    ec.default.createElement(
 * -      b,
 * -      { minWidth: 2, width: 2 },
 * -      ec.default.createElement(S, { color: "secondaryText" }, ">"),
 * -    ),
 *      ec.default.createElement(
 *        b,
 *        { flexDirection: "column", width: Q - 4 },
 *        ec.default.createElement(
 *          S,
 * -        { color: "secondaryText", wrap: "wrap" },
 * -        B.trim(),
 * +        {},
 * +        CHALK_VAR.style1.style2(`format ${B.trim()}`),
 *        ),
 *      ),
 *    );
 *  }
 * ```
 *
 * CC 2.0.77
 * ```diff
 *  function an2({ addMargin: A, param: { text: Q }, thinkingMetadata: B }) {
 *    let { columns: G } = QB();
 *    if (!Q) return (r(Error("No content found in user prompt message")), null);
 *    let Z = Q.replace(GB7, "")
 *      .replace(ZB7, "")
 *      .replace(YB7, "")
 *      .replace(JB7, "")
 *      .trim();
 *    return uq0.default.createElement(
 *      T,
 *      { flexDirection: "column", marginTop: A ? 1 : 0, width: G - 4 },
 * -    uq0.default.createElement(in2, { text: Z, thinkingMetadata: B }),
 * +    uq0.default.createElement(BOX_COMP, {border:styles...}, uq0.default.createElement(TEXT_COMP, null, CHALK_VAR.style1.style2(`format ${Z}`))),
 *    );
 *  }
 * ```
 *
 * CC 2.1.21:
 * ```diff
 *  function H8K(A) {
 *    let K = s(7),
 *      { addMargin: q, param: Y, thinkingMetadata: z } = A,
 *      { text: w } = Y,
 *      { columns: H } = M8();
 *    if (!w) return (KA(Error("No content found in user prompt message")), null);
 *    let J = q ? 1 : 0,
 *      O = H - 4,
 *      X;
 *    if (K[0] !== w || K[1] !== z)
 * -    ((X = oR6.default.createElement(z8K, { text: w, thinkingMetadata: z })),
 * +    ((X = oR6.default.createElement(BOX_COMP, {border:styles...}, oR6.default.createElement(TEXT_COMP, null, CHALK_VAR.style1.style2(`format ${w}`))),
 *        (K[0] = w),
 *        (K[1] = z),
 *        (K[2] = X));
 *    else X = K[2];
 *    let $;
 *    if (K[3] !== J || K[4] !== O || K[5] !== X)
 *      (($ = oR6.default.createElement(
 *        I,
 *        { flexDirection: "column", marginTop: J, width: O },
 *        X,
 *      )),
 *        (K[3] = J),
 *        (K[4] = O),
 *        (K[5] = X),
 *        (K[6] = $));
 *    else $ = K[6];
 *    return $;
 *  }
 *  ```
 */

export const writeUserMessageDisplay = (
  oldFile: string,
  config: UserMessageDisplayConfig
): string | null => {
  // These three scan the WHOLE joined bundle. That is only ever correct for a
  // single-module bundle; on a code-split one they are a last-resort fallback
  // and the names actually used are resolved per-module below. They are not
  // fatal here for that reason -- a split bundle may legitimately have no
  // bundle-wide answer while the owning module has a perfectly good one.
  const textComponent = findTextComponent(oldFile);
  const boxComponent = findBoxComponent(oldFile);
  const chalkVar = findChalkVar(oldFile);

  // See the older examples above.  We explictly look for and match the component and subcomponent
  // that renders the ">" in older versions so that we can silently drop it in the replacement,
  // removing it in versions where it's present and not failing on versions where it's not.
  const pattern =
    /(No content found in user prompt message.{0,150}?\b)([$\w]+(?:\.default)?\.createElement.{0,30}\b[$\w]+(?:\.default)?\.createElement.{0,40}">.+?)?(([$\w]+(?:\.default)?\.createElement).{0,100})(\([$\w]+,(?:\{[^{}]+wrap:"wrap"\},([$\w]+)(?:\.trim\(\))?\)\)|\{text:([$\w]+)(?:,thinkingMetadata:[$\w]+)?\}\)\)?))/;

  // CC ≥2.1.79: Rendering delegates to a subcomponent with {text:VAR,...}
  // Pattern: No content found...createElement(BOX,{flexDirection:...},createElement(SUB,{text:VAR,...}))
  const newPattern =
    /(No content found in user prompt message.{0,50}?\b)(([$\w]+(?:\.default)?)\.createElement\([$\w]+,\{flexDirection:"column"[^}]*\},([$\w]+(?:\.default)?\.createElement)\([$\w]+,\{text:([$\w]+)[^}]*\}\)\))/;

  // CC 2.1.138: child display is memoized before the parent Box call.
  // Replace only the child assignment so React compiler cache bookkeeping remains intact.
  // CC >=2.1.x renders via the JSX automatic runtime, so the assignment is
  // `B=X.jsx(SUB,{text:VAR,...})` rather than `B=X.createElement(SUB,{text:VAR,...})`.
  // From 2.1.242 the bundle is code-split and each chunk imports the runtime as
  // a plain binding, so the assignment is a bare `B=o(SUB,{text:VAR,...})` with
  // no namespace in front of it -- accepted as a third callee form, tried last
  // so a namespaced call still wins where one exists. The prop set and the
  // "No content found" anchor are what identify the site; the callee never was.
  const memoizedChildPattern =
    /(No content found in user prompt message.{0,1200}?)([$\w]+)=([$\w]+(?:\.default)?\.(?:createElement|jsxs?)|[$\w]+)\([$\w]+,\{text:([$\w]+),useBriefLayout:[$\w]+,timestamp:[$\w]+\}\)/;

  const oldMatch = oldFile.match(pattern);
  const newMatch = oldMatch ? null : oldFile.match(newPattern);
  const memoizedChildMatch =
    oldMatch || newMatch ? null : oldFile.match(memoizedChildPattern);
  const match = oldMatch ?? newMatch ?? memoizedChildMatch;

  if (!match || match.index === undefined) {
    console.error(
      'patch: userMessageDisplay: failed to find user message display pattern'
    );
    return oldFile;
  }

  let createElementFn: string;
  let messageVar: string;

  let localBoxComponent: string | undefined;

  if (oldMatch) {
    // Old pattern matches
    createElementFn = match[4];
    messageVar = match[6] ?? match[7];
  } else if (newMatch) {
    // New pattern (CC ≥2.1.79)
    createElementFn = match[4];
    messageVar = match[5];
  } else {
    // Memoized child pattern (CC 2.1.138)
    createElementFn = match[3];
    messageVar = match[4];
  }

  // Every minified name in a code-split bundle is LOCAL TO ITS CHUNK. The three
  // resolvers above return the first definition anywhere in the joined text,
  // which from 2.1.242 is almost never in the chunk this edit lands in. On
  // 2.1.246 that emitted `o(l0,null,...)` into module 1036, whose only `l0` is a
  // `let` inside an unrelated function: the product parsed, passed every byte
  // check and printed its version, then died with "l0 is not defined" the moment
  // it drew the first user message. So the names are taken from CALL SITES
  // inside the module that owns the match, where whatever that module uses is
  // correct by construction. On a single-module bundle the slice IS the whole
  // file, so the older shapes resolve exactly as they did before.
  const [modStart, modEnd] = moduleSliceAround(oldFile, match.index);
  const moduleText = oldFile.slice(modStart, modEnd);
  const calleeSrc = /\.(?:createElement|jsxs?)$/.test(createElementFn)
    ? `${escapeIdent(
        createElementFn.replace(/\.(?:createElement|jsxs?)$/, '')
      )}\\.(?:createElement|jsxs?)`
    : escapeIdent(createElementFn);

  // A call site inside the module is still not enough on its own: the name it
  // uses may be a `let` belonging to that one function. On 2.1.246 the first
  // `o(NAME,{color:...})` in module 1036 is the tool-error label, whose `sR` is
  // function-local -- emitting it a few hundred bytes earlier produced an image
  // that died with "sR is not defined". So candidates are filtered down to what
  // is in scope for the WHOLE chunk, and the first surviving one wins.
  const inScope = moduleScopeBindings(moduleText);
  const pickLocal = (re: RegExp): string | undefined => {
    for (const hit of moduleText.matchAll(re)) {
      if (inScope.has(hit[1])) return hit[1];
    }
    return undefined;
  };
  const localBox = pickLocal(
    new RegExp(`${calleeSrc}\\(([$\\w]+),\\{flexDirection:"column"`, 'g')
  );
  const localText = pickLocal(
    new RegExp(`${calleeSrc}\\(([$\\w]+),\\{(?:dimColor|color|wrap):`, 'g')
  );
  const chalkCandidate = findChalkVar(moduleText);
  const localChalk =
    chalkCandidate && inScope.has(chalkCandidate) ? chalkCandidate : undefined;

  // On a split bundle a bundle-wide fallback is not a weaker answer, it is a
  // wrong one: it names a binding from another chunk. Refuse instead.
  const isSplitBundle = /\n\/\*__tweakcc_module_boundary_\d+__\*\/\n/.test(
    oldFile
  );
  if (isSplitBundle && (!localBox || !localText || !localChalk)) {
    console.error(
      'patch: userMessageDisplay: could not resolve Box/Text/chalk inside the ' +
        'module that owns the match; refusing to emit a name from another chunk'
    );
    return null;
  }

  const resolvedTextComponent = localText ?? textComponent;
  const resolvedChalkVar = localChalk ?? chalkVar;
  const resolvedBoxComponent = localBox ?? localBoxComponent ?? boxComponent;
  if (!resolvedBoxComponent) {
    console.error('patch: userMessageDisplay: failed to find Box component');
    return null;
  }
  if (!resolvedTextComponent) {
    console.error('patch: userMessageDisplay: failed to find Text component');
    return null;
  }
  if (!resolvedChalkVar) {
    console.error('patch: userMessageDisplay: failed to find chalk variable');
    return null;
  }

  // Build box attributes (border and padding)
  const boxAttrs: string[] = [];
  const isCustomBorder = config.borderStyle.startsWith('topBottom');

  if (config.borderStyle !== 'none') {
    if (isCustomBorder) {
      // Custom topBottom borders - only show top and bottom
      let customBorder = '';

      if (config.borderStyle === 'topBottomSingle') {
        customBorder =
          '{top:"─",bottom:"─",left:" ",right:" ",topLeft:" ",topRight:" ",bottomLeft:" ",bottomRight:" "}';
      } else if (config.borderStyle === 'topBottomDouble') {
        customBorder =
          '{top:"═",bottom:"═",left:" ",right:" ",topLeft:" ",topRight:" ",bottomLeft:" ",bottomRight:" "}';
      } else if (config.borderStyle === 'topBottomBold') {
        customBorder =
          '{top:"━",bottom:"━",left:" ",right:" ",topLeft:" ",topRight:" ",bottomLeft:" ",bottomRight:" "}';
      }

      boxAttrs.push(`borderStyle:${customBorder}`);
    } else {
      // Standard Ink border styles
      boxAttrs.push(`borderStyle:"${config.borderStyle}"`);
    }

    const borderMatch = config.borderColor.match(/\d+/g);
    if (borderMatch) {
      boxAttrs.push(`borderColor:"rgb(${borderMatch.join(',')})"`);
    }
  }

  if (config.paddingX > 0) {
    boxAttrs.push(`paddingX:${config.paddingX}`);
  }
  if (config.paddingY > 0) {
    boxAttrs.push(`paddingY:${config.paddingY}`);
  }
  if (config.fitBoxToContent) {
    boxAttrs.push(`alignSelf:"flex-start"`);
  }

  const boxAttrsObjStr =
    boxAttrs.length > 0 ? `{${boxAttrs.join(',')}}` : 'null';

  // Build chalk chain for custom colors and styling
  let chalkChain = resolvedChalkVar;

  // Only add color methods for custom (non-default, non-null) colors
  if (config.foregroundColor !== 'default') {
    const fgMatch = config.foregroundColor.match(/\d+/g);
    if (fgMatch) {
      chalkChain += `.rgb(${fgMatch.join(',')})`;
    }
  }

  if (config.backgroundColor !== 'default' && config.backgroundColor !== null) {
    const bgMatch = config.backgroundColor.match(/\d+/g);
    if (bgMatch) {
      chalkChain += `.bgRgb(${bgMatch.join(',')})`;
    }
  }

  // Apply styling
  if (config.styling.includes('bold')) chalkChain += '.bold';
  if (config.styling.includes('italic')) chalkChain += '.italic';
  if (config.styling.includes('underline')) chalkChain += '.underline';
  if (config.styling.includes('strikethrough')) chalkChain += '.strikethrough';
  if (config.styling.includes('inverse')) chalkChain += '.inverse';

  // Replace {} in format string with the message variable
  const formattedMessage =
    '`' + config.format.replace(/\{\}/g, '${' + messageVar + '}') + '`';

  const chalkFormattedString = `${chalkChain}(${formattedMessage})`;

  // Build replacement: Box(border/padding) wrapping Text(chalk-formatted message).
  const replacementPrefix = memoizedChildMatch ? `${match[2]}=` : '';

  // CC's JSX automatic runtime (jsx/jsxs) passes children as a prop, and the
  // captured call var has no `.createElement`, so emit jsx-convention calls
  // there. Older bundles use the classic createElement(type, props, ...children).
  // The automatic runtime takes (type, props) and reads children OUT of props;
  // classic createElement takes (type, props, ...children). Testing for a
  // `.jsx`/`.jsxs` suffix asked the wrong question: from 2.1.242 a chunk imports
  // the runtime under a plain name, so the callee is a bare `o` -- a jsx runtime
  // that this test called classic, which then emitted `o(Box,null,child)` and
  // dropped the child while passing null as the props object. Only an explicit
  // `.createElement` callee is the classic convention.
  const isJsxRuntime = !/\.createElement$/.test(createElementFn);
  let elementTree: string;
  if (isJsxRuntime) {
    const textEl = `${createElementFn}(${resolvedTextComponent},{children:${chalkFormattedString}})`;
    const boxProps =
      boxAttrsObjStr === 'null'
        ? `{children:${textEl}}`
        : `${boxAttrsObjStr.slice(0, -1)},children:${textEl}}`;
    elementTree = `${createElementFn}(${resolvedBoxComponent},${boxProps})`;
  } else {
    elementTree = `${createElementFn}(${resolvedBoxComponent},${boxAttrsObjStr},${createElementFn}(${resolvedTextComponent},null,${chalkFormattedString}))`;
  }

  const replacement = match[1] + `${replacementPrefix}${elementTree}`;

  const startIndex = match.index;
  const endIndex = startIndex + match[0].length;

  const newFile =
    oldFile.slice(0, startIndex) + replacement + oldFile.slice(endIndex);

  showDiff(oldFile, newFile, replacement, startIndex, endIndex);

  return newFile;
};
