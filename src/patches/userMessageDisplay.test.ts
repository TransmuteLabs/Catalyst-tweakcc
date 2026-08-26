import { describe, expect, it } from 'vitest';

import { writeUserMessageDisplay } from './userMessageDisplay';
import { UserMessageDisplayConfig } from '../types';

const CONFIG: UserMessageDisplayConfig = {
  format: '> {} ',
  styling: [],
  foregroundColor: 'default',
  backgroundColor: 'default',
  borderStyle: 'none',
  borderColor: '',
  paddingX: 0,
  paddingY: 0,
  fitBoxToContent: false,
};

const BOUNDARY = (n: number) => `\n/*__tweakcc_module_boundary_${n}__*/\n`;

// A foreign chunk that DEFINES the shapes the bundle-wide resolvers look for.
// Its names are deliberately the ones that broke 2.1.246 in the field: a
// resolver that scans the joined bundle picks these up, and they mean nothing
// in the chunk the edit lands in.
const FOREIGN_CHUNK =
  'function l0({color:e,backgroundColor:t,dimColor:n=!1,bold:r=!1}){return null}' +
  'function bx0({children:e,flexWrap:t}){return q.default.createElement("ink-box",null,e)}' +
  'var zz9=r0;zz9.cyan("a");zz9.bold("b");zz9.rgb(1,2,3)("c");zz9.gray("d");';

// The chunk that actually renders a user message on 2.1.242+: the JSX runtime
// arrives as a plain binding `o`, Box is `a`, Text is `t`, chalk is `ch`.
const OWNING_CHUNK =
  'function draw(){' +
  'if(!wE)return(err(Error("No content found in user prompt message")),null);' +
  'const xm=1,km=void 0,_m=0,Pm=void 0;' +
  'let Zy;if(Mm[14]!==wE||Mm[15]!==Pm||Mm[16]!==bm)' +
  'Zy=o(Ff,{text:wE,useBriefLayout:bm,timestamp:Pm}),Mm[17]=Zy;else Zy=Mm[17];' +
  'let zz=o(a,{flexDirection:"column",marginTop:xm,children:Zy});' +
  'let hint=o(t,{dimColor:!0,children:"hint"});' +
  'ch.bold("x");ch.dim("y");ch.rgb(1,2,3)("z");' +
  'return zz}';

const SPLIT_BUNDLE = FOREIGN_CHUNK + BOUNDARY(1) + OWNING_CHUNK;

describe('writeUserMessageDisplay on a code-split bundle', () => {
  it('emits only names bound in the module that owns the match', () => {
    const out = writeUserMessageDisplay(SPLIT_BUNDLE, CONFIG);
    expect(out).not.toBeNull();
    const injected = out!.slice(out!.indexOf('Zy=o('));
    // The exact field failure: `l0` came from the foreign chunk and does not
    // exist here, so the product died with "l0 is not defined".
    expect(injected).not.toContain('l0');
    expect(injected).not.toContain('bx0');
    expect(injected).not.toContain('zz9');
    expect(injected).toContain('o(a,');
    expect(injected).toContain('o(t,');
    expect(injected).toContain('ch(');
  });

  it('uses the automatic-runtime convention for a bare callee', () => {
    const out = writeUserMessageDisplay(SPLIT_BUNDLE, CONFIG)!;
    // `o` IS the jsx runtime: it takes (type, props) and reads children out of
    // props. The classic 3-argument form would pass null as props and silently
    // drop the message text.
    expect(out).toContain('children:o(t,{children:ch(');
    expect(out).not.toContain('o(t,null,');
    expect(out).not.toContain(',null,o(');
  });

  it('refuses rather than emitting a name from another chunk', () => {
    // Same owning module with no local Box/Text/chalk call sites at all.
    const bare =
      FOREIGN_CHUNK +
      BOUNDARY(1) +
      'function draw(){' +
      'if(!wE)return(err(Error("No content found in user prompt message")),null);' +
      'let Zy;Zy=o(Ff,{text:wE,useBriefLayout:bm,timestamp:Pm});return Zy}';
    expect(writeUserMessageDisplay(bare, CONFIG)).toBeNull();
  });
});

describe('writeUserMessageDisplay on a single-module bundle', () => {
  it('keeps the classic createElement convention', () => {
    const single =
      'function bx0({children:e,flexWrap:t}){return q.default.createElement("ink-box",null,e)}' +
      'function Tx0({color:e,backgroundColor:t,dimColor:n=!1,bold:r=!1}){return null}' +
      'var ch=r0;ch.cyan("a");ch.bold("b");ch.rgb(1,2,3)("c");' +
      'function draw(){' +
      'if(!B)return(b1(new Error("No content found in user prompt message")),null);' +
      'return ec.default.createElement(bx0,{flexDirection:"column",width:Q-4},' +
      'ec.default.createElement(Tx0,{text:B}))}';
    const out = writeUserMessageDisplay(single, CONFIG);
    expect(out).not.toBeNull();
    expect(out!).toContain('.createElement(');
    // Classic form: children are positional, never a `children:` prop.
    expect(out!).not.toContain('{children:ch(');
  });
});
