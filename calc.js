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
    if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error('Результат слишком большой. Проверьте введенные значения.');
    return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON * Math.max(1, Math.abs(value))) * 100);
  }
  // Разность и произведение десятичных чисел дают двоичный хвост (389.8099999999977): без очистки полкопейки округляются вниз.
  const tidy = value => Number(value.toPrecision(12));
  function signed(value, name) {
    const text = String(value ?? '').trim().replace('−', '-');
    return (text.startsWith('-') ? -1 : 1) * number(text.replace(/^-/, ''), name);
  }
  function calculate(row) {
    try {
      let quantity, formula;
      if (row.mode === 'meter') {
        const previous = number(row.previous, 'предыдущие показания');
        const current = number(row.current, 'текущие показания');
        if (current < previous) throw new Error('Текущие показания меньше предыдущих. Проверьте счетчик и цифры.');
        quantity = tidy(current - previous);
        formula = '(' + current + ' − ' + previous + ')';
      } else if (row.mode === 'norm') {
        const residents = number(row.residents, 'число проживающих');
        if (!Number.isInteger(residents) || residents < 1) throw new Error('Число проживающих должно быть целым и не меньше 1.');
        const norm = number(row.norm, 'норматив');
        const coefficient = number(row.coefficient, 'коэффициент');
        if (coefficient <= 0) throw new Error('Коэффициент должен быть больше нуля.');
        quantity = tidy(residents * norm * coefficient);
        formula = residents + ' × ' + norm + ' × ' + coefficient;
      } else {
        quantity = number(row.quantity, 'объем или площадь');
        formula = String(quantity);
      }
      const rate = number(row.rate, row.mode === 'hot' ? 'тариф на холодную воду' : 'тариф');
      const basis = String(row.rateBasis ?? '1');
      if (!['1', '1000'].includes(basis)) throw new Error('Выберите единицу тарифа: за 1 или за 1000.');
      let total = quantity * rate / Number(basis);
      formula += ' × ' + rate;
      if (basis === '1000') formula += ' / 1000';
      if (row.mode === 'hot') {
        const heatPerCube = number(row.heatPerCube, 'расход тепла на подогрев кубометра');
        const heatRate = number(row.heatRate, 'тариф на тепловую энергию');
        total += quantity * heatPerCube * heatRate;
        formula += ' + ' + quantity + ' × ' + heatPerCube + ' × ' + heatRate;
      }
      const factor = String(row.factor ?? '').trim() === '' ? 1 : number(row.factor, 'повышающий коэффициент');
      if (factor <= 0) throw new Error('Коэффициент должен быть больше нуля.');
      if (factor !== 1) { total *= factor; formula = '(' + formula + ') × ' + factor; }
      const correction = String(row.correction ?? '').trim() === '' ? 0 : signed(row.correction, 'перерасчет');
      const expected = cents(total) + cents(correction);
      if (correction) formula += (correction < 0 ? ' − ' : ' + ') + Math.abs(correction);
      const billed = String(row.billed ?? '').trim() === '' ? null : cents(signed(row.billed, 'начисление из квитанции'));
      return { ok: true, quantity, expected, billed, difference: billed === null ? null : billed - expected, formula };
    } catch (error) { return { ok: false, error: error.message }; }
  }
  // До 2 копеек на строку - обычное округление: объем в квитанции напечатан короче, чем считал исполнитель.
  const mismatch = difference => Math.abs(difference) > 2;
  const api = { number, cents, calculate, mismatch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Zhkh = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
