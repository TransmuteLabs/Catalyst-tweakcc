import { describe, expect, it } from 'vitest';
import { writeMcpNonBlocking } from './mcpStartup';

// The real shape, reduced: the flag is assigned from the env check, handed to a
// consumer whose truthy first parameter takes the non-blocking path, and the
// alwaysLoad servers are passed a hard `!1` because they must finish loading.
const REAL = [
  'function D(e){if(e===void 0)return!1;if(typeof e==="boolean")return!e;',
  'let n=String(e).toLowerCase().trim();return["0","false","no","off"].includes(n)}',
  'function an(t){let{regularMcpConfigs:o}=t,e=!D(process.env.MCP_CONNECTION_NONBLOCKING);',
  'x(e);let c=e,d=h(o,(u)=>u.alwaysLoad===!0),p=h(o,(u)=>u.alwaysLoad!==!0);',
  'async function g(){let u=Promise.all([b(!1,()=>R(d),"alwaysLoad"),b(e,()=>R(p),"regular")])}}',
  'async function b(t,o,n){if(t){Promise.resolve(o()).catch(()=>{}),f(`[MCP] ${n} running fully async (nonblocking)`);return}',
  'let r=await Promise.race([o(),i()]);return r}',
].join('');

describe('writeMcpNonBlocking', () => {
  it('forces the flag TRUE, because the consumer reads truthy as non-blocking', () => {
    const out = writeMcpNonBlocking(REAL);
    expect(out).not.toBeNull();
    // the env expression is gone, the flag is forced on, and the assignment target survives
    expect(out).toContain('e=true;');
    expect(out).not.toContain('e=false');
    expect(out).not.toContain('MCP_CONNECTION_NONBLOCKING)');
  });

  it('leaves the alwaysLoad call blocking', () => {
    const out = writeMcpNonBlocking(REAL)!;
    expect(out).toContain('b(!1,()=>R(d),"alwaysLoad")');
  });

  it('refuses when no consumer names the non-blocking branch', () => {
    // polarity unprovable: the flag exists but nothing tells us which way it runs
    const noConsumer = REAL.replace('running fully async (nonblocking)', 'connected');
    expect(writeMcpNonBlocking(noConsumer)).toBeNull();
  });

  it('refuses when the flag no longer feeds that consumer', () => {
    // the consumer still exists, but a different variable is passed to it
    const rewired = REAL.replace('b(e,()=>R(p),"regular")', 'b(zz,()=>R(p),"regular")');
    expect(writeMcpNonBlocking(rewired)).toBeNull();
  });

  it('is a no-op on a build that dropped the env var entirely', () => {
    const modern = 'function an(t){let e=!0;x(e)}';
    expect(writeMcpNonBlocking(modern)).toBe(modern);
  });
});
