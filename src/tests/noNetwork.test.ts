import { describe, expect, it } from 'vitest';

import { NETWORK_BLOCKED_MESSAGE } from './setup/noNetwork';

// The pin on the trap itself: a trap that quietly became a no-op would let the
// suite drift back onto the network, and the only symptom there is a timeout
// on someone else's machine.
describe('the unit suite cannot reach the network', () => {
  it('refuses a string target by name instead of hanging', async () => {
    await expect(
      fetch('https://raw.githubusercontent.com/anything')
    ).rejects.toThrow(NETWORK_BLOCKED_MESSAGE);
  });

  it('names the URL target it refused', async () => {
    await expect(fetch(new URL('https://example.com/x'))).rejects.toThrow(
      'https://example.com/x'
    );
  });
});
