import { describe, it, expect } from 'vitest';

import { writeModelCustomizations } from './modelSelector';

describe('writeModelCustomizations', () => {
  // CC 2.1.199 emits the built-in "Custom model" push preceded by `{` (inside an
  // `if(...){...}` block), not by a space:
  //   ...if(c.startsWith("anthropic.")){t.push({value:c,label:c,description:"Custom model"})...
  const bundle199 =
    'function F(e){let t=VTp(e),n=1;' +
    'if(c.startsWith("anthropic.")){t.push({value:c,label:c,description:"Custom model"});continue}' +
    'return t}';

  it('injects the custom model list on CC 2.1.199 (push preceded by "{")', () => {
    const out = writeModelCustomizations(bundle199);
    expect(out).not.toBeNull();
    // The extra models are pushed onto the same list var `t`...
    expect(out).toContain('t.push({"value":"claude-opus-4-6"');
    // ...right after the `t` declaration, before the original push site.
    const injectAt = out!.indexOf('t.push({"value":"claude-opus-4-6"');
    const origPushAt = out!.indexOf('if(c.startsWith("anthropic.")');
    expect(injectAt).toBeGreaterThan(-1);
    expect(injectAt).toBeLessThan(origPushAt);
  });

  it('still matches the legacy space-prefixed push site', () => {
    const legacy =
      'function F(e){let t=[]; t.push({value:x,label:y,description:"Custom model"});return t}';
    const out = writeModelCustomizations(legacy);
    expect(out).not.toBeNull();
    expect(out).toContain('t.push({"value":"claude-opus-4-6"');
  });

  it('fails closed on a member-expression push (does not capture a property as the list var)', () => {
    const memberExpr =
      'function F(e){let t=[];return e.t.push({value:c,label:c,description:"Custom model"})}';
    const out = writeModelCustomizations(memberExpr);
    expect(out).toBeNull();
  });

  // CC 2.1.261 made `label` an expression and `description` a ternary whose
  // second arm is a template literal. Verbatim from the image; the locator used
  // to pin both values whole and missed the site it was standing on.
  const bundle261 =
    'function F(e,n){let t=[...e];' +
    'if(n)for(let N of n){let F2=N.trim();if(t.some((re)=>re.value===F2))continue;' +
    'if(F2.startsWith("anthropic.")){let re=dUe(F2);' +
    't.push({value:F2,label:re??F2,description:re===void 0?"Custom model":`Custom model (${F2})`});' +
    'continue}}return t}';

  it('injects on CC 2.1.261, where label and description are expressions', () => {
    const out = writeModelCustomizations(bundle261);
    expect(out).not.toBeNull();
    expect(out).toContain('t.push({"value":"claude-opus-4-6"');
    // the original push site is left untouched -- we only insert by the declaration
    expect(out).toContain('description:re===void 0?"Custom model"');
    const injectAt = out!.indexOf('t.push({"value":"claude-opus-4-6"');
    const origPushAt = out!.indexOf('if(F2.startsWith("anthropic.")');
    expect(injectAt).toBeGreaterThan(-1);
    expect(injectAt).toBeLessThan(origPushAt);
  });

  it('does not mistake the sibling `push(f(x)??{...})` site for the insertion point', () => {
    // Same "Custom model" literal, but the push argument is a `??` expression,
    // not an object literal: this site is not where the list is built.
    const sibling =
      'function F(e){let t=[...e];return t.push(Die(C)??{value:C,label:C,description:"Custom model"}),t}';
    expect(writeModelCustomizations(sibling)).toBeNull();
  });
});
