import { describe, expect, it } from 'vitest';

import { writeOpusplan1m } from './opusplan1m';

describe('writeOpusplan1m', () => {
  // 2.1.233 turned the model-list call into a link of an else-if chain and gave
  // the wrapper a second argument. Both are reproduced here verbatim.
  it('handles the 2.1.233 shape: else-if chain and a wrapper with two arguments', () => {
    const file = [
      'if((s==="opusplan"||s==="opusplan[1m]")&&B==="plan"&&!C)return D();',
      'var M=["sonnet","opus","haiku","sonnet[1m]","opusplan"];',
      'if(s==="opusplan")return"Opus in plan mode, else Sonnet";',
      'if(s==="opusplan")return"Opus Plan";',
      'function f(r,t){if(s===null||r.some((c)=>c.value===s))return WAt(r,t);',
      'else if(s==="opusplan")return WAt([...r,Fcb()],t);',
      'else if(u(s)){return WAt(r,t)}',
      'else return WAt(r,t)}',
    ].join('');

    const result = writeOpusplan1m(file);

    expect(result).not.toBeNull();
    const out = result as string;
    // the new branch keeps the wrapper AND its second argument
    expect(out).toContain(
      'else if(s==="opusplan[1m]")return WAt([...r,{value:"opusplan[1m]"'
    );
    expect(out).toContain('}],t);');
    // it joins the chain instead of orphaning the branches that follow
    expect(out).not.toContain(');if(s==="opusplan[1m]")');
    expect(() => new Function(out)).not.toThrow();
  });

  it('does not fail when mode switching already supports opusplan[1m]', () => {
    const file = [
      'if((A==="opusplan"||A==="opusplan[1m]")&&B==="plan"&&!C)return D();',
      '["sonnet","opus","haiku","sonnet[1m]","opusplan"]',
      'if(A==="opusplan")return"Opus in plan mode, else Sonnet";',
      'if(A==="opusplan")return"Opus Plan";',
      'if(A==="opusplan")return[...B,C()];',
      'if(A===null||B.some((C)=>C.value===A))return B;',
    ].join('');

    const result = writeOpusplan1m(file);

    expect(result).not.toBeNull();
    expect(result).toContain('"opusplan[1m]"');
  });

  // 2.1.251 removed the inline plan-mode test entirely: the alias is resolved by
  // a family mapper the chooser calls, and the 1M flavour is picked separately.
  // The lines below are verbatim slices of the 2.1.251 bundle.
  const v251 = [
    'function qde(e){if(e==="opusplan"||e==="opusplan[1m]")return"opus";if(e==="haiku")return"sonnet";return null}',
    'function m3t(e){let t=qde(e);if(t===null)return null;let r=t==="opus"&&(e==="opusplan[1m]"||YS()),o=t==="opus"?r?Xe(bl()):bl():uf();return{model:o,clamp:"none"}}',
    'function hp(e){let{permissionMode:t,mainLoopModel:r,exceeds200kTokens:o=!1}=e;if(t!=="plan")return r;let u=lf(),d=qde(u);if(d===null||d==="opus"&&o)return r;let _=m3t(u);if(_===null)return r;return _.model}',
    'var M=["sonnet","opus","haiku","sonnet[1m]","opusplan"];',
    'if(s==="opusplan")return"Opus in plan mode, else Sonnet";',
    'if(s==="opusplan")return"Opus Plan";',
    'function f(r,t){if(s===null||r.some((c)=>c.value===s))return WAt(r,t);',
    'else if(s==="opusplan")return WAt([...r,Fcb()],t);',
    'else return WAt(r,t)}',
  ].join('');

  it('handles the 2.1.251 shape: the alias mapper the plan chooser calls', () => {
    const result = writeOpusplan1m(v251);

    expect(result).not.toBeNull();
    const out = result as string;
    // the chooser is recognised as already native and survives untouched
    expect(out).toContain(
      'function hp(e){let{permissionMode:t,mainLoopModel:r,exceeds200kTokens:o=!1}=e;if(t!=="plan")return r;let u=lf(),d=qde(u);'
    );
    // and the five patches that are still needed did land
    expect(out).toContain('"sonnet[1m]","opusplan","opusplan[1m]"');
    expect(out).toContain('if(s==="opusplan[1m]")return"Opus Plan 1M";');
    expect(out).toContain(
      'else if(s==="opusplan[1m]")return WAt([...r,{value:"opusplan[1m]"'
    );
    expect(() => new Function(out)).not.toThrow();
  });

  // The two halves the mapper alone cannot prove. Each is removed on its own,
  // from the same fixture, and each has to redden with its own reason: a mapper
  // that nothing calls, or a build with no 1M variant left to select, must not
  // read as "already native".
  it('refuses the 2.1.251 shape when the plan chooser stops calling the mapper', () => {
    const broken = v251.replace('let u=lf(),d=qde(u);', 'let u=lf(),d=zzz(u);');
    expect(broken).not.toBe(v251);

    expect(writeOpusplan1m(broken)).toBeNull();
  });

  it('refuses the 2.1.251 shape when nothing selects the 1M plan model', () => {
    const broken = v251.replace('(e==="opusplan[1m]"||YS())', '(YS())');
    expect(broken).not.toBe(v251);

    expect(writeOpusplan1m(broken)).toBeNull();
  });
});
