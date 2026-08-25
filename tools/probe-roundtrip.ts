import { createHash } from 'crypto';
import { statSync, existsSync, unlinkSync } from 'fs';
import {
  extractClaudeJsFromNativeInstallation,
  repackNativeInstallation,
} from '../src/nativeInstallation.js';

const sha = (b: Buffer) =>
  createHash('sha256').update(b).digest('hex').slice(0, 16);

async function main() {
  const src = process.argv[2];
  const out = process.argv[3];

  const a = extractClaudeJsFromNativeInstallation(src);
  if (!a) {
    console.log('ПРОВАЛ: извлечение вернуло null');
    process.exit(1);
  }
  const text = a.toString('utf-8');
  const bounds =
    text.match(/\n\/\*__tweakcc_module_boundary_(\d+)__\*\/\n/g) ?? [];
  console.log(
    `извлечено: ${a.length.toLocaleString()} байт, sha=${sha(a)}, границ=${bounds.length}`
  );

  // локаторы, по которым бьют наши патчи
  for (const probe of [
    'reasoning_effort',
    'autoCompactWindowsCache',
    'subagent_type',
    'thinkingBudget',
  ])
    console.log(
      `   локатор ${probe.padEnd(26)}: ${text.includes(probe) ? 'ЕСТЬ' : 'НЕТ'}`
    );

  if (existsSync(out)) unlinkSync(out);
  repackNativeInstallation(src, a, out);
  console.log(
    `пересобрано: ${statSync(out).size.toLocaleString()} байт (исходный ${statSync(src).size.toLocaleString()})`
  );

  const b = extractClaudeJsFromNativeInstallation(out);
  if (!b) {
    console.log('ПРОВАЛ: повторное извлечение вернуло null');
    process.exit(1);
  }
  console.log(`повторно:   ${b.length.toLocaleString()} байт, sha=${sha(b)}`);
  console.log(
    a.equals(b)
      ? 'КРУГОВОЙ ХОД: совпало байт-в-байт'
      : 'ПРОВАЛ: тексты разошлись'
  );
  process.exit(a.equals(b) ? 0 : 1);
}
main();
