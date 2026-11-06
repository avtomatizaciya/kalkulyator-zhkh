(function (root) {
  'use strict';
  const names = [['cold', /холодн\S*\s+вод|\bхвс\b/i], ['hot', /горяч\S*\s+вод|\bгвс\b/i], ['sewage', /водоотвед|канализац/i], ['electricity', /электроэнерг|электрич/i], ['heat', /отоплен/i], ['gas', /газоснабжен|поставка\s+природного\s+газа/i], ['maintenance', /содержание\s+(?:жил|помещ)|содерж\S*\s+и\s+ремонт/i], ['capital', /кап\S*\s+ремонт|капремонт/i], ['waste', /обращение\s+с\s+тко|вывоз\s+(?:мусор|тко)/i]];
  const numbers = text => (text.match(/\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d+|\d+[,.]\d+|\d+/g) || []).map(s => Number(s.replace(/\s/g, '').replace(',', '.')));
  function parse(text) {
    text = text.replace(/\u00a0/g, ' ');
    const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean), rows = [];
    // A gas table has an explicit method row and a tariff per thousand cubic metres.
    // Never use the account-balance table or the total payable as a service charge.
    const gas = /поставка\s+природного\s+газа|газоснабжение/i.test(text);
    const thousand = /тыс\.?\s*м[³3]|1000\s*м[³3]/i.test(text);
    if (gas && thousand) {
      const part = text.split(/2\s*[.)]\s*Расчет размера платы\s*:/i)[1]?.split(/3\s*[.)]\s*Сведения/i)[0] || '';
      const match = part.match(/Узел\s*[\dОO]+\s+Норматив\s+([\s\S]+)/i);
      if (match) {
        const n = numbers(match[1]);
        if (n.length >= 4 && n[2] === 1) rows.push({ kind: 'gas', mode: 'quantity', quantity: String(n[0]), rate: String(n[1]), rateBasis: '1000', billed: String(n[3]) });
      }
    }
    if (!rows.length) for (const line of lines) {
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
    const period = date ? date[2] + '-' + String(monthNames.indexOf(date[1]) + 1).padStart(2, '0') : '';
    return { rows, period, hasBalance: /долг|аванс|пени|сальдо/i.test(text), thousand };
  }
  const api = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Receipt = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
