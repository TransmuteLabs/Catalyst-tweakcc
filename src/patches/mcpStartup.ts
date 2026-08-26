// Please see the note about writing patches in ./index
//
// MCP Startup Optimization Patch
// Based on: https://cuipengfei.is-a.dev/blog/2026/01/24/claude-code-mcp-startup-optimization/
//
// This patch modifies Claude Code's MCP connection behavior:
// - MCP_CONNECTION_NONBLOCKING: Don't block startup waiting for all MCPs to connect
// - MCP_SERVER_CONNECTION_BATCH_SIZE: Connect more servers in parallel (default: 3)

import { showDiff, LocationResult } from './index';

/**
 * Outcome of locating the non-blocking flag.
 *
 * `absent` and `refuse` must not be conflated: a build that dropped the env var
 * is a legitimate no-op, while a build whose flag polarity we cannot prove is a
 * stop. Collapsing both into "no location" is how this patch shipped the wrong
 * constant -- silently, and for as long as it has existed.
 */
type NonBlockingSite =
  | { kind: 'ok'; startIndex: number; endIndex: number }
  | { kind: 'absent' }
  | { kind: 'refuse' };

/**
 * Find the MCP non-blocking check, and prove which constant forces non-blocking.
 *
 * The expression is `<flag>=!<isDisabled>(process.env.MCP_CONNECTION_NONBLOCKING)`.
 * Writing a constant here is only safe once the POLARITY of `<flag>` is known,
 * and this patch had it backwards: it wrote `false`, which selects the BLOCKING
 * branch, under a description promising a faster startup. The product reads the
 * flag as "run non-blocking" -- the consumer is
 * `async function b(t,...){if(t){...running fully async (nonblocking)...;return}}`
 * -- so the constant that forces non-blocking is `true`.
 *
 * The polarity is re-derived from the payload on every run rather than trusted:
 * find the consumer whose FIRST parameter guards a branch containing the word
 * "nonblocking", and confirm the flag this expression assigns is passed to it. A
 * build that flips the meaning stops matching and the patch refuses, instead of
 * silently selecting the branch we did not want.
 */
const getNonBlockingCheckLocation = (oldFile: string): NonBlockingSite => {
  // <flag>=!VARNAME(process.env.MCP_CONNECTION_NONBLOCKING)
  // Names change between npm and native builds, so match any identifier.
  const pattern =
    /([$\w]+)=(![$\w]+\(process\.env\.MCP_CONNECTION_NONBLOCKING\))/;
  const match = oldFile.match(pattern);

  if (!match || match.index === undefined) {
    // CC >= 2.1.79 removed MCP_CONNECTION_NONBLOCKING — non-blocking is default.
    return { kind: 'absent' };
  }

  const flagVar = match[1];
  const expr = match[2];

  // The consumer: its first parameter, when truthy, takes the non-blocking path.
  // The guarded branch contains nested braces (arrow callbacks, template holes),
  // so the span is bounded by length rather than by "no braces".
  const consumer = oldFile.match(
    /(?:async )?function ([$\w]+)\(([$\w]+)(?:,[^)]*)?\)\{if\(\2\)\{[\s\S]{0,300}?nonblocking/
  );
  if (!consumer) {
    console.error(
      'patch: mcpStartup: could not find the consumer that names the non-blocking ' +
        'branch; refusing to write a constant whose polarity is unproven'
    );
    return { kind: 'refuse' };
  }
  const consumerFn = consumer[1];
  const passedToConsumer = new RegExp(
    `(?<![$\\w.])${consumerFn}\\(${flagVar}\\s*,`
  ).test(oldFile);
  if (!passedToConsumer) {
    console.error(
      `patch: mcpStartup: '${flagVar}' is not the argument of '${consumerFn}'; ` +
        'the flag no longer feeds the branch this patch reasons about, refusing'
    );
    return { kind: 'refuse' };
  }

  const exprStart = match.index + match[0].length - expr.length;
  return {
    kind: 'ok',
    startIndex: exprStart,
    endIndex: exprStart + expr.length,
  };
};

/**
 * Find the MCP batch size default value location.
 *
 * Pattern: parseInt(process.env.MCP_SERVER_CONNECTION_BATCH_SIZE||"",10)||3
 * We want to replace the "3" with a higher value.
 */
const getBatchSizeLocation = (oldFile: string): LocationResult | null => {
  // Match the full pattern and capture position of the default "3".
  // Old CC: parseInt(process.env.MCP_SERVER_CONNECTION_BATCH_SIZE||"",10)||3
  // CC ≥2.1.140: parseInt(process.env.MCP_SERVER_CONNECTION_BATCH_SIZE||"",10);return H>0?H:3
  const pattern =
    /MCP_SERVER_CONNECTION_BATCH_SIZE\|\|"",10\)(?:\|\||;return [$\w]+>0\?[$\w]+:)(\d+)/;
  const match = oldFile.match(pattern);

  if (!match || match.index === undefined) {
    console.error(
      'patch: mcpStartup: failed to find MCP_SERVER_CONNECTION_BATCH_SIZE default'
    );
    return null;
  }

  // Find the position of the default number (the captured group)
  const fullMatch = match[0];
  const defaultValue = match[1];
  const defaultValueOffset = fullMatch.lastIndexOf(defaultValue);

  const startIndex = match.index + defaultValueOffset;
  const endIndex = startIndex + defaultValue.length;

  return {
    startIndex,
    endIndex,
  };
};

/**
 * Apply non-blocking MCP startup by forcing the non-blocking flag to true.
 */
export const writeMcpNonBlocking = (oldFile: string): string | null => {
  const site = getNonBlockingCheckLocation(oldFile);
  if (site.kind === 'absent') {
    // Nothing to force: the gate this patch existed for is gone from the build.
    return oldFile;
  }
  if (site.kind === 'refuse') {
    return null;
  }

  // `true`, not `false`: the flag means "run non-blocking", and its polarity is
  // proven against the payload in getNonBlockingCheckLocation above.
  const newValue = 'true';
  const newFile =
    oldFile.slice(0, site.startIndex) + newValue + oldFile.slice(site.endIndex);

  showDiff(oldFile, newFile, newValue, site.startIndex, site.endIndex);
  return newFile;
};

/**
 * Apply MCP batch size optimization by replacing the default value.
 */
export const writeMcpBatchSize = (
  oldFile: string,
  batchSize: number
): string | null => {
  const location = getBatchSizeLocation(oldFile);
  if (!location) {
    return null;
  }

  const newValue = String(batchSize);
  const newFile =
    oldFile.slice(0, location.startIndex) +
    newValue +
    oldFile.slice(location.endIndex);

  showDiff(oldFile, newFile, newValue, location.startIndex, location.endIndex);
  return newFile;
};
