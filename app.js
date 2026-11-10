'use strict';
const $=id=>document.getElementById(id),money=v=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(v/100);
const kinds={cold:['Холодная вода','м³'],hot:['Горячая вода','м³'],sewage:['Водоотведение','м³'],electricity:['Электричество','кВт·ч'],heat:['Отопление','Гкал'],gas:['Газ','м³'],maintenance:['Содержание жилья','м²'],capital:['Капремонт','м²'],waste:['Вывоз мусора','ед.'],other:['Другая услуга','ед.']};
const state={entries:[],invoices:[],demo:false,view:'upload',dataPage:0,checksPage:0,docsPage:0,profile:{sameHome:false,area:'',residents:'',meter:'unknown',transfer:'unknown',verification:'unknown'}};
let nextId=0,editingId=null,pendingReceipts=[];
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
function values(card){return Object.fromEntries([...card.querySelectorAll('[data-key]')].map(i=>[i.dataset.key,i.value]))}
function period(){return $('period').value}
function newEntry(data={}){const kind=data.kind||'cold';return {title:kinds[kind][0],unit:kinds[kind][1],id:String(++nextId),period:period(),sourceId:'manual',kind:'cold',mode:'quantity',quantity:'',rate:'',billed:'',correction:'0',factor:'1',rateBasis:'1',enabled:false,...data}}
function ensureManualRows(){for(const [kind,[title,unit]] of Object.entries(kinds))if(kind!=='other'&&!state.entries.some(r=>r.sourceId==='manual'&&r.period===period()&&r.kind===kind))state.entries.push(newEntry({kind,title,unit}))}
function displayedEntries(){const rows=state.entries.filter(r=>r.period===period());if(state.view==='manual')return rows.filter(r=>r.sourceId==='manual');return rows.some(r=>r.sourceId!=='manual')?rows.filter(r=>r.sourceId!=='manual'||r.enabled||r.kind==='other'):rows}
function switchView(view){document.body.dataset.hasEntries=String(state.entries.some(r=>r.enabled));state.view=view;document.body.dataset.screen=view==='upload'?'welcome':'workspace';document.body.dataset.stage=view;document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!=='view-'+(view==='manual'?'data':view));document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===view?'page':'false'));if(view==='data'||view==='manual')renderData();if(view==='result')renderResult();if(view==='documents')renderDocuments();window.scrollTo({top:0,behavior:'instant'})}
function invalidateReceipt(){$('receipt-review').dataset.applied='false';renderResult()}
function saveCard(card){const row=state.entries.find(r=>r.id===card.dataset.entryId);if(!row)return null;Object.assign(row,values(card));row.enabled=card.querySelector('[type=checkbox]').checked;row.official=card.dataset.official?JSON.parse(card.dataset.official):null;return row}
function updateReceiptRow(card){const row=saveCard(card);if(!row)return;const c=Zhkh.calculate(row);const quantityInput=card.querySelector('[data-key=quantity]');quantityInput.readOnly=['meter','norm'].includes(row.mode);if(quantityInput.readOnly){quantityInput.value=c.ok?String(c.quantity):'';quantityInput.title='Расход рассчитывается по показаниям или нормативу в разделе «Ещё»';}const ground=ChargeGrounds.inspect(row,period());const o=row.mode!=='hot'&&row.official&&row.official.month===period()?Zhkh.calculate({...row,rate:String(row.official.rate)}):null;const primary=ground.expected!==undefined?{ok:true,expected:ground.expected,billed:c.billed,difference:ground.difference}:o?.ok?o:c;const scope=card.querySelector('.calculation-scope');if(scope)scope.textContent=!row.enabled?'':ground.expected!==undefined?'По основанию':o?.ok?'ГИС: '+row.official.rate+' ₽':'Тариф не подтверждён';for(const [key,value]of [['calculated',!row.enabled?'':primary.ok?money(primary.expected):'Нет данных'],['arithmetic',!row.enabled?'':primary.ok&&primary.billed!==null?money(primary.difference):'·'],['official',o?.ok?money(o.expected):'Не выбран'],['official-difference',o?.ok&&o.billed!==null?money(o.difference):'·']])card.querySelector('[data-result='+key+']').textContent=value;card.classList.toggle('inactive',!row.enabled);card.classList.toggle('needs-review',row.enabled&&(!c.ok||Zhkh.mismatch(c.difference)));card.querySelector('[data-result=arithmetic]').classList.toggle('mismatch',Boolean(primary.ok&&Zhkh.mismatch(primary.difference)));renderResult();updateOfficialSummary()}
function editRow(id){editingId=id;const row=state.entries.find(r=>r.id===id);$('row-title').textContent=row.title||kinds[row.kind][0];$('row-fields').replaceChildren();const fields=[['mode','Способ расчета',[['quantity','Объем × тариф'],['meter','Разница показаний × тариф'],['norm','Проживающие × норматив × тариф'],['hot','ГВС: два компонента']]],['quantity','Объем / площадь'],['rate','Тариф'],['billed','Начислено за услугу'],['correction','Перерасчет, ₽ (+ или -)'],['factor','Повышающий коэффициент'],['rateBasis','Тариф за',[['1','1 единицу'],['1000','1000 единиц (газ)']]],['previous','Предыдущие показания'],['current','Текущие показания'],['residents','Число проживающих'],['norm','Норматив на человека'],['coefficient','Коэффициент норматива'],['heatPerCube','Гкал на м³'],['heatRate','Тариф на тепло, ₽/Гкал']];for(const[key,title,options]of fields){const label=node('label',title,'fld'),input=document.createElement(options?'select':'input');input.dataset.key=key;if(options)for(const[value,text]of options){const option=node('option',text);option.value=value;input.append(option)}else{input.type='text';input.inputMode='decimal'}input.value=row[key]??(key==='coefficient'?'1':'');label.append(input);$('row-fields').append(label)}function modeFields(){const mode=$('row-fields').querySelector('[data-key=mode]').value;for(const label of $('row-fields').children){const key=label.querySelector('[data-key]').dataset.key;label.hidden=(key==='rateBasis'&&row.kind!=='gas')||(['previous','current'].includes(key)&&mode!=='meter')||(['residents','norm','coefficient'].includes(key)&&mode!=='norm')||(['heatPerCube','heatRate'].includes(key)&&mode!=='hot')||(key==='quantity'&&['norm','meter'].includes(mode))}}$('row-fields').querySelector('[data-key=mode]').onchange=modeFields;modeFields();$('row-dialog').showModal()}
function reviewRow(row){const card=node('tr',undefined,'review-row');card.dataset.entryId=row.id;card.dataset.title=row.title||kinds[row.kind][0];card.dataset.unit=row.unit||kinds[row.kind][1];if(row.official)card.dataset.official=JSON.stringify(row.official);const service=node('td'),line=node('div',undefined,'service-name'),check=document.createElement('input');check.type='checkbox';check.checked=row.enabled;check.setAttribute('aria-label','Включить '+card.dataset.title);line.append(check);const select=document.createElement('select');select.dataset.key='kind';select.setAttribute('aria-label','Услуга');for(const[value,[label]]of Object.entries(kinds)){const o=node('option',value===row.kind?card.dataset.title:label);o.value=value;select.append(o)}select.value=row.kind;line.append(select);service.append(line,node('small',card.dataset.unit),node('small','По цифрам квитанции','calculation-scope'));const source=state.invoices.find(d=>d.id===row.sourceId);if(source)service.append(node('small',source.name,'row-source'));const basis=document.createElement('input');basis.type='hidden';basis.dataset.key='rateBasis';basis.value=row.rateBasis||'1';service.append(basis);card.append(service);check.onchange=()=>{invalidateReceipt();updateReceiptRow(card);editedReceipt()};select.onchange=()=>{row.kind=select.value;row.grounds=null;row.title=kinds[row.kind][0];row.unit=kinds[row.kind][1];if(row.kind!=='gas')row.rateBasis='1';row.official=null;invalidateReceipt();renderData();scheduleTariffCheck()};for(const[key,title]of [['quantity','Объем'],['rate','Тариф, ₽'],['billed','Начислено, ₽']]){const td=node('td');td.dataset.label=title;const input=document.createElement('input');input.type='text';input.inputMode='decimal';input.dataset.key=key;input.value=row[key]||'';input.setAttribute('aria-label',title+' · '+card.dataset.title);if(key==='quantity')td.dataset.label='Объем, '+card.dataset.unit;if(key==='rate')td.dataset.label='Тариф, ₽/'+(row.rateBasis==='1000'?'1000 ':'')+card.dataset.unit;input.oninput=()=>{check.checked=true;invalidateReceipt();updateReceiptRow(card);editedReceipt()};td.append(input);card.append(td)}for(const name of ['calculated','arithmetic']){const td=node('td',undefined,'numeric');td.dataset.result=name;td.dataset.label=name==='calculated'?'По расчёту':'Разница';card.append(td)}const tariff=node('td'),choose=node('button',row.official?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:6}).format(row.official.rate)+' ₽ · источник':'Выбрать','tariff-choose');choose.onclick=()=>Tariffs.open(card);tariff.append(choose);card.append(tariff);for(const name of ['official','official-difference']){const td=node('td',undefined,'numeric');td.dataset.result=name;card.append(td)}const more=node('td'),edit=node('button','Ещё','text-button');edit.onclick=()=>editRow(row.id);more.append(edit);card.append(more);$('receipt-preview').append(card);updateReceiptRow(card)}
function pager(prefix,page,count,size,setter){const pages=Math.max(1,Math.ceil(count/size)),current=Math.min(page,pages-1);$(prefix+'-page').parentElement.hidden=pages===1;$(prefix+'-page').textContent=count?`${current*size+1}–${Math.min((current+1)*size,count)} из ${count}`:'Нет данных';$(prefix+'-prev').disabled=current===0;$(prefix+'-next').disabled=current===pages-1;$(prefix+'-prev').onclick=()=>setter(current-1);$(prefix+'-next').onclick=()=>setter(current+1);return current}
function renderData(){ensureManualRows();renderSource();const rows=displayedEntries(),size=innerWidth<=680?(rows.every(r=>r.sourceId==='manual')?9:4):9;state.dataPage=pager('data',state.dataPage,rows.length,size,p=>{state.dataPage=p;renderData()});$('receipt-preview').replaceChildren();rows.slice(state.dataPage*size,(state.dataPage+1)*size).forEach(reviewRow);updateOfficialSummary()}
function updateOfficialSummary(){const rows=state.entries.filter(r=>r.enabled&&r.period===period()),selected=rows.filter(r=>r.mode!=='hot'&&r.official&&r.official.month===period());$('official-summary').textContent=`Официальные ставки выбраны для ${selected.length} из ${rows.filter(r=>!['maintenance','capital','other'].includes(r.kind)).length} коммунальных услуг. Содержание жилья и капремонт имеют отдельные основания. Объемы и перерасчеты проверяются отдельно.`;const sources=$('official-sources');sources.hidden=!selected.length;sources.querySelector('div').replaceChildren();for(const row of selected){const o=row.official,p=node('p',`${row.title}: ${o.value}. ${o.supplier}. ${o.description}. ${o.act}. ${o.replacesPriceId?"Уточнение исходной ставки "+o.replacesPriceId:"Ставка "+o.priceId}. `),link=node('a','Первоисточник ставки от '+o.sourceDate);link.href=o.source;link.target='_blank';link.rel='noopener';p.append(link);sources.querySelector('div').append(p)}}
function analysis(){return ReceiptAnalysis.check(state.entries,state.invoices,state.profile,period())}
function renderResult(refreshRows=true){const r=analysis();$('view-result').dataset.verified=String(r.eligible>0&&r.officialCount===r.eligible&&r.compared===r.rows&&!r.checks.some(c=>c.type==='warning'));const warnings=r.checks.filter(c=>c.type==='warning').length;$('coverage').textContent=(state.demo?'Учебный пример · ':'')+`${r.compared}/${r.rows} начислений сравнено · ${r.officialCount} тарифов с установленными условиями · ${Math.max(0,r.rows-r.officialCount-r.maintenanceCount)} ставок не подтверждено${r.normCount?" · нормативов: "+r.normCount:""}${r.maintenanceCount?" · содержание проверено":""}`;$('verdict').textContent=!r.rows?'Добавьте цифры квитанции':r.compared<r.rows?'Дополните непрочитанные суммы':warnings||Zhkh.mismatch(r.primaryDifference)?(r.primaryDifference?'Найдена разница '+money(r.primaryDifference):'Есть расхождения'):r.officialCount<r.eligible?'Арифметика сходится, тарифы не подтверждены':'Сравнение выполнено: смотрите статус каждой услуги';$('total-billed').textContent=r.compared?money(r.billed):'Нет данных';$('total-calculated').textContent=r.compared?money(r.primaryExpected):'Нет данных';$('total-difference').textContent=r.compared?money(r.primaryDifference):'Нет данных';$('comparison-scope').textContent=`Арифметика: ${r.compared} из ${r.rows} услуг. Официальные тарифы: ${r.officialCount?'сверено '+r.officialCount:'не сверены'}. `+(r.compared<r.rows?'В суммы ниже входят только строки с объемом, тарифом и начислением. Дополните остальные строки.':'Цена и условия показаны отдельно в каждой строке. При неизвестных условиях сумма ориентировочная. Долг и пени не включены.');$('total-official').textContent=r.officialCount?money(r.officialDifference):'Не проверено';$('total-official').classList.toggle('pending',!r.officialCount);const checks=r.checks.length?r.checks:[{type:'missing',title:'Начните с квитанции или ручного ввода',detail:'Можно добавить несколько поставщиков и разные месяцы. Цифры распределятся по периодам.',action:'data'}];const checkSize=Math.max(1,checks.length);state.checksPage=pager('checks',state.checksPage,checks.length,checkSize,p=>{state.checksPage=p;renderResult()});$('checks').replaceChildren();$('extra-checks').replaceChildren();for(const c of checks.slice(state.checksPage*checkSize,state.checksPage*checkSize+checkSize)){const card=node('article',undefined,'check '+c.type),button=node('button',c.action==='grounds'?'Что проверено':c.action==='tariff'?'Условия сравнения':c.action==='profile'?'Уточнить данные':c.action==='consult'?'Что делать':'Посмотреть','text-button');button.onclick=()=>c.action==='grounds'?openGrounds():c.action==='tariff'?openBatch():c.action==='profile'?$('profile-dialog').showModal():c.action==='consult'?switchView('help'):c.action==='documents'?switchView('documents'):switchView('data');card.append(node('h2',c.title),node('p',c.detail),button);if(c.sourceUrl?.startsWith('https://')){const link=node('a','Первоисточник ↗','text-button');link.href=c.sourceUrl;link.target='_blank';link.rel='noopener';card.append(link)}$(c.type==='missing'&&c.action!=='data'?'extra-checks':'checks').append(card)}$('result-scope').textContent='Проверена арифметика по '+(state.invoices.length?'распознанным':'введенным')+' цифрам. Это не подтверждает правильность тарифа или фактический расход. Разница - повод запросить пояснение расчета.';if(refreshRows)renderResultRows();$('request').textContent=r.checks.filter(c=>c.type==='warning').map(c=>`Прошу пояснить расчет за ${period()}. ${c.title}. ${c.detail}`).join('\n\n')||'По проверенным данным вопросы о расхождениях пока не сформированы.'}
function renderDocuments(){$('document-count').textContent=state.invoices.length;$('document-count').hidden=!state.invoices.length;state.docsPage=pager('docs',state.docsPage,state.invoices.length,4,p=>{state.docsPage=p;renderDocuments()});$('documents').replaceChildren();for(const doc of state.invoices.slice(state.docsPage*4,state.docsPage*4+4)){const card=node('article',undefined,'document-row'),label=node('label',doc.assumedPeriod?'Подтвердите месяц':'Месяц'),input=document.createElement('input');input.type='month';input.value=doc.period;input.onchange=()=>{if(!input.value)return;doc.period=input.value;doc.assumedPeriod=false;for(const row of state.entries.filter(r=>r.sourceId===doc.id)){row.period=doc.period;row.official=null;row.grounds=null}setPeriod(doc.period)};label.append(input);const text=node('button','Фрагмент','text-button');text.onclick=()=>openSource(doc);const remove=node('button','Удалить','text-button');remove.onclick=()=>{$('receipt-images').replaceChildren();$('receipt-text').textContent='';state.invoices=state.invoices.filter(d=>d.id!==doc.id);state.entries=state.entries.filter(r=>r.sourceId!==doc.id);invalidateReceipt();renderAll()};card.append(node('strong',doc.name),node('span',`Строк: ${state.entries.filter(r=>r.sourceId===doc.id).length}`),label,text,remove);$('documents').append(card)}if(!state.invoices.length)$('documents').append(node('p','Можно загрузить квитанции разных поставщиков и за другие месяцы.','note'))}
function scheduleTariffCheck(){if(typeof scheduleAutomaticTariffs==='function')scheduleAutomaticTariffs();}
function editedReceipt(){const feedback=$('edit-feedback');if(feedback)feedback.textContent='Расчёт обновлён. Сравниваем с суммой в колонке «Начислено».';scheduleTariffCheck();}
function setPeriod(value){$('period').value=value;$('receipt-review').dataset.period=value;state.dataPage=0;state.checksPage=0;renderAll();scheduleTariffCheck()}
// Цифры ручного ввода привязаны к месяцу: при смене месяца форма пустеет, поэтому показываем, где они, и даём перенести.
function offerManualMove(){const status=$('upload-status'),to=period(),rows=state.entries.filter(r=>r.enabled&&r.sourceId==='manual'),from=[...new Set(rows.map(r=>r.period))];if(status.dataset.move){uploadStatus('');delete status.dataset.move}if(from.length!==1||from[0]===to||state.entries.some(r=>r.enabled&&r.period===to))return;const name=p=>new Date(p+'-01').toLocaleDateString('ru-RU',{month:'long',year:'numeric'}).replace(' г.','');uploadStatus(`За ${name(to)} цифр нет. Введённые цифры записаны на ${name(from[0])}.`);status.dataset.move='1';const move=node('button','Перенести их на '+name(to),'text-button');move.type='button';move.onclick=()=>{state.entries=state.entries.filter(r=>r.sourceId!=='manual'||r.period!==to);for(const row of rows){row.period=to;row.official=null;row.grounds=null}setPeriod(to);offerManualMove()};status.append(' ',move)}
function renderAll(){ensureManualRows();renderData();renderDocuments();renderResult()}
async function importFiles(files) {
  if (!files.length || $('receipt-file').disabled) return;
  if(!$('region').value){uploadStatus('Выберите регион над загрузкой. Он нужен для подбора официальных источников.');$('region').focus();return;}
  const job = ++receiptJob, queue=createReceiptQueue(job), tasks=[], reservedIds=new Set(state.invoices.map(d=>d.id));
  pendingReceipts=[];
  let added = 0, duplicates = 0, skipped = 0;
  const noRows = [], errors = [];
  const selected = [...files].slice(0, 10);
  $('cancel-upload').hidden = false;
  $('receipt-file').disabled = true;
  try {
    for (const [index, file] of selected.entries()) {
      if (job !== receiptJob) break;
      const fileNumber = index + 1;
      try {
        uploadStatus(`Файл ${fileNumber} из ${selected.length}. Выберите таблицу начислений`);
        if (file.size > 15 * 1024 * 1024) throw new Error('больше 15 МБ');
        const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (!pdf && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('нужен JPG, PNG, WebP или PDF');
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const id = Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
        if (job !== receiptJob) break;
        if (reservedIds.has(id)) { duplicates++; continue; }reservedIds.add(id);
        $('crop-title').textContent=`Файл ${fileNumber} из ${selected.length}: выделите начисления`;
        const staged = pdf ? await readPdf(file, job, queue) : await readPhoto(file, job, queue);
        const task=Promise.resolve(staged.pending||staged).then(read=>{
        if (job !== receiptJob) return;
        if (read.skipped) { skipped++; return; }
        if (!read.text.trim()) throw new Error('нет читаемого текста');
        const parsed = Receipt.parse(read.text, read.pages);
        if (!parsed.rows.length) {
          pendingReceipts.push({id,name:'Квитанция '+fileNumber+' · ручной перенос',period:read.period||period(),text:read.text,previews:read.previews||[],facts:ReceiptAnalysis.facts(read.text)});
          noRows.push(fileNumber);
          return;
        }
        if (state.demo) {
          state.entries = [];
          state.demo = false;
        }
        const month = read.period || parsed.period || period();
        const assumedPeriod = Boolean(read.period && parsed.period && read.period !== parsed.period) || (!read.period && !parsed.period);
        state.invoices.push({id, name: 'Квитанция ' + (state.invoices.length + 1) + (pdf ? ' · PDF' : ' · фото'), period: month, assumedPeriod, metadata:read.metadata||[ReceiptContext.extract(read.text)], previews:read.previews||[], text: read.text, facts: ReceiptAnalysis.facts(read.text)});
        for (const row of parsed.rows) state.entries.push(newEntry({...row, sourceId: id, period: month, enabled: true}));
        added++;

        const suggestedRegion = Tariffs.regionForText(read.text);
        if (suggestedRegion && !$('region').value) {
          $('region').value = suggestedRegion;
          $('region').dispatchEvent(new Event('change'));
        }
        setPeriod(month);
        }).catch(error=>{if(job===receiptJob)errors.push(`Файл ${fileNumber}: ${error.message}`);});
        tasks.push(task);
      } catch (error) {
        if (job !== receiptJob) break;
        errors.push(`Файл ${fileNumber}: ${error.message}`);
      }
    }
    await Promise.allSettled(tasks);
  } finally {
    const ownsQueue=receiptQueue===queue;
    queue.close();
    if(ownsQueue){
      $('receipt-file').disabled = false;
      $('receipt-file').value = '';
      $('cancel-upload').hidden = true;
    }
    if (job === receiptJob) {
      renderAll();
      if (added) {
        setPeriod(state.invoices.map(d => d.period).sort().at(-1));
        switchView('result');
      }
      const status = [];
      if (added) status.push(`Добавлено: ${added}. Цифры перенесены, расчёт выполнен.`);
      if (noRows.length) status.push(`Не найдены строки начислений в файлах № ${noRows.join(', ')}. Текст прочитан. Выберите квитанцию заново и выделите заголовки столбцов вместе со строками начислений.`);
      if (errors.length) status.push('Не прочитано. ' + errors.join('. ') + '.');
      if (duplicates) status.push(`Повторных файлов: ${duplicates}.`);
      if (skipped) status.push(`Пропущено: ${skipped}.`);
      if (files.length > selected.length) status.push('За раз читаем первые 10 файлов. Остальные добавьте следующей загрузкой.');
      uploadStatus(status.join(' '));
      if (noRows.length) {
        const retry = node('button', 'Выбрать квитанцию заново', 'text-button');
        retry.type = 'button';
        retry.onclick = () => $('receipt-file').click();
        $('upload-status').append(' ', retry);for(const doc of pendingReceipts){const manual=node('button','Внести строки: '+doc.name,'text-button');manual.onclick=()=>{if(state.invoices.some(d=>d.id===doc.id))return;if(state.demo){state.entries=[];state.demo=false;}state.invoices.push(doc);pendingReceipts=pendingReceipts.filter(d=>d.id!==doc.id);manual.disabled=true;setPeriod(doc.period);$('source-document').value=doc.id;switchView('data');$('source-add').click();};$('upload-status').append(' ',manual);}
      }
    }
  }
}
$('receipt-file').onclick=e=>{if(!$('region').value){e.preventDefault();uploadStatus('Сначала выберите регион над загрузкой.');$('region').focus();}};$('receipt-file').onchange=e=>importFiles(e.target.files);$('upload-more').onclick=()=>$('receipt-file').click();$('manual-start').onclick=()=>switchView('manual');$('home-open').onclick=()=>switchView('upload');$('cancel-upload').onclick=()=>{receiptJob++;cancelReceiptQueue();ReceiptCrop.cancel();if(receiptWorker){receiptWorker.terminate();receiptWorker=null}uploadStatus('Чтение отменено. Уже добавленные квитанции сохранены.')};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>switchView(button.dataset.view);
$('period').onchange=()=>{if(period()){setPeriod(period());offerManualMove()}};$('result-details').onclick=()=>switchView('data');$('add-row').onclick=()=>{state.entries.push(newEntry({kind:'other',title:'Другая услуга',unit:'ед.',enabled:true}));state.dataPage=Math.floor((displayedEntries().length-1)/(innerWidth<=680?4:9));renderData()};
$('row-save').onclick=()=>{const row=state.entries.find(r=>r.id===editingId);Object.assign(row,values($('row-fields')));if(row.kind!=='gas')row.rateBasis='1';row.enabled=true;row.official=null;row.grounds=null;$('row-dialog').close();invalidateReceipt();renderData();scheduleTariffCheck()};$('row-tariff').onclick=()=>{$('row-save').click();const card=[...document.querySelectorAll('.review-row')].find(c=>c.dataset.entryId===editingId);if(card)Tariffs.open(card)};
$('profile-open').onclick=()=>{$('same-home').checked=state.profile.sameHome;$('actual-area').value=state.profile.area;$('residents').value=state.profile.residents;$('meter').value=state.profile.meter;$('transfer').value=state.profile.transfer;$('verification').value=state.profile.verification;$('profile-dialog').showModal();};$('profile-form').onsubmit=e=>{e.preventDefault();state.profile={sameHome:$('same-home').checked,area:$('actual-area').value.replace(',','.'),residents:$('residents').value,meter:$('meter').value,transfer:$('transfer').value,verification:$('verification').value};$('profile-dialog').close();invalidateReceipt()};for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
$('clear-all').onclick=()=>{if(!confirm('Удалить все загруженные квитанции и введенные данные? Восстановить их после очистки нельзя.'))return;receiptJob++;cancelReceiptQueue();ReceiptCrop.cancel();if(receiptWorker){receiptWorker.terminate();receiptWorker=null;}state.entries=[];state.invoices=[];pendingReceipts=[];$('entry-supplier').value='';$('receipt-images').replaceChildren();state.demo=false;state.profile={sameHome:false,area:'',residents:'',meter:'unknown',transfer:'unknown',verification:'unknown'};$('profile-form').reset();document.dispatchEvent(new Event('receipt-clear'));$('receipt-text').textContent='';$('row-fields').replaceChildren();editingId=null;renderAll();switchView('upload');uploadStatus('Данные очищены.')};$('example').onclick=()=>{if((state.invoices.length||state.entries.some(r=>r.enabled)||!$('cancel-upload').hidden)&&!state.demo&&!confirm('Открыть учебный пример? Текущие данные проверки будут очищены.'))return;if(!$('cancel-upload').hidden)$('cancel-upload').click();document.dispatchEvent(new Event('receipt-clear'));state.demo=true;pendingReceipts=[];$('receipt-images').replaceChildren();state.entries=[];state.invoices=[];state.profile={sameHome:false,area:'',residents:'',meter:'unknown',transfer:'unknown',verification:'unknown'};$('receipt-text').textContent='';$('period').value='2026-10';ensureManualRows();state.entries.push(newEntry({sourceId:'demo',title:'Холодная вода · пример',kind:'cold',unit:'м³',quantity:'8',rate:'48.41',billed:'407.28',enabled:true}),newEntry({sourceId:'demo',title:'Электричество · пример',kind:'electricity',unit:'кВт·ч',quantity:'180',rate:'6.3',billed:'1134',enabled:true}),newEntry({sourceId:'demo',title:'Содержание жилья · пример',kind:'maintenance',unit:'м²',quantity:'50',rate:'30.28',billed:'1514',enabled:true}));const region=[...$('region').options].find(o=>o.textContent==='Ярославская область');if(region){$('region').value=region.value;$('region').dispatchEvent(new Event('change'));}renderAll();switchView('result')};
$('print').onclick=()=>window.print();$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('request').textContent);$('copy-status').textContent='Вопросы скопированы. Проверьте текст перед отправкой.'}catch{$('copy-status').textContent='Откройте вопросы и скопируйте текст вручную.'}};$('theme').onclick=()=>{const html=document.documentElement,dark=html.dataset.theme?html.dataset.theme==='dark':matchMedia('(prefers-color-scheme:dark)').matches;html.dataset.theme=dark?'light':'dark'};
const contactText=$('contact-text').textContent.trim();$('telegram-contact').href='https://t.me/pyankov_vv?text='+encodeURIComponent(contactText);async function copyContact(){try{await navigator.clipboard.writeText(contactText);$('contact-status').textContent='Если поле Telegram пустое, вставьте скопированный текст.'}catch{$('contact-draft').open=true}}$('copy-contact').onclick=copyContact;$('consult').href=$('telegram-contact').href;
// Квитанция приходит за прошедший месяц, поэтому по умолчанию - предыдущий.
{const d=new Date();d.setDate(0);$('period').value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')}
renderAll();Tariffs.init().catch(()=>{$('region').options[0].textContent='Справочник временно недоступен'});

document.addEventListener('tariff-region-change',()=>{for(const row of state.entries){row.official=null;row.grounds=null;};invalidateReceipt();renderData();scheduleTariffCheck()});

$('show-result').onclick=()=>switchView('result');

for(const id of ['conditions-open','data-conditions'])$(id).onclick=()=>$('conditions-dialog').showModal();
$('conditions-profile').onclick=()=>{$('conditions-dialog').close();$('profile-open').click();};
const dropZone=$('drop-zone');
for(const type of ['dragenter','dragover'])dropZone.addEventListener(type,event=>{event.preventDefault();dropZone.classList.add('dragging');});
for(const type of ['dragleave','drop'])dropZone.addEventListener(type,event=>{event.preventDefault();dropZone.classList.remove('dragging');});
dropZone.addEventListener('drop',event=>{if(event.dataTransfer?.files.length)importFiles(event.dataTransfer.files);});

function sourceImages(host,doc){host.replaceChildren();for(const src of doc.previews||[]){const image=document.createElement('img');image.src=src;image.alt='Выделенная таблица начислений';host.append(image);}}
function openSource(doc){$('source-zoom').value=100;$('receipt-text').textContent=doc.text;sourceImages($('receipt-images'),doc);$('text-dialog').showModal();}
function renderSource(){
  const docs=state.invoices.filter(d=>d.period===period()),select=$('source-document'),selected=select.value;
  $('source-review').hidden=!docs.length;select.replaceChildren();
  for(const doc of docs){const option=node('option',doc.name);option.value=doc.id;select.append(option);}
  if(docs.some(d=>d.id===selected))select.value=selected;
  const doc=docs.find(d=>d.id===select.value);if(!doc){$('source-images').replaceChildren();return;}
  sourceImages($('source-images'),doc);
  $('source-status').textContent=`Перенесено строк: ${state.entries.filter(r=>r.sourceId===doc.id).length}. Сравните каждую услугу, единицу, объем, тариф, начисление и перерасчет с фрагментом. Не найденную строку добавьте ниже.`;
}
$('source-document').onchange=renderSource;

$('source-add').onclick=()=>{const doc=state.invoices.find(d=>d.id===$('source-document').value);if(!doc)return;const row=newEntry({kind:'other',sourceId:doc.id,title:'Пропущенная услуга',enabled:true});state.entries.push(row);state.dataPage=Math.floor((displayedEntries().length-1)/(innerWidth<=680?4:9));invalidateReceipt();renderData();scheduleTariffCheck();};

$('source-open').onclick=()=>{const doc=state.invoices.find(d=>d.id===$('source-document').value);if(doc)openSource(doc);};
$('source-zoom').oninput=()=>{for(const image of $('receipt-images').children)image.style.width=$('source-zoom').value+'%';};

function renderResultRows(){
  const host=$('result-rows');host.replaceChildren();
  const head=node('div',undefined,'result-columns');head.setAttribute('role','row');
  for(const label of ['Услуга','Объём','Тариф квитанции, ₽','Начислено, ₽','Проверка, ₽','Результат']){const cell=node('span',label);cell.setAttribute('role','columnheader');head.append(cell);}host.append(head);
  for(const row of state.entries.filter(r=>r.enabled&&r.period===period())){
    const card=node('article',undefined,'result-row'),service=node('div',undefined,'result-service'),fields=node('div',undefined,'result-fields');card.setAttribute('role','row');
    const source=state.invoices.find(d=>d.id===row.sourceId),title=node('strong',row.title);
    service.append(title,node('small',row.unit+(row.rateBasis==='1000'?' · тариф за 1000':'')));
    if(source){const show=node('button','Фрагмент','text-button');show.title=source.name;show.onclick=()=>openSource(source);service.append(show);}
    const edit=node('button','Ещё','text-button');edit.onclick=()=>editRow(row.id);service.append(edit);card.append(service);
    const calculated=node('span',undefined,'result-number'),difference=node('strong',undefined,'result-number'),formula=node('small',undefined,'row-formula'),status=node('small',undefined,'row-status'),reference=node('small',undefined,'row-reference');
    const refresh=()=>{
      const arithmetic=Zhkh.calculate(row),official=row.mode!=='hot'&&row.official?.month===period()?row.official:row.suggested?.month===period()?row.suggested:null,c=official?Zhkh.calculate({...row,rate:String(official.rate)}):arithmetic;
      calculated.textContent=c.ok?money(c.expected).replace(/\s*₽$/,''):'Нет данных';
      formula.textContent=c.ok?(official?(official.assumed?'Предварительно по ГИС: ':'По тарифу ГИС: '):'По квитанции: ')+c.formula:c.error;calculated.append(formula);calculated.title=formula.textContent;
      difference.textContent=c.ok&&c.billed!==null?money(c.difference).replace(/\s*₽$/,''):'Не сравнили';
      status.textContent=!c.ok?'Дополните цифры':c.billed===null?'Введите начисление':Zhkh.mismatch(c.difference)?'Есть расхождение':official?(official.assumed?'Условия не подтверждены':'Условия установлены'):(c.difference?'Сходится с точностью до округления':'Арифметика верна')+'; ставка не проверена';difference.append(status);
      difference.classList.toggle('mismatch',Zhkh.mismatch(c.difference));difference.classList.toggle('matched',Boolean(official&&!official.assumed&&c.ok&&c.billed!==null&&!Zhkh.mismatch(c.difference)));
      reference.replaceChildren();
      if(official){const rateEqual=Math.abs(Number(String(row.rate).replace(',','.'))-Number(official.rate))<0.000001;const link=node('a',(rateEqual?'Цена совпала: ':'Цена отличается: ')+official.rate+' ₽');link.title=official.supplier+' · '+official.act;link.href=official.source;link.target='_blank';link.rel='noopener';reference.append(link);}
      else reference.textContent=['maintenance','capital','other'].includes(row.kind)?'Основание ставки не найдено':'Официальная ставка не найдена';
      reference.title=official?[official.supplier,official.act,official.description].filter(Boolean).join('. '):'Проверена только арифметика. В подключённых данных нет подтверждения ставки. Это ограничение проверки, а не ошибка начисления. Документы искать не требуется.';
    };card.refreshResult=refresh;
    for(const [key,label] of [['quantity','Объём, '+row.unit],['rate','Тариф, ₽'],['billed','Начислено, ₽']]){
      const field=node('label',undefined,'fld'),input=document.createElement('input');input.type='text';input.inputMode='decimal';input.value=row[key]??'';input.dataset.key=key;input.placeholder='—';input.setAttribute('aria-label',label+' · '+row.title);
      if(key==='quantity'&&['meter','norm'].includes(row.mode)){input.readOnly=true;const c=Zhkh.calculate(row);input.value=c.ok?c.quantity:'';}
      input.oninput=()=>{row[key]=input.value;renderResult(false);refresh();editedReceipt();};field.append(input);if(key==='rate')field.append(reference);fields.append(field);
    }
    card.append(fields,calculated,difference);refresh();
    if(Number(row.correction))service.append(node('small','Перерасчёт '+money(Number(row.correction)*100)));
    host.append(card);
  }
}

document.addEventListener('tariff-region-change',async()=>{
  const file=$('region').value;if(file&&/^(Сначала выберите|Выберите регион)/.test($('upload-status').textContent))uploadStatus('');$('entry-providers').replaceChildren();$('entry-supplier').value='';
  if(!file||file.startsWith('norm:'))return;
  try{const records=await Tariffs.regionData(file);if(file!==$('region').value)return;for(const name of [...new Set(records.map(r=>r.supplier).filter(Boolean))].sort()){const option=document.createElement('option');option.value=name;option.label=shortSupplier(name);$('entry-providers').append(option);}}catch{ /* Manual organisation entry remains available. */ }
});

document.addEventListener('automatic-tariffs-result',()=>{for(const card of $('result-rows').querySelectorAll('article'))card.refreshResult?.();});

document.addEventListener('automatic-tariffs-result',()=>{if(!['manual','data'].includes(state.view))return;for(const card of $('receipt-preview').children){const row=state.entries.find(r=>r.id===card.dataset.entryId);if(!row?.enabled)continue;if(row.official)card.dataset.official=JSON.stringify(row.official);else delete card.dataset.official;updateReceiptRow(card);}});
