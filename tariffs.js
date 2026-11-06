(function (root) {
  'use strict';
  const fields = ['title','act','area','supplier','kind','period','discount','composite','component','stake','description','value','criteria','id','priceId'];
  const norm = value => String(value || '').toLowerCase().replace(/ё/g, 'е');
  const patterns = { cold:/питьев|холодн/, hot:/горяч/, sewage:/водоотвед/, heat:/теплов/, gas:/газ/, electricity:/электр/, waste:/отход|тко/ };
  function decode(data) { return data.rows.map(row => Object.fromEntries(fields.map((field, i) => [field, data.strings[row[i]]]))); }
  function effective(record, month) {
    if (!/^20\d{2}-\d{2}$/.test(month)) return false;
    const range = record.period.match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2}|по\s+(?:наст\.?\s*время|настоящее\s+время))/i);
    if (!range || month < range[1].slice(0, 7) || (/^\d/.test(range[2]) && month > range[2].slice(0, 7))) return false;
    const specific = record.description.match(/с\s*(\d{2})\.(\d{2})\.(20\d{2})\s*(?:по|[-–])\s*(\d{2})\.(\d{2})\.(20\d{2})/i);
    if (specific && (month < specific[3] + '-' + specific[2] || month > specific[6] + '-' + specific[5])) return false;
    const starts = [...record.description.matchAll(/(?:^|\s)с\s*(\d{2})[.](\d{2})[.](20\d{2})/gi)].map(m => m[3] + '-' + m[2]);
    return !starts.length || starts.some(start => start <= month);
  }
  function rate(record, row) {
    const match = record.value.match(/^([\d\s\u00a0]+(?:[.,]\d+)?)\s*(?:р\.|руб\.?)\s*\/\s*(.+)$/i);
    if (!match) return null;
    const unit = norm(match[2]), expected = row.unit || ({ electricity:'кВт', heat:'Гкал', maintenance:'м²', capital:'м²', waste:'ед.', other:'ед.' }[row.kind] || 'м³');
    const compatible = expected === 'Гкал' ? /гигакал|гкал/.test(unit) : expected === 'кВт' || /кВт/.test(expected) ? /киловатт.*час|квт/.test(unit) : expected === 'м³' ? /кубическ.*метр|м3|м³/.test(unit) : false;
    if (!compatible) return null;
    const value = Number(match[1].replace(/\s/g, '').replace(',', '.'));
    const sourceBasis = /тыс|тысяч|1000/.test(unit) ? 1000 : 1;
    return Number.isFinite(value) ? value * Number(row.rateBasis || 1) / sourceBasis : null;
  }
  function active(records, month) {
    const dated = record => {
      const m = record.description.match(/^\s*с\s*(\d{2})\.(\d{2})\.(20\d{2})\b/i);
      return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
    };
    const group = record => [record.id,record.component,record.stake,record.criteria,record.discount,norm(record.description).replace(/^\s*с\s*\d{2}\.\d{2}\.20\d{2}\b/, '').replace(/[\s,;:.]+/g, '')].join('|');
    const latest = new Map(), eligible = records.filter(r => effective(r, month));
    for (const record of eligible) if (dated(record) && dated(record) > (latest.get(group(record)) || '')) latest.set(group(record), dated(record));
    return eligible.filter(r => !dated(r) || dated(r) === latest.get(group(r)));
  }
  function candidates(data, row, context) {
    const pattern = patterns[row.kind];
    if (!pattern || !context.city) return [];
    const city = norm(context.city).replace(/^г[. ]+/, '').replace(/ь$/, ''), supplier = context[row.kind === 'cold' || row.kind === 'sewage' ? 'waterSupplier' : row.kind === 'hot' || row.kind === 'heat' ? 'heatSupplier' : 'gasSupplier'];
    const cityWord = new RegExp('(^|[^а-яa-z])' + city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:ь|я|е|ю|а|ом)?(?=$|[^а-яa-z])', 'i');
    const found = active(data, context.month).filter(record => {
      const description = norm(record.description), kind = norm(record.kind), all = norm([record.title, record.area, record.description, record.criteria].join(' '));
      if (!pattern.test(kind) || /транспортиров/.test(kind) || rate(record, row) === null) return false;
      if (row.kind === 'cold' && /горяч/.test(kind) || row.kind === 'heat' && /горяч/.test(kind)) return false;
      if (/без\s+(?:учета\s+)?(?:ндс|налога на добавленную)/.test(description)) return false;
      const broad = /муниципальные образования.*(?:области|края|республики)|вся территория|территория.*субъекта/.test(norm(record.area));
      if (!cityWord.test(all) && !broad) return false;
      if (/муниципальн.*(?:район|округ)/.test(description) && !cityWord.test(description)) return false;
      if (row.kind !== 'electricity') {
        if (!supplier || record.supplier !== supplier) return false;
        if (!/населени|с\s+(?:учетом\s+)?(?:ндс|налогом)|ндс не облагается/.test(description + ' ' + kind)) return false;
      }
      if (row.kind === 'heat' || row.kind === 'hot') {
        if (context.heatSupply !== 'network') return false;
        if (/коллектор|компенсаци.*потер/.test(description)) return false;
        if (row.kind === 'hot') {
          const component = /компонент/.test(norm(row.title));
          if (!component && record.component) return false;
          if (component && !record.component) return false;
          if (context.hotSystem === 'open' && !/открыт/.test(kind) || context.hotSystem === 'closed' && !/закрыт/.test(kind)) return false;
          if (component && !['open','closed'].includes(context.hotSystem)) return false;
        }
      }
      if (row.kind === 'gas') {
        const usage = norm(record.criteria + ' ' + record.description);
        if (context.gasUse === 'cooking' && (!/приготовлен.*пищ.*газов.*плит/.test(usage) || /водонагревател/.test(usage))) return false;
        if (context.gasUse === 'heater' && (!/газов.*водонагревател/.test(usage) || !/приготовлен.*пищ.*газов.*плит/.test(usage))) return false;
        if (context.gasUse === 'heating' && !/на отопление/.test(usage)) return false;
        if (!['cooking','heater','heating'].includes(context.gasUse) || /сжиженн/.test(kind)) return false;
      }
      if (row.kind === 'electricity') {
        if (!/населени/.test(description) || /юридическ|осужден|исполнител|садовод|религиозн|гараж|воинск/.test(description)) return false;
        if (context.electricCategory === 'ordinary' && /электроплит|электроотоп|сельск/.test(description)) return false;
        if (context.electricCategory === 'electricStove' && !/электроплит/.test(description)) return false;
        if (context.electricCategory === 'rural' && !/сельск/.test(description)) return false;
        if (!['ordinary','electricStove','rural'].includes(context.electricCategory)) return false;
        const band = /перв.{0,8}диапазон/.test(description) ? '1' : /втор.{0,8}диапазон/.test(description) ? '2' : /трет.{0,10}диапазон/.test(description) ? '3' : '';
        if (band && band !== context.electricBand) return false;
        if (context.electricZone === 'single') { if (/дифференцированн|интервал тарифных зон/.test(description + ' ' + norm(record.criteria))) return false; }
        else if (['day','night'].includes(context.electricZone)) { if (!/двум|2 зон/.test(description) || !(context.electricZone === 'day' ? /дневн/ : /ночн/).test(norm(record.criteria))) return false; }
        else return false;
      }
      return true;
    });
    if (row.kind !== 'gas') return found;
    // A later gas price replaces an older open-ended price only for exactly
    // the same supplier, territory and printed usage category.
    const key = r => [r.supplier,r.area,r.kind,r.component,r.stake,r.criteria || r.description].map(norm).join('|');
    const latest = new Map();
    for (const r of found) { const start=r.period.slice(0,10); if(start>(latest.get(key(r))||''))latest.set(key(r),start); }
    return found.filter(r=>r.period.slice(0,10)===latest.get(key(r)));
  }
  function match(data, row, context) {
    if (!patterns[row.kind]) return { status:'separate', candidates:[] };
    const found = candidates(data, row, context), prices = new Set(found.map(record => rate(record, row)));
    return { status: prices.size === 1 ? 'matched' : found.length ? 'ambiguous' : 'missing', record:prices.size === 1 ? found[0] : null, candidates:found };
  }
  function mergeCorrections(data, corrections, region){
    const additions=[];
    const result=data.map(record=>{
      const fix=(corrections.corrections||corrections.records||corrections).find(r=>r.region===region&&r.replacesPriceId===record.priceId);
      if(!fix)return record;
      additions.push({...record,...fix,id:record.id+'-correction',priceId:'correction-'+record.priceId,period:fix.from+' - '+fix.to});
      const until=new Date(Date.parse(fix.from+'T00:00:00Z')-86400000).toISOString().slice(0,10);
      return {...record,period:record.period.slice(0,10)+' - '+until};
    });
    return [...result,...additions];
  }
  const api = { decode, effective, rate, active, candidates, match, mergeCorrections };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  let manifest, records = [], target = null, loadVersion = 0, resultPage = 0;
  const el = id => document.getElementById(id);
  const regionCache = new Map();
  api.regionData = async file => {
    await init();
    if(file?.startsWith('norm:'))throw new Error('В тарифной выгрузке этот регион отсутствует. Его нормативы доступны отдельно; тариф проверьте по своему первоисточнику.');
    if (!file || !manifest.regions.some(r => r.file === file)) throw new Error('Выберите регион');
    if (!regionCache.has(file)) {
      const response = await fetch('data/tariffs/' + file);
      if (!response.ok) throw new Error('Не удалось загрузить ставки региона. Повторите попытку.');
      const raw=decode(await response.json()),correctionResponse=await fetch('data/tariff-corrections.json');
      if(!correctionResponse.ok)throw new Error('Не удалось загрузить уточнения официальных ставок.');
      regionCache.set(file,mergeCorrections(raw,await correctionResponse.json(),manifest.regions.find(r=>r.file===file).name));
    }
    return regionCache.get(file);
  };
  api.reference = (record, row, month) => ({...record, rate:rate(record,row), source:record.sourceUrl||manifest.source, sourceDate:record.sourceDate||manifest.date, month});
  async function init() {
    if (!manifest) {
      try {
        const response = await fetch('data/tariffs/index.json'); if (!response.ok) throw new Error(); manifest = await response.json();
        for (const region of manifest.regions) for (const id of ['tariff-region','region']) { const option = document.createElement('option'); option.value = region.file; option.textContent = region.name; el(id).append(option); }
        // Norms have additional regions that are absent from the tariff snapshot.
        try {
          const response=await fetch('data/norms/index.json');
          if(response.ok)for(const region of (await response.json()).regions)if(!manifest.regions.some(r=>r.name.trim()===region.name.trim())){
            const option=document.createElement('option');option.value='norm:'+region.file;option.textContent=region.name.trim();el('region').append(option);
          }
        }catch{ /* The tariff catalogue remains usable if the norms index is unavailable. */ }
        const link = document.createElement('a'); link.href = manifest.source; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Официальный архив ГИС ЖКХ';
        el('tariff-origin').replaceChildren(link, document.createTextNode(` от ${manifest.date}. В выгрузке ${manifest.regions.length} регионов. Загружается только выбранный регион.`));
      } catch { el('tariff-results').textContent = 'Не удалось загрузить справочник. Попробуйте позже или откройте официальный реестр в разделе помощи.'; throw new Error('tariff_catalog_unavailable'); }
    }
    return manifest;
  }
  async function open(card) {
    target = card; resultPage = 0;
    const dialog = el('tariff-dialog'); if (!dialog.open) dialog.showModal();
    el('tariff-month').value = el('period').value;
    try { await init(); } catch { return; }
    if(el('region').value.startsWith('norm:')){el('tariff-results').textContent='В тарифной выгрузке этот регион отсутствует. Нормативы доступны в разделе «Нормативы и содержание», тариф пока укажите по своему первоисточнику.';return;}
    if (el('region').value !== el('tariff-region').value) { el('tariff-region').value = el('region').value; await loadRegion(); return; }
    search();
  }
  async function loadRegion() {
    const version = ++loadVersion; records = []; resultPage = 0; el('region').value = el('tariff-region').value; document.dispatchEvent(new Event('tariff-region-change')); search();
    if (!el('tariff-region').value) return;
    el('tariff-results').textContent = 'Загружаем ставки региона…';
    try {
      const data = await api.regionData(el('tariff-region').value); if (version !== loadVersion) return; records = data; search();
    } catch { if (version === loadVersion) el('tariff-results').textContent = 'Не удалось загрузить ставки региона.'; }
  }
  function search() {
    const host = el('tariff-results'); host.replaceChildren();
    if (!target) return;
    if (!records.length) { host.textContent = 'Выберите регион.'; return; }
    const row = { ...values(target), unit: target.dataset.unit }, pattern = patterns[row.kind];
    if (!pattern) { host.textContent = 'Выгрузка содержит коммунальные ресурсы. Плату за содержание жилья и взнос на капремонт нужно проверять по отдельным решениям и реестрам.'; return; }
    const query = norm(el('tariff-search').value).split(/\s+/).filter(Boolean), month = el('tariff-month').value;
    const found = active(records, month).filter(r => pattern.test(norm(r.kind + ' ' + r.component)) && !/транспортиров/.test(norm(r.kind)) && !(row.kind === 'cold' && /горяч/.test(norm(r.kind))) && query.every(q => norm([r.title,r.area,r.supplier,r.description,r.criteria,r.component].join(' ')).includes(q)));
    const pages = Math.max(1, Math.ceil(found.length / 2)); resultPage = Math.min(resultPage, pages - 1);
    const count = document.createElement('p'); count.className = 'note'; count.textContent = `Найдено ставок: ${found.length}. Страница ${resultPage + 1} из ${pages}. Уточните город, поставщика и условия.`; host.append(count);
    const pager = document.createElement('div'); pager.className = 'pager';
    for (const [title,delta] of [['←',-1],['→',1]]) { const button=document.createElement('button'); button.className='btn ghost'; button.textContent=title; button.disabled=delta<0?resultPage===0:resultPage===pages-1; button.onclick=()=>{resultPage+=delta;search()}; pager.append(button); } host.append(pager);
    for (const record of found.slice(resultPage * 2, resultPage * 2 + 2)) {
      const option = document.createElement('article'); option.className = 'tariff-option';
      const title = document.createElement('strong'); title.textContent = record.value + ' · ' + (record.component || record.kind); option.append(title);
      for (const text of [record.supplier, record.area, record.description, record.criteria, 'Общий срок тарифа: ' + record.period]) if (text) { const p = document.createElement('p'); p.textContent = text; option.append(p); }
      const details = document.createElement('details'), caption = document.createElement('summary'), law = document.createElement('p'); caption.textContent = record.replacesPriceId?'Основание уточнения ставки':'Основание и идентификатор в ГИС ЖКХ'; law.textContent = record.act + (record.replacesPriceId?'\nУточнена исходная ставка ГИС '+record.replacesPriceId:'\nТариф ' + record.id + ', ставка ' + record.priceId); details.append(caption, law); option.append(details);
      const value = rate(record, row), button = document.createElement('button'); button.className = 'btn ghost'; button.disabled = value === null;
      button.textContent = value === null ? 'Не совпала единица измерения' : 'Это моя ставка и категория - применить';
      button.onclick = () => {
        if (!target.isConnected) target = [...document.querySelectorAll('.review-row')].find(card => card.dataset.entryId === target.dataset.entryId);
        if (!target) { el('tariff-dialog').close(); return; }
        for (const card of document.querySelectorAll('.review-row')) if (card.dataset.official && JSON.parse(card.dataset.official).month !== month) { delete card.dataset.official; card.querySelector('.tariff-choose').textContent = 'Выбрать тариф'; updateReceiptRow(card); }
        el('receipt-review').dataset.period = month; el('receipt-period').textContent = 'Месяц проверки: ' + month;
        target.dataset.official = JSON.stringify(api.reference(record,row,month));
        const choose = target.querySelector('.tariff-choose'); choose.textContent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(value) + ' ₽ · источник'; choose.title = record.description + ' · ' + record.supplier;
        invalidateReceipt(); updateReceiptRow(target); el('tariff-dialog').close();
      };
      option.append(button); host.append(option);
    }
  }
  el('tariff-region').onchange = loadRegion; el('tariff-search').oninput = ()=>{resultPage=0;search()};
  el('region').onchange = ()=>{if(el('region').value.startsWith('norm:')){records=[];el('tariff-region').value='';document.dispatchEvent(new Event('tariff-region-change'));return;}el('tariff-region').value=el('region').value;loadRegion()};
  api.regionForText = text => { const clean = value => norm(value).replace(/область/g,'обл').replace(/[.,]/g,'').replace(/\s+/g,' '); const found=[...el('region').options].filter(r=>r.value&&clean(text).includes(clean(r.textContent))); return found.length===1?found[0].value:''; }; api.open = open; api.init = init; root.Tariffs = api;
})(globalThis);
