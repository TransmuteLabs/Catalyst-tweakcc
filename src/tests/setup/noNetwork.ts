// Setup file: evaluated in every worker before the test file's module graph.
//
// The unit suite must not reach the network. It did: config.test.ts drives
// startupCheck through syncSystemPrompts, whose snapshot download is a live
// fetch to raw.githubusercontent.com. The on-disk snapshot cache lives under
// the config home, and pinConfigHome.ts pins that home to a fresh temp
// directory per file -- so the cache is ALWAYS cold and the fetch ALWAYS
// fired. Wherever that host is slow or refused, the two startupCheck tests
// died on the 5 s timeout, i.e. the suite's own result depended on an external
// service.
//
// The trap turns that class from a timeout into a named failure at the call
// site. A test that genuinely needs a transport stubs fetch itself
// (vi.stubGlobal), which replaces the trap for that file; the real function is
// parked on a symbol so restoring it is an explicit act, never an accident.

const REAL_FETCH = Symbol.for('tweakcc.tests.realFetch');

export const NETWORK_BLOCKED_MESSAGE =
  'The unit suite does not reach the network: fetch() was called for';

const globals = globalThis as Record<symbol, unknown>;
if (!globals[REAL_FETCH]) {
  globals[REAL_FETCH] = globalThis.fetch;
}

const describeTarget = (input: Parameters<typeof fetch>[0]): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  throw new Error(
    `${NETWORK_BLOCKED_MESSAGE} ${describeTarget(input)}. ` +
      'Mock the module that downloads (see src/tests/setup/noNetwork.ts).'
  );
}) as typeof globalThis.fetch;
