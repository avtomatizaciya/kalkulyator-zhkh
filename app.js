'use strict';
const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(value / 100);
const kinds = { cold: ['Холодная вода', 'м³'], hot: ['Горячая вода', 'м³'], sewage: ['Водоотведение', 'м³'], electricity: ['Электричество', 'кВт·ч'], heat: ['Отопление', 'Гкал'], gas: ['Газ', 'м³'], maintenance: ['Содержание жилья', 'м²'], capital: ['Капремонт', 'м²'], waste: ['Вывоз мусора', 'ед.'], other: ['Другая услуга', 'ед.'] };
let counter = 0;
function field(key, title, placeholder = '', value = '') {
  return `<label class="fld">${title}<input data-key="${key}" type="text" inputmode="decimal" placeholder="${placeholder}" value="${value}" autocomplete="off"></label>`;
}
function add(data = {}) {
  const card = document.createElement('article');
  card.className = 'step service'; card.dataset.id = ++counter;
  card.innerHTML = `<div class="row between"><h2>Услуга ${counter}</h2><button class="remove" aria-label="Удалить услугу ${counter}">Убрать</button></div><div class="grid"><label class="fld">Услуга<select data-key="kind">${Object.entries(kinds).map(([key, [name]]) => `<option value="${key}">${name}</option>`).join('')}</select></label><label class="fld">Как посчитать<select data-key="mode"><option value="quantity">Объем из квитанции × тариф</option><option value="meter">Разница показаний × тариф</option><option value="norm">Проживающие × норматив × тариф</option><option value="hot">Горячая вода: два компонента</option></select></label></div><div class="grid inputs"><div data-modes="quantity hot">${field('quantity', 'Объем, м³', 'Например, 8')}</div><div data-modes="meter">${field('previous', 'Предыдущие показания')}${field('current', 'Текущие показания')}</div><div data-modes="norm">${field('residents', 'Количество проживающих', '2')}${field('norm', 'Норматив на человека')}${field('coefficient', 'Коэффициент', '', '1')}</div><div>${field('rate', 'Тариф, ₽ за единицу', 'Из квитанции или официального источника')}</div><div data-modes="hot">${field('heatPerCube', 'Подогрев воды, Гкал на м³')}${field('heatRate', 'Тепловая энергия, ₽ за Гкал')}</div><div>${field('billed', 'Начислено за услугу, ₽', 'Необязательно')}</div></div><p class="method-note note"></p><div class="line-result" aria-live="polite"></div>`;
  $('services').append(card);
  for (const [key, value] of Object.entries(data)) { const input = card.querySelector(`[data-key="${key}"]`); if (input) input.value = value; }
  card.querySelector('.remove').onclick = () => { card.remove(); render(); };
  card.addEventListener('input', () => { configure(card); render(); });
  configure(card); render();
}
function values(card) { return Object.fromEntries([...card.querySelectorAll('[data-key]')].map(input => [input.dataset.key, input.value])); }
function configure(card) {
  const row = values(card);
  card.querySelectorAll('[data-modes]').forEach(group => { group.hidden = !group.dataset.modes.split(' ').includes(row.mode); });
  const unit = kinds[row.kind][1];
  card.querySelector('[data-key="quantity"]').parentNode.firstChild.textContent = `Объем или площадь, ${row.mode === 'hot' ? 'м³' : unit}`;
  card.querySelector('[data-key="rate"]').parentNode.firstChild.textContent = row.mode === 'hot' ? 'Холодная вода, ₽ за м³' : `Тариф, ₽ за ${unit}`;
  const notes = [];
  if (row.mode === 'norm') notes.push('Этот режим для норматива на человека. Норматив на м² считайте через площадь × тариф × норматив, указав произведение площади и норматива как объем. Коэффициент укажите только при наличии основания.');
  if (row.kind === 'heat') notes.push('Расчет по введенному объему Гкал. Распределение тепла по дому и годовая корректировка здесь не проверяются.');
  if (row.kind === 'sewage') notes.push('При обычной схеме объем равен сумме холодной и горячей воды за тот же период.');
  if (row.mode === 'hot') notes.push('Для двухкомпонентного расчета нужны тариф на воду, расход тепла на подогрев и тариф на тепло. Проверьте применимость этой формулы у исполнителя.');
  card.querySelector('.method-note').textContent = notes.join(' ');
}
function render() {
  let expected = 0, billed = 0, comparedExpected = 0, valid = 0, compared = 0;
  const cards = [...document.querySelectorAll('.service')];
  const questions = [];
  cards.forEach(card => {
    const row = values(card), result = Zhkh.calculate(row), output = card.querySelector('.line-result');
    output.replaceChildren();
    if (!result.ok) { output.className = 'line-result incomplete'; output.textContent = result.error; return; }
    valid++; expected += result.expected;
    output.className = 'line-result';
    const amount = document.createElement('strong'); amount.textContent = money(result.expected); output.append(amount);
    const formula = document.createElement('small'); formula.textContent = result.formula + ' = ' + money(result.expected); output.append(formula);
    if (result.billed !== null) {
      compared++; billed += result.billed; comparedExpected += result.expected;
      const diff = document.createElement('p');
      diff.className = result.difference ? 'difference' : 'match';
      diff.textContent = result.difference === 0 ? 'Арифметика совпала' : `Начислено ${result.difference > 0 ? 'больше' : 'меньше'} расчета на ${money(Math.abs(result.difference))}`;
      output.append(diff);
      if (result.difference) questions.push(`${kinds[row.kind][0]}: в квитанции ${money(result.billed)}, по введенным данным ${money(result.expected)} (${result.formula}). Прошу пояснить расхождение, расчетный объем, примененный тариф, коэффициенты и перерасчеты.`);
    }
  });
  $('summary').textContent = cards.length ? `Рассчитано услуг: ${valid} из ${cards.length}. Тарифы введены пользователем и независимо не проверены.` : 'Добавьте услугу, чтобы начать расчет.';
  $('totals').replaceChildren();
  if (valid) {
    const box = document.createElement('div'); box.className = 'hero-result';
    const title = document.createElement('div'); title.textContent = valid === cards.length ? 'Сумма добавленных услуг' : 'Сумма только заполненных услуг';
    const sum = document.createElement('div'); sum.className = 'big'; sum.textContent = money(expected); box.append(title, sum); $('totals').append(box);
  }
  $('comparison').textContent = compared ? `Сравнение ${compared} услуг с введенными начислениями: расчет ${money(comparedExpected)}, в квитанции ${money(billed)}, разница ${money(billed - comparedExpected)}.` : 'Для сравнения заполните поле «Начислено за услугу».';
  $('warnings').textContent = valid < cards.length ? 'Есть незаполненные или ошибочные услуги. Они не вошли в сумму. Это неполный расчет.' : 'Сумма относится только к добавленным услугам. Долги, пени, льготы и перерасчеты не включены.';
  $('warnings').className = 'alert';
  $('request').textContent = questions.length ? `Прошу предоставить расшифровку начислений за ${$('period').value || 'указанный месяц'}.\n\n` + questions.join('\n\n') : 'Расхождений по заполненным начислениям пока нет. Для вопросов добавьте сумму из квитанции.';
}
$('add').onclick = () => add();
$('period').oninput = render;
$('reset').onclick = () => { $('services').replaceChildren(); $('demo').hidden = true; counter = 0; add(); };
$('example').onclick = () => { $('services').replaceChildren(); counter = 0; $('demo').hidden = false; add({ quantity: '8', rate: '55', billed: '500' }); add({ kind: 'electricity', mode: 'meter', previous: '1250', current: '1430', rate: '6,50', billed: '1170' }); };
$('print').onclick = () => window.print();
$('copy').onclick = async () => { try { await navigator.clipboard.writeText($('request').textContent); $('copy-status').textContent = 'Текст скопирован. Проверьте его перед отправкой.'; } catch { $('request-details').open = true; $('copy-status').textContent = 'Выделите и скопируйте текст ниже.'; } };
$('theme').onclick = () => { const root = document.documentElement; const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; root.dataset.theme = dark ? 'light' : 'dark'; };
add();
