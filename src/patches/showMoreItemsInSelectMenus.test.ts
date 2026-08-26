import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { writeShowMoreItemsInSelectMenus } from './showMoreItemsInSelectMenus';

// Verbatim shapes lifted from the 2.1.246 payload.
//
// chunk 528 -- the select itself: the requested count is visibleOptionCount, and
// Di clamps it to however many items physically fit (Cp = rows per item).
const FIT_246 =
  'function Ai({options:t,visibleOptionCount:e=5,onChange:o}){return null}' +
  'const ms=Di(Tf,Sf?"compact-vertical":yt);' +
  'function Di(wp,za){let Ga=za===void 0?"compact":za,{rows:kp}=xn(hn()),' +
  'Cp=Ga==="expanded"?3:Ga==="compact"?1:2,' +
  'Mp=Math.max(1,Math.floor((kp-Rs)/Cp));return Math.min(wp,Mp)}' +
  'let Tf=na===void 0?5:na;';

// chunk 1318 -- the commands dialog computes the same rows-per-item conversion
// at the call site and hands the result to the select.
const COMMANDS_246 =
  'function x(ue){let{commands:H,maxHeight:fe,columns:he}=ue,' +
  'B=Math.max(1,he-10),xo=Math.max(1,Math.floor((fe-10)/2));' +
  'return o(K,{options:No,visibleOptionCount:xo,layout:"compact-vertical"})}';

// CC <= 2.1.150 -- a HEIGHT, arbitrarily halved. Lifting this one is correct.
const HALF_150 =
  'function h({visibleOptionCount:e=5}){return null}' +
  'let{rows:R,columns:C}=_7(),H=Math.floor(R/2);';

describe('writeShowMoreItemsInSelectMenus', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  it('raises the visibleOptionCount default, which is the whole feature', () => {
    const out = writeShowMoreItemsInSelectMenus(FIT_246, 25)!;
    expect(out).toContain('visibleOptionCount:e=25');
    expect(out).not.toContain('visibleOptionCount:e=5');
  });

  it('keeps the rows-per-item divisor: it is a unit, not a cap', () => {
    const out = writeShowMoreItemsInSelectMenus(FIT_246, 25)!;
    // The clamp that keeps the list inside the terminal must survive intact.
    expect(out).toContain('Math.max(1,Math.floor((kp-Rs)/Cp))');
    expect(out).not.toContain('Math.max(1,kp-Rs)');
    // Everything except the default is byte-identical.
    expect(out).toBe(FIT_246.replace('visibleOptionCount:e=5', 'visibleOptionCount:e=25'));
  });

  it('leaves the commands dialog fit formula alone', () => {
    const out = writeShowMoreItemsInSelectMenus(COMMANDS_246 + FIT_246, 25)!;
    expect(out).toContain('xo=Math.max(1,Math.floor((fe-10)/2))');
    expect(out).not.toContain('Math.max(1,fe-3)');
  });

  it('does not cry "pattern not found" on a build that computes the fit', () => {
    writeShowMoreItemsInSelectMenus(FIT_246, 25);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('still lifts the genuine half-terminal cap on CC <= 2.1.150', () => {
    const out = writeShowMoreItemsInSelectMenus(HALF_150, 25)!;
    expect(out).toContain('H=R');
    expect(out).not.toContain('Math.floor(R/2)');
  });

  it('reports an unrecognised build shape instead of guessing', () => {
    const unknown = 'function q({visibleOptionCount:e=5}){return null}let z=1;';
    const out = writeShowMoreItemsInSelectMenus(unknown, 25)!;
    expect(out).toContain('visibleOptionCount:e=25');
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('failed to find help menu height pattern')
    );
  });

  it('refuses when there is no select default to raise', () => {
    expect(writeShowMoreItemsInSelectMenus('let a=1;', 25)).toBeNull();
  });
});
