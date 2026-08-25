import { createHash } from 'crypto';
import { statSync, existsSync, unlinkSync } from 'fs';
import {
  extractClaudeJsFromNativeInstallation,
  repackNativeInstallation,
  reportBunCoverage,
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
  if (!a.equals(b)) process.exit(1);

  // Круговой ход БЕЗ правок ничего не доказывает про пересборку: она возвращает
  // нагрузку нетронутой, когда ни один модуль не изменился. Дефект 2.1.246
  // проявлялся только при настоящей правке -- участки, на которые не указывает
  // ни один указатель, пропадали, и заметить это можно было лишь по образу,
  // который перестал запускаться. Поэтому вторая фаза правит текст и сверяет
  // непокрытые участки до и после.
  const before = reportBunCoverage(src);
  if (!before) {
    console.log('ПРОВАЛ: не удалось измерить покрытие исходной нагрузки');
    process.exit(1);
  }
  const edited = Buffer.concat([a, Buffer.from('\n//__probe__\n', 'utf-8')]);
  if (existsSync(out)) unlinkSync(out);
  repackNativeInstallation(src, edited, out);
  const after = reportBunCoverage(out);
  if (!after) {
    console.log('ПРОВАЛ: не удалось измерить покрытие пересобранной нагрузки');
    process.exit(1);
  }
  console.log(
    `с правкой:  нагрузка ${before.payloadSize.toLocaleString()} -> ${after.payloadSize.toLocaleString()}, ` +
      `непокрыто ${(before.payloadSize - before.covered).toLocaleString()} -> ${(after.payloadSize - after.covered).toLocaleString()}, ` +
      `дыр>4К ${before.gaps.length} -> ${after.gaps.length}`
  );
  // Сверяются не описания участков, а факт: исходный непокрытый участок обязан
  // остаться непокрытым и на том же абсолютном месте. Границы при этом законно
  // плывут -- освободившиеся рядом байты сливаются с участком в один, -- поэтому
  // проверяется вложенность, а не равенство. Пропажа, которую ловит эта проба,
  // выглядит иначе: участка нет вовсе, и нагрузка короче на его длину.
  const lost = before.gaps.filter(
    g =>
      !after.gaps.some(
        h => h.start <= g.start && h.start + h.length >= g.start + g.length
      )
  );
  if (lost.length > 0) {
    for (const g of lost) {
      console.log(
        `ПРОВАЛ: участок @${g.start.toLocaleString()} длиной ${g.length.toLocaleString()} не пережил пересборку`
      );
    }
    process.exit(1);
  }
  const c = extractClaudeJsFromNativeInstallation(out);
  if (!c || !c.equals(edited)) {
    console.log('ПРОВАЛ: правка не читается обратно из пересобранного образа');
    process.exit(1);
  }
  console.log(
    'С ПРАВКОЙ: непокрытые участки на месте, правка читается обратно'
  );
  process.exit(0);
}
main();
