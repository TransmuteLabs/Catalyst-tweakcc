# Contributing

Thank you for your interest in contributing to tweakcc! This document provides guidelines and workflows for contributing to the project.

## Development Setup

### Prerequisites

- **Node.js**: 24.x (20.0.0 or higher required)
- **pnpm**: 11.0.9 or higher

```bash
pnpm install
```

### Running in Development

```bash
# Build for development (no minification)
pnpm build:dev

# Watch mode for iterative development
pnpm watch

# Run the CLI locally after building
pnpm start
```

## Code Style

This project uses ESLint and Prettier for code formatting and linting.

### Prettier Configuration

- **Quotes**: Single quotes
- **Print Width**: 80 characters
- **Semicolons**: Yes
- **Indentation**: 2 spaces (no tabs)
- **Arrow Function Parentheses**: Avoid when possible
- **Trailing Commas**: ES5

### Running Linting and Formatting

```bash
# Lint and type-check
pnpm lint

# Format code
pnpm format

# Check formatting without modifying files (used in CI)
pnpm prettier --check src
```

**Pre-commit hook** (`.husky/pre-commit`) runs no project tooling on the
committing machine. `scripts/run-witness.sh` executes checks on `usbox` against
a snapshot of the staged tree, never against the working tree. Both modes
include a whole-project typecheck:

- **related**: ESLint on changed TypeScript files under `src/`,
  `prettier --check` on changed TypeScript, JSON and Markdown files, and
  `vitest related --run` on changed files under `src/`.
- **full**: `eslint src`, `vitest run`, and `prettier --check --ignore-unknown`
  on the union of tracked ordinary files under `src/` and tracked ordinary
  files matching the snapshot's `package.json` lint-staged globs.
  `.prettierignore` remains in effect; symlinks are not separate formatter inputs.

The shared [trigger table](scripts/witness-rules.sh) is the only home of the
installation inputs and full-mode configuration triggers. Deletions and Git
typechanges under `src/`, and renames/copies involving `src/`, also require full. A
full witness covers related changes; a related witness does not cover full
changes.

The hook only verifies the resulting _witness_ file
(`<git-dir>/tweakcc-witness/<tree>`: `files=…`, `rc=0`, `host=usbox`,
`mode=related|full`). The changed paths stay in Git order, separated by commas;
percent, comma, LF, CR and TAB bytes are encoded as `%25`, `%2C`, `%0A`, `%0D`
and `%09`. New names (A and R/C targets) containing commas or LF are refused;
existing names can be represented and deleted. Names that cannot roundtrip
through UTF-8 are refused with `ФАЙЛЫ_НЕ_UTF8` when passed to Node checks;
deleting such a name is permitted because it is absent from the staged tree.
The witness is self-signed: like the Catalyst pattern it borrows, the file
proves a run happened, not who ran it. Produce the witness for your staged
changes before committing:

```bash
bash scripts/run-witness.sh                # current index
bash scripts/run-witness.sh --tree <tree> --files <list>   # named tree
```

The hook refuses when the witness is missing, was produced for another staged
tree or file list, or is red, and prints the exact command to produce it.
The recipe starts with `cd` to the repository root and works from a subdirectory.

Producers for one tree share a kernel `flock` on the open description of fd 9
at `<git-dir>/tweakcc-witness/<tree>.lock`, using Perl on both platforms.
A competing producer refuses with `ЗАМОК_ЗАНЯТ` (exit 8); no owner reaping occurs.
Releasing a lock only closes fd 9 and leaves its file in place. A surviving
descendant keeps that tree busy while it holds fd 9 open. Measured: an OpenSSH
9.9 multiplexing master (`ControlPersist`) closes inherited descriptors and
does not keep the tree busy.
Age cleanup excludes lock files from `find`; it removes an old lock file only
under a fresh description's own nonblocking `flock`, after matching the inode.
Replacing a path between open and acquisition causes a retry, limited to eight
attempts; a leftover directory lock requires the printed manual removal command.

The hook is tested under Bash 5.2 and Bash 3.2 `--posix`; `/bin/sh` on Mac and usbox is Bash; dash has not been tested.

### TypeScript Best Practices

- Use strict type checking (enabled in `tsconfig.json`)
- Avoid `any` types - prefer `unknown` with type guards
- Use `@/` alias for imports within the `src/` directory
- Define interfaces for all configuration objects (see `src/types.ts`)

### Naming Conventions

- **Components**: PascalCase (e.g., `ThinkingVerbsView`)
- **Functions**: camelCase (e.g., `findClaudeInstallation`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `DEFAULT_CONFIG_PATH`)
- **Files**: camelCase (e.g., `systemPromptSync.ts`) or PascalCase for React components (e.g., `MainView.tsx`)

## Making Changes

### Branching Strategy

1. Create a new branch from `main` for your feature or fix:

   ```bash
   git checkout -b your-branch-name
   ```

2. **Branch naming conventions**:
   - `feature/your-feature-name`
   - `fix/your-fix-description`
   - `docs/your-documentation-update`

### Development Workflow

1. Make your changes following the code style guidelines
2. Run linting and tests locally:
   ```bash
   pnpm lint
   pnpm run test
   ```
3. Build your changes:
   ```bash
   pnpm build:dev
   ```
4. Test your changes by running the CLI locally:
   ```bash
   pnpm start
   ```

### Testing

Run tests before submitting:

```bash
# Run all tests once
pnpm run test

# Run tests in watch mode for development
pnpm run test:dev
```

Test files are located in:

- `src/tests/*.test.ts` - Unit tests for core functionality
- `src/patches/*.test.ts` - Tests for specific patches

**Testing patterns**:

- Use Vitest globals (`describe`, `it`, `expect`, `beforeEach`, `afterEach`)
- Mock dependencies using `vi.mock()`
- Test edge cases and error conditions

### Commit Messages

Follow these conventions for clear, meaningful commit messages:

```text
<type> <subject> (#<issue-number>)

<body>
```

**Types**:

- `Add` - New features
- `Fix` - Bug fixes
- `Prompts for` - Update for new Claude version
- `Sort` - Sorting or reorganization changes
- `Update` - Updates to existing features
- `Refactor` - Code refactoring (no functional changes)

**Examples**:

- `Add support for dangerously bypassing permissions`
- `Fix remaining patching errors`
- `Prompts for 2.1.34`
- `Add auto-accept plan mode patch`

## Submitting Pull Requests

### Before Submitting

1. Ensure all tests pass: `pnpm run test`
2. Ensure linting passes: `pnpm lint`
3. Ensure formatting is correct: `pnpm format`
4. Rebuild the project: `pnpm build:dev`
5. Test your changes locally with `pnpm start`

### PR Description Template

```markdown
## Summary

<Brief description of what this PR changes>

## Changes

- Change 1
- Change 2

## Testing

- [ ] Tests added/updated
- [ ] Manual testing completed
- [ ] All existing tests pass

## Related Issues

Closes #(issue-number) or Relates to #(issue-number)
```

### Review Process

1. PRs will be reviewed by maintainers
2. Address review feedback promptly
3. Keep the PR focused on a single change if possible
4. Ensure commit history is clean (squash/rebase as needed)

### What Happens After Merge

- Your changes will be included in the next release
- You'll be credited in the changelog
- Your contribution is greatly appreciated! 🎉

## Types of Contributions Welcome

- **Bug fixes** - Help squash issues
- **New features** - Propose new patches or customizations
- **Documentation improvements** - Clarify usage or add examples
- **Test coverage** - Add tests for existing functionality
- **Performance improvements** - Optimize CLI startup or execution
- **Prompt updates** - Contribute prompts for new Claude versions

## Reporting Issues

When reporting bugs, please include:

- **Version**: `tweakcc --version`
- **Operating System**: macOS / Linux / WSL
- **Node.js version**: `node --version`
- **Steps to reproduce**: Clear reproduction steps
- **Expected behavior**: What you expected to happen
- **Actual behavior**: What actually happened
- **Logs**: Relevant error messages or logs

## Getting Help

- Check existing [Issues](https://github.com/Piebald-AI/tweakcc/issues) for similar problems
- Read the [README](https://github.com/Piebald-AI/tweakcc#readme) for usage documentation
- Ask questions in a new issue with the `question` label

Thank you for contributing! 🙌
