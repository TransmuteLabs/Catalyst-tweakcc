import { execFileSync } from 'node:child_process';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import chalk from 'chalk';

import { MODULE_BOUNDARY_SPLIT_RE } from '../nativeInstallation';

export class PatchedBundleParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchedBundleParseError';
  }
}

const MAX_MESSAGE = 2000;
const EXCERPT_RADIUS = 160;
const PARSE_CHECK_TIMEOUT_MS = 30_000;

/**
 * Reduces `node --check` stderr to the error summary and a bounded,
 * caret-centered source excerpt, dropping the temp-file path, V8 stack frames,
 * `node:internal` frames, and the Node version footer. Always returns a
 * non-empty message that never contains the temp path, and caps the length so a
 * corrupted long minified line cannot dump the whole line.
 */
export const sanitizeParseError = (stderr: string, tmpFile: string): string => {
  const lines = stderr.split('\n');

  const isNoise = (line: string): boolean =>
    line.includes(tmpFile) ||
    /^\s+at\s/.test(line) ||
    /^node:internal\//.test(line) ||
    /^Node\.js v/.test(line);

  const summary = lines.find(l => /^[A-Za-z]\w*Error\b.*:/.test(l))?.trim();

  const caretIdx = lines.findIndex(l => /^\s*\^+\s*$/.test(l));
  let excerpt = '';
  if (caretIdx > 0) {
    const source = lines[caretIdx - 1];
    const caret = lines[caretIdx];
    if (!isNoise(source)) {
      const col = caret.indexOf('^');
      if (source.length <= EXCERPT_RADIUS * 2) {
        excerpt = `${source}\n${caret}`;
      } else {
        const start = Math.max(0, col - EXCERPT_RADIUS);
        const end = Math.min(source.length, col + EXCERPT_RADIUS);
        const prefix = start > 0 ? '… ' : '';
        const suffix = end < source.length ? ' …' : '';
        const newCaretCol = prefix.length + (col - start);
        excerpt = `${prefix}${source.slice(start, end)}${suffix}\n${' '.repeat(newCaretCol)}^`;
      }
    }
  }

  let message = [excerpt, summary].filter(Boolean).join('\n\n').trim();

  if (message.length === 0) {
    message = lines
      .filter(l => !isNoise(l))
      .join('\n')
      .split(tmpFile)
      .join('<bundle>')
      .trim();
  }

  if (message.length === 0) {
    message =
      'The bundle failed to parse (node --check produced no diagnostic).';
  }

  return message.length > MAX_MESSAGE
    ? `${message.slice(0, MAX_MESSAGE)} …`
    : message;
};

/**
 * Distinguishes a genuine `node --check` parse failure (the process ran and
 * exited with a non-zero status) from an operational failure (timeout, signal
 * kill, or spawn failure), which leave `status` null.
 */
export const isParseFailureExit = (err: unknown): boolean =>
  err != null && typeof (err as { status?: unknown }).status === 'number';

/**
 * Parses one unit with `node --check`, in a temp file whose extension pins the
 * parse goal. A real parser is used rather than `new Function` /
 * `vm.compileFunction`, which impose a bare function-body context that diverges
 * from module parsing. `node --check` writes its diagnostic to stderr and then
 * exits, which truncates a piped stderr on long lines, so stderr is captured to
 * a file. The check is bounded by a timeout. Only a genuine non-zero exit is
 * treated as a parse failure; a timeout, signal, spawn failure, or an unwritable
 * temp file warns and skips the check, so an operational problem never blocks an
 * otherwise-valid apply.
 */
const runCheck = (
  content: string,
  extension: string,
  label: string
): string | null => {
  let dir: string;
  try {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'tweakcc-parse-'));
  } catch (err) {
    console.warn(
      chalk.yellow(
        `Warning: could not create a temp file to verify the patched bundle (${String(err)}); skipping the parse check.`
      )
    );
    return null;
  }

  const tmpFile = path.join(dir, `bundle.${extension}`);
  const errFile = path.join(dir, 'stderr.txt');
  try {
    try {
      fsSync.writeFileSync(tmpFile, content, 'utf8');
    } catch (err) {
      console.warn(
        chalk.yellow(
          `Warning: could not write the patched bundle for verification (${String(err)}); skipping the parse check.`
        )
      );
      return null;
    }

    let errFd: number;
    try {
      errFd = fsSync.openSync(errFile, 'w');
    } catch (err) {
      console.warn(
        chalk.yellow(
          `Warning: could not open a temp file to verify the patched bundle (${String(err)}); skipping the parse check.`
        )
      );
      return null;
    }
    let parseFailed = false;
    let operationalFailure: string | null = null;
    try {
      execFileSync(process.execPath, ['--check', tmpFile], {
        stdio: ['ignore', 'ignore', errFd],
        timeout: PARSE_CHECK_TIMEOUT_MS,
      });
    } catch (err) {
      if (isParseFailureExit(err)) {
        parseFailed = true;
      } else {
        operationalFailure = String(err);
      }
    } finally {
      fsSync.closeSync(errFd);
    }

    if (operationalFailure !== null) {
      console.warn(
        chalk.yellow(
          `Warning: the parse check could not run to completion (${operationalFailure}); skipping it.`
        )
      );
      return null;
    }

    if (parseFailed) {
      let stderr = '';
      try {
        stderr = fsSync.readFileSync(errFile, 'utf8');
      } catch {
        // The sanitizer synthesizes a message when stderr is unavailable.
      }
      const detail = sanitizeParseError(stderr, tmpFile);
      return label ? `${label}\n\n${detail}` : detail;
    }
    return null;
  } finally {
    try {
      fsSync.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of the temp directory.
    }
  }
};

/**
 * Verifies that patching did not break the bundle's syntax.
 *
 * Which unit is parsed depends on the shape of the bundle, and getting that
 * wrong is not a false alarm -- it discards every customization.
 *
 * Up to 2.1.241 the product is one CommonJS module (`@bun-cjs`), and the whole
 * text is checked as `.cjs`. From 2.1.242 it is ~1400 ES modules that the
 * extractor joins with a marker between them. That text is not a program in any
 * goal: as CommonJS the first `export{...}` is a syntax error, and as one module
 * the modules' top-level declarations collide. A split bundle is therefore
 * checked one module at a time, as `.mjs`.
 *
 * The check is DIFFERENTIAL, and that is not caution -- `node --check` runs on
 * whatever Node is hosting tweakcc, which is not the engine the product was
 * built for. 2.1.246's largest module contains `using` declarations, which Bun
 * accepts and V8 in Node 22 does not, so that module fails to parse before any
 * patch touches it. Reporting the absolute verdict blamed four patches in turn
 * for the product's own syntax. A module is only reported when the original
 * parsed and the patched one does not; when the original does not parse there is
 * no oracle, and the module is skipped with a note rather than judged.
 *
 * Only modules the patches actually changed are checked, which is both what the
 * gate is for and what keeps it to a handful of subprocesses instead of ~1400.
 * Without the original text to compare against, every module is checked and the
 * verdict is absolute -- there is nothing to compare with.
 */
/**
 * Said once per module per process: the per-patch check calls the gate after
 * every patch, and the largest module is touched by many of them.
 */
const unjudgeable = new Set<number>();
const warnUnjudgeableModule = (position: number): void => {
  if (unjudgeable.has(position)) return;
  unjudgeable.add(position);
  console.warn(
    chalk.yellow(
      `Warning: bundle module ${position} does not parse with this Node either ` +
        'before patching, so patches to it cannot be syntax-checked here. The ' +
        'product is built for a newer engine than the one running tweakcc.'
    )
  );
};

export const assertPatchedBundleParses = (
  content: string,
  originalContent?: string
): void => {
  const failure = findParseFailure(content, originalContent);
  if (failure !== null) throw new PatchedBundleParseError(failure);
};

/**
 * The same check, reporting instead of throwing. `applyPatchImplementations`
 * uses it after each patch so that a patch which emits broken code is rolled
 * back and reported by name, rather than reaching the final gate where the only
 * available remedy is to discard every other patch with it.
 */
export const findParseFailure = (
  content: string,
  originalContent?: string
): string | null => {
  const splitter = new RegExp(MODULE_BOUNDARY_SPLIT_RE.source, 'g');
  // With a capturing group, `split` interleaves the module ordinals:
  // [text, ord, text, ord, text, ...].
  const parts = content.split(splitter);

  if (parts.length === 1) {
    const failure = runCheck(content, 'cjs', '');
    if (failure === null) return null;
    if (
      originalContent !== undefined &&
      runCheck(originalContent, 'cjs', '') !== null
    ) {
      warnUnjudgeableModule(0);
      return null;
    }
    return failure;
  }

  const originalParts =
    originalContent === undefined
      ? undefined
      : originalContent.split(new RegExp(MODULE_BOUNDARY_SPLIT_RE.source, 'g'));
  const comparable =
    originalParts !== undefined && originalParts.length === parts.length;

  // The marker before part i carries the ordinal i/2, so a part's position in
  // the joined text is i/2 -- reported rather than the bun module index, which
  // only the binary knows.
  const moduleCount = (parts.length + 1) / 2;
  for (let i = 0; i < parts.length; i += 2) {
    if (comparable && originalParts![i] === parts[i]) continue;
    const label = `In bundle module ${i / 2} of ${moduleCount}:`;
    const failure = runCheck(parts[i], 'mjs', label);
    if (failure === null) continue;
    if (comparable && runCheck(originalParts![i], 'mjs', '') !== null) {
      warnUnjudgeableModule(i / 2);
      continue;
    }
    return failure;
  }
  return null;
};
