'use strict';

const el = id => document.getElementById(id);
const controls = ['region', 'month', 'service', 'supplier'].map(el);
const [region, month, service, supplier] = controls;
const pageSize = 16;
const number = new Intl.NumberFormat('ru', { maximumFractionDigits: 8 });
const date = value => value?.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1') || '';
const collator = new Intl.Collator('ru', { numeric: true });
const cache = new Map();
let manifest, corrections, records = [], current = [], groups = [], page = 0, request = 0;

function node(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function shortName(value) {
  return value.replace(/^общество с ограниченной ответственностью\s+/i, 'ООО ')
    .replace(/^публичное акционерное общество\s+/i, 'ПАО ')
    .replace(/^акционерное общество\s+/i, 'АО ')
    .replace(/^муниципальное каз[её]нное учреждение\s+/i, 'МКУ ')
    .replace(/^муниципальное унитарное предприятие\s+/i, 'МУП ');
}

function options(select, values, placeholder) {
  const previous = select.value;
  select.replaceChildren(...(placeholder ? [new Option(placeholder, '')] : []),
    ...values.map(([value, label]) => new Option(label, value)));
  if (values.some(([value]) => value === previous)) select.value = previous;
}

function namedOptions(values, label = value => value) {
  return [...new Set(values.filter(Boolean))].map(value => [value, label(value)])
    .sort((a, b) => collator.compare(a[1], b[1]));
}

async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(path);
  return response.json();
}

function clear(message, retry = false) {
  el('status').textContent = message;
  el('retry').hidden = !retry;
  el('result-content').hidden = true;
  service.disabled = supplier.disabled = true;
  groups = [];
  setupChart();
}

async function start() {
  try {
    manifest = await json('data/tariffs/index.json');
    options(region, manifest.regions.map(item => [item.file, item.name.trim()]));
    region.value = manifest.regions.find(item => /ярославская область/i.test(item.name))?.file ?? region.value;
    month.value = manifest.date.slice(0, 7);
    el('coverage').textContent = `${manifest.regions.length} региона`;
    el('snapshot-date').textContent = `Выгрузка от ${date(manifest.date)}`;
    el('archive').href = manifest.source;
    el('archive').hidden = false;
    region.disabled = false;
    await loadRegion();
  } catch {
    clear('Не удалось загрузить список регионов.', true);
  }
}

async function loadRegion() {
  const version = ++request;
  const selected = region.value;
  records = [];
  options(service, [], 'Все услуги');
  options(supplier, [], 'Все поставщики');
  clear('Загружаем ставки региона…');
  try {
    if (!cache.has(selected)) {
      const [raw, amendments] = await Promise.all([
        json(`data/tariffs/${selected}`),
        corrections ?? json('data/tariff-corrections.json')
      ]);
      corrections = amendments;
      const name = manifest.regions.find(item => item.file === selected).name;
      cache.set(selected, Tariffs.mergeCorrections(Tariffs.decode(raw), corrections, name));
    }
    if (version !== request) return;
    records = cache.get(selected);
    render();
  } catch {
    if (version === request) clear('Не удалось загрузить ставки региона.', true);
  }
}

function render() {
  if (!records.length) return;
  if (!month.value || !month.validity.valid) {
    clear('Укажите месяц и год действия тарифа.');
    return;
  }
  const active = Tariffs.active(records, month.value);
  options(service, namedOptions(active.map(record => record.kind)), 'Все услуги');
  const matchingService = active.filter(record => !service.value || record.kind === service.value);
  options(supplier, namedOptions(matchingService.map(record => record.supplier), shortName), 'Все поставщики');
  service.disabled = !active.length;
  supplier.disabled = !matchingService.length;
  current = matchingService.filter(record => !supplier.value || record.supplier === supplier.value)
    .sort((a, b) => Number(!a.supplier) - Number(!b.supplier) || collator.compare(a.supplier, b.supplier) || collator.compare(a.kind, b.kind));
  const suppliers = new Set(current.map(record => record.supplier).filter(Boolean));
  el('status').textContent = current.length
    ? `${number.format(current.length)} ставок · ${number.format(suppliers.size)} поставщиков`
    : 'В выгрузке нет ставок, действующих весь выбранный месяц.';
  el('result-content').hidden = !current.length;
  page = 0;
  renderRows();
  groups = comparableGroups(matchingService);
  setupChart();
}

function renderRows() {
  const rows = current.slice(page * pageSize, (page + 1) * pageSize).map(record => {
    const row = document.createElement('tr');
    const company = node('td', '', 'company');
    company.append(node('strong', shortName(record.supplier) || 'Поставщик не указан'), node('small', record.area));
    const category = node('td', '', 'category');
    category.append(node('strong', record.kind), node('small', [record.component, record.stake, record.criteria, record.description].filter(Boolean).join(' · ')));
    const source = node('td', '', 'source');
    const button = node('button', 'Акт ↗');
    button.type = 'button';
    button.setAttribute('aria-label', 'Основание ставки');
    button.addEventListener('click', () => showSource(record));
    source.append(button);
    row.append(company, category, node('td', record.value, 'rate'), source);
    return row;
  });
  el('rows').replaceChildren(...rows);
  const pages = Math.ceil(current.length / pageSize);
  el('page').textContent = `${page + 1} из ${pages}`;
  el('previous').disabled = page === 0;
  el('next').disabled = page + 1 >= pages;
}

function comparableGroups(rows) {
  const byConditions = new Map();
  for (const record of rows) {
    const rate = record.value.match(/^([\d\s]+(?:[.,]\d+)?)\s*(?:р\.|руб\.?)\s*\/\s*(\S.*)$/i);
    if (!rate || !record.supplier) continue;
    const value = Number(rate[1].replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    const description = record.description.replace(/^\s*с\s*\d{2}\.\d{2}\.20\d{2}(?:\s*(?:по|[-–])\s*\d{2}\.\d{2}\.20\d{2})?\s*[,;:]?\s*/i, '').trim();
    const unit = rate[2].trim();
    const criteria = [record.kind, record.component, record.stake, record.criteria, description, record.discount, record.composite, unit];
    const key = JSON.stringify(criteria.map(item => item.trim().toLowerCase().replace(/\s+/g, ' ')));
    if (!byConditions.has(key)) byConditions.set(key, { record, description, unit, suppliers: new Map() });
    const same = byConditions.get(key).suppliers;
    if (same.has(record.supplier) && same.get(record.supplier)?.value !== value) same.set(record.supplier, null);
    else if (!same.has(record.supplier)) same.set(record.supplier, { record, value });
  }
  return [...byConditions.values()].map(group => ({ ...group, entries: [...group.suppliers.values()].filter(Boolean) }))
    .filter(group => group.entries.length >= 2 && (!supplier.value || group.entries.some(item => item.record.supplier === supplier.value)))
    .sort((a, b) => b.entries.length - a.entries.length);
}

function setupChart() {
  const select = el('group');
  options(select, groups.map(({ record, description, unit, entries }, index) => [String(index),
    [record.kind, record.component, record.stake, record.criteria, description,
      record.discount === 'Да' && 'Льготный', record.composite === 'Да' && 'Составной', `₽ / ${unit}`, `${entries.length} пост.`].filter(Boolean).join(' · ')
  ]), groups.length ? 'Выберите условия' : 'Нет сопоставимых ставок');
  select.value = groups.length ? '0' : '';
  select.disabled = !groups.length;
  renderChart();
}

function renderChart() {
  const chart = el('chart');
  const select = el('group');
  const group = select.value === '' ? undefined : groups[Number(select.value)];
  chart.replaceChildren();
  el('chart-caption').textContent = group ? '' : 'График появится, когда найдутся ставки как минимум двух поставщиков с одинаковыми условиями.';
  if (!group) return;
  const { record, description, unit, entries } = group;
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  const shown = sorted.slice(0, 10);
  const selected = sorted.find(item => item.record.supplier === supplier.value);
  if (selected && !shown.includes(selected)) shown[shown.length - 1] = selected;
  const highest = sorted.at(-1).value;
  const conditions = [record.kind, record.component, record.stake, record.criteria, description,
    record.discount && `Льготный тариф: ${record.discount}`, record.composite && `Составной тариф: ${record.composite}`].filter(Boolean);
  const subset = shown.length < entries.length
    ? `Показано ${shown.length} из ${entries.length}: самые низкие ставки${selected && !sorted.slice(0, 10).includes(selected) ? ' и выбранный поставщик' : ''}. ` : '';
  el('chart-caption').textContent = `${subset}₽ / ${unit} · шкала от 0 до ${number.format(highest)}.`;
  const list = node('ul', '', 'bars');
  for (const item of shown) {
    const row = node('li', '', item === selected ? 'highlight' : '');
    const company = node('button', shortName(item.record.supplier), 'chart-company');
    company.type = 'button';
    company.addEventListener('click', () => showSource(item.record));
    const track = node('div', '', 'track');
    const fill = node('div', '', 'fill');
    fill.style.width = `${highest ? item.value / highest * 100 : 0}%`;
    track.append(fill);
    track.setAttribute('aria-hidden', 'true');
    row.append(company, track, node('strong', number.format(item.value)));
    list.append(row);
  }
  chart.append(node('p', conditions.join(' · '), 'chart-conditions'), list);
}

function showSource(record) {
  el('source-title').textContent = record.value;
  const fields = [
    ['Поставщик', record.supplier], ['Территория', record.area], ['Тариф', record.title],
    ['Услуга', record.kind], ['Общий срок тарифа', record.period.replace(/\d{4}-\d{2}-\d{2}/g, date)],
    ['Условия ставки', [record.component, record.stake, record.criteria, record.description].filter(Boolean).join(' · ')],
    ['Льготный тариф', record.discount], ['Составной тариф', record.composite],
    ['Документ', record.act], ['Идентификатор тарифа', record.id],
    [record.replacesPriceId ? 'Идентификатор уточнённой ставки' : 'Идентификатор ставки', record.replacesPriceId || record.priceId],
    [record.sourceUrl ? 'Дата уточнения' : 'Дата выгрузки', date(record.sourceDate || manifest.date)]
  ];
  el('source-details').replaceChildren(...fields.filter(([, value]) => value).flatMap(([label, value]) => [node('dt', label), node('dd', value)]));
  el('source-link').href = record.sourceUrl || manifest.source;
  el('source-link').textContent = record.sourceUrl ? 'Открыть документ ↗' : 'Скачать архив ГИС ЖКХ ↗';
  el('source-dialog').showModal();
}

region.addEventListener('change', loadRegion);
for (const control of controls.slice(1)) control.addEventListener('change', render);
el('group').addEventListener('change', renderChart);
el('retry').addEventListener('click', () => manifest ? loadRegion() : start());
for (const [id, shift] of [['previous', -1], ['next', 1]]) {
  el(id).addEventListener('click', () => { page += shift; renderRows(); });
}
start();
