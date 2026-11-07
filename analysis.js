(function (root) {
  'use strict';
  const Calc = typeof module !== 'undefined' && module.exports ? require('./calc.js') : root.Zhkh;
  const Grounds = typeof module !== 'undefined' && module.exports ? require('./grounds.js') : root.ChargeGrounds;
  const amount = value => new Intl.NumberFormat('ru-RU', {maximumFractionDigits:2}).format(value);
  function facts(text) {
    const result = { area: null, penalties: null };
    const area = text.match(/(?:общая\s+площадь(?:\s+помещения)?|площадь\s+(?:квартиры|помещения))[^\d\n]{0,30}(\d+(?:[.,]\d+)?)/i);
    if (area) result.area = Number(area[1].replace(',', '.'));
    for (const line of text.split('\n')) {
      const match = line.match(/(?:^|\s)Пени[ \t]+([-−]?\d[\d \u00a0]*[,.]\d{2})(?:\s|$)/i);
      if (match && !/оплачено\s*$/i.test(line.slice(0, match.index))) {
        const value = Number(match[1].replace(/[ \u00a0]/g, '').replace(',', '.').replace('−', '-'));
        if (Number.isFinite(value) && value > 0) result.penalties = Math.max(result.penalties || 0, value);
      }
    }
    return result;
  }
  function check(entries, invoices, profile, period) {
    const rows = entries.filter(r => r.enabled && r.period === period), docs = invoices.filter(d => d.period === period);
    let normCount=0,maintenanceCount=0;
    const checks = []; let compared = 0, comparedExpected = 0, primaryExpected = 0, primaryDifference = 0, expected = 0, billed = 0, difference = 0, valid = 0, officialCount = 0, officialDifference = 0;
    const add = (type, title, detail, action = 'data') => checks.push({type,title,detail,action});
    const unread = docs.filter(d => !entries.some(r => r.sourceId === d.id));
    if (unread.length) add('missing', `Не удалось распределить ${unread.length} квитанций`, 'Текст сохранен в разделе квитанций. Внесите недостающие услуги вручную; автоматически прочитанные документы сохранены.', 'documents');
    for (const row of rows) {
      const grounds=Grounds.inspect(row,period);checks.push(...grounds.checks);normCount+=Number(grounds.normChecked);maintenanceCount+=Number(grounds.maintenanceChecked);
      const result = Calc.calculate(row);
      if (!result.ok) { add('missing', row.title + ': не хватает данных', result.error); continue; }
      valid++; expected += result.expected;
      if (result.billed !== null) { compared++; comparedExpected += result.expected; billed += result.billed; difference += result.difference; }
      if(result.billed!==null){const official=row.mode!=='hot'&&row.official?.month===period?Calc.calculate({...row,rate:String(row.official.rate)}):null;const primary=official?.ok?official:result;primaryExpected+=primary.expected;primaryDifference+=primary.difference;}
      else add('missing', row.title + ': нет начисления', 'Введите сумму именно за эту услугу, без долга и пеней.');
      if (result.difference) add('warning', row.title + ': разница ' + amount(result.difference / 100) + ' ₽', 'Объем × тариф с напечатанными коэффициентом и перерасчетом отличается от начисления. Сверьте цифры и запросите расшифровку. Это не доказательство переплаты.');
      if (row.mode === 'hot') add('missing', row.title + ': нужны основания обоих компонентов ГВС', 'Одна выбранная ставка не подтверждает всю двухкомпонентную сумму. Уточните тариф теплоносителя, тариф тепла и расход тепла на подогрев; сверка арифметики остается доступной.', 'tariff');
      if (row.mode !== 'hot' && row.official && row.official.month === period) {
        const reference = Calc.calculate({...row,rate:String(row.official.rate)});
        if (reference.ok && reference.billed !== null) {
          officialCount++; officialDifference += reference.difference;
          if (reference.difference) add('warning', row.title + ': отличается от ставки ГИС ЖКХ', `Разница ${amount(reference.difference / 100)} ₽ при том же объеме. Подтвердите поставщика, категорию, единицу и период выбранной ставки.`, 'tariff');
        }
      }
    }
    if (compared === rows.length && compared && !difference && !checks.some(c => c.type === 'warning')) add('ok', 'Арифметика заполненных строк совпала', 'Долги, пени и неподтвержденные услуги в эту проверку не включены.');
    const eligible=rows.filter(r=>!['maintenance','capital','other'].includes(r.kind)).length;
    if (officialCount < eligible) add('missing', `Ставки ГИС: проверено ${officialCount} из ${eligible} коммунальных услуг`, 'Укажите поставщиков и условия один раз для всех услуг. Неизвестные условия не позволяют подтвердить тариф.', 'tariff');
    if(rows.some(r=>r.kind==='maintenance'&&!r.grounds))add('missing','Проверьте основание платы за содержание','Выберите муниципальную ставку, если она применима, либо ставку из решения собственников или договора. Отдельные компоненты СОИ проверяются отдельно.', 'grounds');
    if(rows.some(r=>['capital','other'].includes(r.kind)))add('missing','Другие отдельные основания','Капремонт и другие услуги требуют соответствующего акта, договора или решения.', 'consult');
    if (docs.some(d => d.assumedPeriod)) add('missing', 'Уточните месяц квитанций', 'В части файлов месяц не распознан. Подтвердите его перед сравнением периодов.', 'documents');
    const areas = docs.filter(d => d.facts?.area !== null && d.facts?.area !== undefined).map(d => ({value:d.facts.area,name:d.name}));
    for (const row of rows) if (['maintenance','capital'].includes(row.kind) && row.mode !== 'norm' && row.unit === 'м²' && Number(row.quantity) > 0) areas.push({value:Number(row.quantity),name:row.title});
    if (profile.sameHome) {
      if (Number(profile.area) > 0) areas.push({value:Number(profile.area),name:'Площадь по вашим документам'});
      if (areas.length > 1 && Math.max(...areas.map(a=>a.value)) - Math.min(...areas.map(a=>a.value)) > .01) add('warning','В расчетах указана разная площадь', areas.map(a=>a.name+': '+amount(a.value)+' м²').join('; ')+'. Проверьте, какой вид площади использует каждая услуга.', 'profile');
      const water = kind => rows.filter(r=>r.kind===kind && (r.unit || 'м³')==='м³' && r.mode!=='norm' && Number.isFinite(Number(r.quantity)) && r.quantity!=='');
      const cold = water('cold'), hot = water('hot'), sewage = water('sewage');
      if (cold.length === 1 && hot.length === 1 && sewage.length === 1) {
        const delta = Number(sewage[0].quantity) - Number(cold[0].quantity) - Number(hot[0].quantity);
        if (Math.abs(delta) > .02) add('warning', 'Водоотведение не равно ХВС + ГВС', `Разница ${amount(delta)} м³. Сверьте даты снятия показаний и схему расчета; компоненты ГВС в Гкал и общедомовые объемы здесь не складываются.`);
        else add('ok','ХВС + ГВС совпадает с водоотведением','Проверены указанные объемы за один месяц одной квартиры.');
      }
    } else if (docs.length > 1) add('missing','Квитанции относятся к одной квартире?', 'Подтвердите это в данных квартиры, чтобы сравнить площадь и объемы разных поставщиков.', 'profile');
    if (docs.some(d => Number(d.facts?.penalties) > 0)) add('advice','В квитанции есть начисленные пени','Сверьте даты платежей и их зачисления. Если начисление спорное, запросите расчет по датам и основание. Не включайте пени в тариф услуги.', 'consult');
    if (profile.meter === 'no') add('advice','Проверьте, выгодны ли счетчики воды','Уточните возможность и стоимость установки. Для оценки экономии нужен ожидаемый фактический расход; по одной сумме квитанции экономию обещать нельзя.', 'profile');
    if (profile.transfer === 'no') add('advice','Проверьте прием последних показаний','Пропуски могут менять способ начисления на средний расход или норматив. Передайте показания и уточните необходимость контрольного снятия и перерасчета.', 'consult');
    if (profile.verification === 'expired') add('advice','Истек срок поверки счетчика воды','Уточните сведения во ФГИС «Аршин», возможность поверки или замены и порядок возобновления учета.', 'consult');
    if (rows.some(r => (r.method === 'normative' || r.mode === 'norm')&&!r.grounds)) add('missing','Сверьте объем с официальным нормативом','Выберите источник для региона, оборудования, периода и укажите подтвержденных жителей или площадь.', 'grounds');
    const previous = [...new Set(entries.filter(r=>r.enabled && r.period<period).map(r=>r.period))].sort().at(-1);
    if (previous && profile.sameHome && !docs.some(d=>d.assumedPeriod)) for (const kind of ['cold','hot','electricity','gas']) {
      const now = rows.filter(r=>r.kind===kind), old = entries.filter(r=>r.enabled && r.period===previous && r.kind===kind);
      if (now.length!==1 || old.length!==1 || now[0].unit!==old[0].unit || now[0].mode!==old[0].mode) continue;
      const a = Calc.calculate(now[0]), b = Calc.calculate(old[0]);
      if (a.ok && b.ok && b.quantity>0 && a.quantity/b.quantity>1.4) add('advice',now[0].title+': вырос расход',`По сравнению с ${previous} расход выше на ${amount((a.quantity/b.quantity-1)*100)}%. Проверьте длину периода, показания, число проживающих и возможные утечки. Рост сам по себе не означает ошибку.`,'history');
    }
    const priority = {warning:0,missing:1,advice:2,ok:3}; checks.sort((a,b)=>priority[a.type]-priority[b.type]);
    return {compared,comparedExpected,primaryExpected,primaryDifference,eligible,normCount,maintenanceCount,rows:rows.length,valid,expected,billed,difference,officialCount,officialDifference,checks,previous};
  }
  const api = {facts,check}; if (typeof module !== 'undefined' && module.exports) module.exports=api; else root.ReceiptAnalysis=api;
})(globalThis);
