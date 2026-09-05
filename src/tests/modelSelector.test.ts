import { describe, it, expect } from 'vitest';
import {
  writeModelCustomizations,
  CUSTOM_MODELS,
} from '../patches/modelSelector';

// Формы взяты ДОСЛОВНО из образов CC: 2.1.259 и 2.1.261. 2.1.261 сделал `label`
// выражением, а `description` тернарником с шаблонной строкой -- локатор, пинивший
// эти значения целиком, промахивался по месту, на котором стоял.
describe('modelSelector: точка вставки списка моделей', () => {
  const head = 'function Qz9(e,n){let o=[...e];';

  const shape259 =
    head +
    'if(n)for(let B of n){let U=B.trim();if(o.some((K)=>K.value===U))continue;' +
    'if(U.startsWith("anthropic.")){o.push({value:U,label:U,description:"Custom model"});continue}}return o}';

  const shape261 =
    head +
    'if(n)for(let N of n){let F=N.trim();if(o.some((re)=>re.value===F))continue;' +
    'if(F.startsWith("anthropic.")){let re=dUe(F);' +
    'o.push({value:F,label:re??F,description:re===void 0?"Custom model":`Custom model (${F})`});' +
    'continue}}return o}';

  // Соседнее место несёт ТОТ ЖЕ литерал, но точкой вставки не является:
  // аргумент push -- не объектный литерал, а `??`-выражение.
  const siblingOnly =
    'function Qz9(e){let o=[...e];return o.push(Die(C)??{value:C,label:C,description:"Custom model"}),o}';

  it('находит место в форме 2.1.259', () => {
    const out = writeModelCustomizations(shape259);
    expect(out).not.toBeNull();
    expect(out).toContain(`o.push(${JSON.stringify(CUSTOM_MODELS[0])});`);
  });

  it('находит место в форме 2.1.261 (label и description -- выражения)', () => {
    const out = writeModelCustomizations(shape261);
    expect(out).not.toBeNull();
    expect(out).toContain(`o.push(${JSON.stringify(CUSTOM_MODELS[0])});`);
    // исходное место не тронуто -- мы только вставляем рядом с объявлением
    expect(out).toContain('description:re===void 0?"Custom model"');
  });

  it('вставляет ВСЕ объявленные модели', () => {
    const out = writeModelCustomizations(shape261) as string;
    for (const m of CUSTOM_MODELS) {
      expect(out).toContain(`o.push(${JSON.stringify(m)});`);
    }
  });

  it('не принимает соседнее место за точку вставки', () => {
    expect(writeModelCustomizations(siblingOnly)).toBeNull();
  });
});
