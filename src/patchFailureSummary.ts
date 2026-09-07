import { PatchGroup, PatchResult } from './patches/index';

/**
 * The lines printed under "Customizations applied with some failures.",
 * without colour: the caller owns rendering, so the wording stays pinnable.
 */
export const patchFailureSummaryLines = (results: PatchResult[]): string[] => {
  const systemPromptFailures = results.filter(
    r => r.group === PatchGroup.SYSTEM_PROMPTS && r.failed
  );
  const appliedSystemPrompts = results.some(
    r => r.group === PatchGroup.SYSTEM_PROMPTS && r.applied
  );
  const lines: string[] = [];

  // The branch is chosen by the GROUP a failure belongs to, not by the fact
  // that something failed. While only applyPatchImplementations could set
  // `failed`, the condition was identically true and the sentence below held
  // for free -- it rested on system prompts being unable to fail at all, not
  // on any check. applySystemPrompts now reports a broken instrument (#753)
  // and a refused injection (#900) as failures, so the same sentence would
  // deny, to the operator's face, the very outcome printed above it.
  if (systemPromptFailures.length > 0) {
    lines.push(
      `${systemPromptFailures.length} of your system prompt customizations were NOT written to cli.js -- see the rows marked with a cross above.`
    );
    if (appliedSystemPrompts) {
      lines.push('The remaining system prompt customizations were applied.');
    }
  } else {
    lines.push(
      'These patching errors do not affect your system prompt patches.'
    );
    if (appliedSystemPrompts) {
      lines.push(
        'Your system prompt customizations were still applied successfully.'
      );
    }
  }

  // Unconditional before the split and made false by neither branch.
  lines.push(
    'Please open an issue on https://github.com/Piebald-AI/tweakcc/issues/new reporting these patching errors.'
  );
  return lines;
};
