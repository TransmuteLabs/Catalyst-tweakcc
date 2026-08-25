import { describe, expect, it } from 'vitest';

import { writePatchesAppliedIndication } from './patchesAppliedIndication';
import { clearReactVarCache } from './helpers';

const BOUNDARY = (n: number) => `\n/*__tweakcc_module_boundary_${n}__*/\n`;

// The startup header as 2.1.246 compiles it: the JSX runtime is imported under a
// plain name (`l`), so the call carries no namespace, and Text/Box are ordinary
// module-scoped imports.
const header = (factory: string, text: string, box: string) =>
  `let QS;QS=${factory}(${text},{bold:!0,children:"Claude Code"});` +
  `let da;da=${factory}(${text},{children:[QS," ",${factory}(${text},{dimColor:!0,children:["v",Xm]})]});` +
  `let ha;ha=${factory}(${box},{flexDirection:"column",children:[da,fa,ga]});`;

// The fleet view carries the same version element and the same bold "Claude
// Code", but builds its row inline instead of assigning it, and imports Text
// under a different name. Anchoring on shape alone picks this one first.
const lookalike = (factory: string, text: string) =>
  `let ed;ed=!ti&&${factory}(Be,{children:[${factory}(${text},{wrap:"truncate",children:[` +
  `${factory}(${text},{bold:!0,children:"Claude Code"})," ",` +
  `${factory}(${text},{dimColor:!0,children:["v",Xs]})]})]});`;

const versionOutput = '`${A}.VERSION} (Claude Code)`;';

const chalkAndText =
  'var CH=Q(require("chalk"),1);CH.default.hex("#ff0000");' +
  'function TX(){}TX.displayName="Text";';

describe('writePatchesAppliedIndication', () => {
  it('applies to a code-split bundle whose JSX runtime has no namespace', () => {
    clearReactVarCache();
    const file =
      versionOutput +
      chalkAndText +
      BOUNDARY(1) +
      lookalike('c', 'a') +
      BOUNDARY(2) +
      header('l', 'c', 'p');

    const out = writePatchesAppliedIndication(
      file,
      '9.9.9',
      ['themes: Dark'],
      true,
      true
    );

    expect(out).not.toBeNull();
    const s = out as string;
    // PATCH 1 survives even though there is no React namespace anywhere
    expect(s).toContain('(Claude Code)\\n9.9.9 (tweakcc)');
    // the version line lands in the real header, next to `["v",Xm]`, not in the
    // look-alike next to `["v",Xs]`
    expect(s).toContain(
      '["v",Xm]})," ",l(c,{color:"#FF8400",bold:true,children:"+ tweakcc v9.9.9"})'
    );
    expect(s).not.toContain('["v",Xs]})," ",');
    // the list is appended as the column's last child, using that module's names
    expect(s).toContain(
      'l(p,{flexDirection:"column",children:[da,fa,ga,l(p,{flexDirection:"column",children:['
    );
    expect(s).toContain('✓ tweakcc patches are applied');
    expect(s).toContain('  * themes: Dark');
  });

  it('emits nothing from the wrong module when the look-alike is the only header', () => {
    clearReactVarCache();
    const file =
      versionOutput + chalkAndText + BOUNDARY(1) + lookalike('c', 'a');

    const out = writePatchesAppliedIndication(file, '9.9.9', [], true, true);

    // PATCH 1 still applies; nothing is injected into a module whose row and
    // column could not be resolved
    expect(out).not.toBeNull();
    const s = out as string;
    expect(s).toContain('(Claude Code)\\n9.9.9 (tweakcc)');
    expect(s).not.toContain('+ tweakcc v9.9.9');
    expect(s).not.toContain('✓ tweakcc patches are applied');
  });

  it('refuses when two modules both resolve a full header chain', () => {
    clearReactVarCache();
    const file =
      versionOutput +
      chalkAndText +
      BOUNDARY(1) +
      header('l', 'c', 'p') +
      BOUNDARY(2) +
      header('d', 'o', 'b').replace('Xm', 'Xn');

    const out = writePatchesAppliedIndication(file, '9.9.9', [], true, true);

    expect(out).not.toBeNull();
    const s = out as string;
    expect(s).toContain('(Claude Code)\\n9.9.9 (tweakcc)');
    expect(s).not.toContain('+ tweakcc v9.9.9');
  });

  it('still uses the namespaced runtime when the bundle has one', () => {
    clearReactVarCache();
    const file =
      versionOutput + chalkAndText + BOUNDARY(1) + header('X.jsxs', 'TT', 'BB');

    const out = writePatchesAppliedIndication(file, '9.9.9', [], true, true);

    expect(out).not.toBeNull();
    expect(out as string).toContain(
      'X.jsx(TT,{color:"#FF8400",bold:true,children:"+ tweakcc v9.9.9"})'
    );
  });
});
