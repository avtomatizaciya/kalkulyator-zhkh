(function (root) {
  'use strict';
  function number(value, name) {
    const text = String(value ?? '').trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('Укажите ' + name + ': число не меньше нуля.');
    const result = Number(text);
    if (!Number.isFinite(result) || result > 1e9) throw new Error('Проверьте ' + name + ': слишком большое число.');
    return result;
  }
  function cents(value) {
    if (!Number.isFinite(value) || value > 1e12) throw new Error('Результат слишком большой. Проверьте введенные значения.');
    return Math.round((value + Number.EPSILON * Math.max(1, value)) * 100);
  }
  function calculate(row) {
    try {
      let quantity, formula;
      if (row.mode === 'meter') {
        const previous = number(row.previous, 'предыдущие показания');
        const current = number(row.current, 'текущие показания');
        if (current < previous) throw new Error('Текущие показания меньше предыдущих. Проверьте счетчик и цифры.');
        quantity = current - previous;
        formula = '(' + current + ' − ' + previous + ')';
      } else if (row.mode === 'norm') {
        const residents = number(row.residents, 'число проживающих');
        if (!Number.isInteger(residents) || residents < 1) throw new Error('Число проживающих должно быть целым и не меньше 1.');
        const norm = number(row.norm, 'норматив');
        const coefficient = number(row.coefficient, 'коэффициент');
        if (coefficient <= 0) throw new Error('Коэффициент должен быть больше нуля.');
        quantity = residents * norm * coefficient;
        formula = residents + ' × ' + norm + ' × ' + coefficient;
      } else {
        quantity = number(row.quantity, 'объем или площадь');
        formula = String(quantity);
      }
      const rate = number(row.rate, row.mode === 'hot' ? 'тариф на холодную воду' : 'тариф');
      let total = quantity * rate;
      formula += ' × ' + rate;
      if (row.mode === 'hot') {
        const heatPerCube = number(row.heatPerCube, 'расход тепла на подогрев кубометра');
        const heatRate = number(row.heatRate, 'тариф на тепловую энергию');
        total += quantity * heatPerCube * heatRate;
        formula += ' + ' + quantity + ' × ' + heatPerCube + ' × ' + heatRate;
      }
      const expected = cents(total);
      const billed = String(row.billed ?? '').trim() === '' ? null : cents(number(row.billed, 'начисление из квитанции'));
      return { ok: true, quantity, expected, billed, difference: billed === null ? null : billed - expected, formula };
    } catch (error) { return { ok: false, error: error.message }; }
  }
  const api = { number, cents, calculate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Zhkh = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
