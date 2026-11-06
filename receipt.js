(function (root) {
  'use strict';
  const names = [['cold', /холодн\S*\s+вод|\bхвс\b/i], ['hot', /горяч\S*\s+вод|\bгвс\b/i], ['sewage', /водоотвед|канализац/i], ['electricity', /электроэнерг|электрич/i], ['heat', /отоплен/i], ['gas', /газоснабжен|поставка\s+природного\s+газа/i], ['maintenance', /содержание\s+(?:жил|помещ)|содерж\S*\s+и\s+ремонт/i], ['capital', /кап\S*\s+ремонт|капремонт/i], ['waste', /обращение\s+с\s+тко|вывоз\s+(?:мусор|тко)/i]];
  const numbers = text => (text.match(/\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d+|\d+[,.]\d+|\d+/g) || []).map(s => Number(s.replace(/\s/g, '').replace(',', '.')));
  function tableRows(pages) {
    const rows = [];
    for (const page of pages || []) {
      // PDF text runs can contain both a unit and its value, or a grouped amount.
      const words = (page.words || []).flatMap(w => [...w.text.matchAll(/\S+/g)].map(m => ({ ...w, text: m[0], x: w.x + (w.w || 0) * m.index / w.text.length })));
      const anchor = label => words.find(w => w.text === label);
      const tariff = anchor('Тариф');
      const epd = words.some(w => w.text === 'Компенсация') && words.some(w => /(?:Вид )?платежа/.test(w.text));
      const heat = words.some(w => w.text === 'Vотоп./') && words.some(w => w.text === 'Всего');
      const volume = tariff && words.find(w => w.text === 'Объем' && (epd || w.x < tariff.x) && Math.abs(w.y - tariff.y) < 12);
      if (!tariff || !volume) continue;
      if (!epd && !heat) continue;
      const totals = words.filter(w => w.text === (epd ? 'Итого' : 'Всего') && w.x > tariff.x && w.y >= tariff.y - 2 && w.y < tariff.y + 35).sort((a, b) => a.x - b.x);
      const final = totals.at(-1);
      const base = epd ? anchor('Стоимость') : words.find(w => w.text === 'Начислено' && Math.abs(w.y - tariff.y) < 12) || totals[0];
      if (!base || !final) continue;
      const lines = [];
      for (const word of words) {
        let line = lines.find(l => Math.abs(l.y - word.y) < 2);
        if (!line) { line = { y: word.y, words: [] }; lines.push(line); }
        line.words.push(word);
      }
      for (const line of lines.sort((a, b) => a.y - b.y)) {
        if (line.y < tariff.y + 20) continue;
        const ws = line.words.sort((a, b) => a.x - b.x);
        const label = ws.filter(w => w.x < tariff.x - (epd ? 35 : 110)).map(w => w.text).join(' ');
        if (/^Итого|^ИТОГО/.test(label)) break;
        if (/в\s*т\.?\s*ч\.?/i.test(label)) continue;
        const found = names.find(([, pattern]) => pattern.test(label));
        const component = /ГВС компонент на (тепловую энергию|теплоноситель)/i.test(label);
        if (!found && !component && (!epd || !/[а-я]/i.test(label))) continue;
        const cell = (left, right) => {
          const text = ws.filter(w => w.x >= left && w.x < right).map(w => w.text).join('').replace(/\s/g, '').replace(/−/g, '-').replace(',', '.');
          return /^-?\d+(?:\.\d+)?$/.test(text) ? text : '';
        };
        const quantity = cell(volume.x - (epd ? 14 : 24), epd ? base.x - 3 : tariff.x - 12);
        const rate = cell(tariff.x - 10, tariff.x + 32);
        const billed = cell(final.x - 10, final.x + (epd ? 32 : 45));
        const original = cell(base.x - (epd ? 3 : 10), base.x + (epd ? 35 : 28));
        // Corrections have their own printed columns. Never infer one from a mismatch.
        const correctionValues = ws.filter(w => w.x >= base.x + (epd ? 35 : 28) && w.x < final.x - 10);
        const corrections = []; let pending = '';
        for (const w of correctionValues) {
          pending += w.text.replace(/\s/g, '');
          if (/[,.]\d{2}$/.test(pending)) { corrections.push(Number(pending.replace('−', '-').replace(',', '.'))); pending = ''; }
        }
        if (pending || corrections.some(v => !Number.isFinite(v))) continue;
        if (!quantity || !rate || !billed || !original) continue;
        const correction = corrections.reduce((a, b) => a + b, 0);
        if (Math.abs(Number(original) + correction - Number(billed)) > .011) continue;
        const printedUnit = ws.find(w => w.x < volume.x && /^(?:м[23³²]\.?|Гкал|кВт\/ч|кВт·ч)$/i.test(w.text))?.text || '';
        const unit = /^м2/.test(printedUnit) ? 'м²' : /^м3/.test(printedUnit) ? 'м³' : printedUnit.replace('кВт/ч', 'кВт·ч');
        rows.push({ kind: component ? 'hot' : found?.[0] || 'other', mode: 'quantity', quantity, rate, billed, correction: String(correction), rateBasis: '1', title: label.replace(/^.*?(?=Отопление)/, ''), unit, confidence: 'table' });
      }
    }
    return rows;
  }
  function parse(text, pages = []) {
    text = text.replace(/\u00a0/g, ' ');
    const rows = tableRows(pages);
    // A gas table has an explicit method row and a tariff per thousand cubic metres.
    // Never use the account-balance table or the total payable as a service charge.
    const gas = /поставка\s+природного\s+газа|газоснабжение/i.test(text);
    const thousand = /тыс\.?\s*м[³3]|1000\s*м[³3]/i.test(text);
    if (!rows.length && gas && thousand) {
      const part = text.split(/2\s*[.)]\s*Расчет размера платы\s*:/i)[1]?.split(/3\s*[.)]\s*Сведения/i)[0] || '';
      const match = part.match(/Узел\s*[\dОO]+\s+Норматив\s+([\s\S]+)/i);
      if (match) {
        const n = numbers(match[1]);
        if (n.length >= 4 && n[2] === 1) rows.push({ kind: 'gas', mode: 'quantity', quantity: String(n[0]), rate: String(n[1]), rateBasis: '1000', billed: String(n[3]) });
      }
    }
    const simple = text.split(/^\s*Услуга\s+Об[ъь]ем\s+Тариф\s+Начислено\s*$/im)[1]?.split(/^\s*(?:Итого|Всего|Сальдо|Справочная|Сведения)/im)[0] || '';
    if (!rows.length) for (const line of simple.split(/\n/)) {
      if (/долг|аванс|пени|итого|всего|сальдо/i.test(line)) continue;
      const found = names.find(([, pattern]) => pattern.test(line));
      if (!found) continue;
      const n = numbers(line.replace(found[1], ''));
      // Only propose an unambiguous three-column quantity/rate/charge row.
      // Wider tables require a person to map their columns.
      if (n.length === 3 && n.every(Number.isFinite)) rows.push({ kind: found[0], mode: 'quantity', quantity: String(n[0]), rate: String(n[1]), billed: String(n[2]), rateBasis: '1' });
    }
    const monthNames = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
    const date = text.toLowerCase().match(new RegExp('(' + monthNames.join('|') + ')\\s+(20\\d{2})'));
    let period = date ? date[2] + '-' + String(monthNames.indexOf(date[1]) + 1).padStart(2, '0') : '';
    if (!period) {
      const dates = [...new Set([...text.matchAll(/На\s+01\.(\d{2})\.(20\d{2})/g)].map(m => m[2] + '-' + m[1]))].sort();
      if (dates.length === 2 && new Date(dates[1] + '-01').getTime() === Date.UTC(Number(dates[0].slice(0, 4)), Number(dates[0].slice(5)), 1)) period = dates[0];
    }
    return { rows, period, hasBalance: /долг|аванс|пени|сальдо/i.test(text), thousand };
  }
  const api = { parse, tableRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Receipt = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
