/**
 * The marker `moduleBoundary()` writes, as a matcher. Exported because patches
 * need it too: identifiers in a code-split bundle are module-scoped, so a patch
 * that emits a reference to one has to prove the reference and its target sit
 * between the same pair of markers. Anyone matching the marker must use this
 * constant rather than retyping the literal -- a second copy would keep matching
 * silently after the marker changed.
 */
// CONSTRAINT: лист без импортов: потребитель этой константы не должен тянуть
// nativeInstallation (а с ним node-lief) только ради регулярки.
export const MODULE_BOUNDARY_SPLIT_RE =
  /\n\/\*__tweakcc_module_boundary_(\d+)__\*\/\n/;
