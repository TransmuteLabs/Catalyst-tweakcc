import { describe, expect, it } from 'vitest';

import { writeHideStartupBanner } from './hideStartupBanner';

// The startup card is identified by two things in one function body: the
// Apple_Terminal theme branch and the welcome text. Everything else about the
// component -- how it memoizes, how it reads the terminal size -- drifts.
const banner = (name: string, prelude = '') =>
  `function ${name}(){${prelude}if(E.terminal==="Apple_Terminal"){return l(oo,{welcomeMessage:"Welcome to Claude Code"})}return null}`;

describe('writeHideStartupBanner', () => {
  it('disables the banner when the theme branch follows an early block', () => {
    // CC >=2.1.242: the body opens with a rows check, so closing braces sit
    // between the function head and the theme branch. A lookahead that could
    // not cross `}` stopped matching here and the patch went dead.
    const input = banner(
      'bo',
      'let e=lo(39),[j]=L();if(so||yo<eo){return d(o,{children:"x"})}'
    );
    const result = writeHideStartupBanner(input);
    expect(result).not.toBeNull();
    expect(result).toContain('function bo(){return null;');
  });

  it('refuses rather than guessing when two components look like the banner', () => {
    const input = banner('one') + banner('two');
    expect(writeHideStartupBanner(input)).toBeNull();
  });

  it('returns null when no banner is present', () => {
    expect(writeHideStartupBanner('function f(){return null}')).toBeNull();
  });
});
