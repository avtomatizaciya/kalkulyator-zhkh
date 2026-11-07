'use strict';
// Conditions are confirmed once. Invoice prices never select an official rate.
let batchRecords=[], batchContext={}, batchSuggestions={},batchEvidence=null;
const batchFields=[['city','Город / населенный пункт','text'],['waterSupplier','Поставщик холодной воды и водоотведения','provider'],['heatSupplier','Поставщик тепла и горячей воды','provider'],['gasSupplier','Поставщик газа','provider'],['heatSupply','Получение тепла',[['','Не знаю'],['network','Через тепловую сеть']]],['hotSystem','Система горячей воды',[['','Не знаю'],['open','Открытая'],['closed','Закрытая']]],['gasUse','Использование газа',[['','Не знаю'],['cooking','Только газовая плита'],['heater','Плита и газовый водонагреватель'],['heating','Газовое отопление']]],['electricCategory','Категория электричества',[['','Не знаю'],['ordinary','Город, без льготы за электроплиту'],['electricStove','Стационарная электроплита'],['rural','Сельское население']]],['electricBand','Диапазон потребления',[['','Не знаю'],['1','Первый'],['2','Второй'],['3','Третий']]],['electricZone','Зона электричества',[['','Не знаю'],['single','Одноставочный тариф'],['day','День (две зоны)'],['night','Ночь (две зоны)']]]];

let batchVersion=0,batchTimer,batchMissing=[],batchNotice="";
const supplierKinds={waterSupplier:/питьев|холодн|водоотвед/i,heatSupplier:/теплов|горяч/i,gasSupplier:/газ/i};
function batchNeeded(rows){
  const kinds=new Set(rows.map(r=>r.kind)),keys=new Set();
  if(rows.some(r=>!['maintenance','capital','other'].includes(r.kind)))keys.add('city');
  if(kinds.has('cold')||kinds.has('sewage'))keys.add('waterSupplier');
  if(kinds.has('heat')||kinds.has('hot')){keys.add('heatSupplier');keys.add('heatSupply');}
  if(kinds.has('hot'))keys.add('hotSystem');
  if(kinds.has('gas')){keys.add('gasSupplier');keys.add('gasUse');}
  if(kinds.has('electricity'))for(const k of ['electricCategory','electricBand','electricZone'])keys.add(k);
  return batchFields.filter(([key])=>keys.has(key));
}
function shortSupplier(value){return value.replace(/ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ/gi,'ООО').replace(/ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО/gi,'ПАО').replace(/ОТКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО/gi,'ОАО').replace(/АКЦИОНЕРНОЕ ОБЩЕСТВО/gi,'АО').replace(/МУНИЦИПАЛЬНОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ/gi,'МУП').replace(/ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ/gi,'ГУП').replace(/ГОСУДАРСТВЕННОЕ ПРЕДПРИЯТИЕ/gi,'ГП');}
function batchNames(key,month){return [...new Set(batchRecords.filter(r=>Tariffs.effective(r,month)&&supplierKinds[key].test(r.kind)&&r.supplier).map(r=>r.supplier))].sort();}
function rememberKnownSuppliers(month){
  const chosen=$('entry-supplier').value.trim().toLowerCase();
  const text=state.invoices.filter(d=>d.period===month).map(d=>d.text).join(' ').toLowerCase();
  const metadata=state.invoices.filter(d=>d.period===month).flatMap(d=>d.metadata||[ReceiptContext.extract(d.text)]);
  for(const key of ['city','gasUse']){const values=[...new Set(metadata.map(m=>m[key]).filter(Boolean))];if(!batchContext[key]&&values.length===1)batchContext[key]=values[0];}
  for(const key of Object.keys(supplierKinds)){
    if(batchContext[key])continue;
    const role={waterSupplier:/водоканал|водоснаб/i,heatSupplier:/тгк|генерир|тепл/i,gasSupplier:/газ/i}[key];
    const found=batchNames(key,month).filter(name=>name.toLowerCase()===chosen||text.includes(name.toLowerCase())||metadata.some(m=>m.companies.some(c=>role.test(c)&&ReceiptContext.supplierMatches(name,c))));
    if(found.length===1)batchContext[key]=found[0];
  }
}
function scheduleAutomaticTariffs(){batchVersion++;clearTimeout(batchTimer);batchTimer=setTimeout(()=>automaticTariffs(),180);}
async function automaticTariffs(){
  const version=++batchVersion,file=$('region').value,month=period();
  const rows=state.entries.filter(r=>r.enabled&&r.period===month);
  if(!file||!rows.length){batchMissing=[];batchNotice="";renderAutomaticTariffs();return;}
  batchNotice="";
  try{
    const records=await Tariffs.regionData(file);
    if(version!==batchVersion||file!==$('region').value||month!==period())return;
    batchRecords=records;rememberKnownSuppliers(month);
    batchEvidence=ReceiptContext.evidence(state.invoices.filter(d=>d.period===month).flatMap(d=>d.metadata||[]),rows,month,file);
    const known={...batchEvidence?.context,...batchContext};
    batchSuggestions=ReceiptContext.suggest(rows,known,records,month);
    batchMissing=batchNeeded(rows).filter(([key])=>!known[key]);
    const context={...known,month},splitElectricity=rows.filter(r=>r.kind==='electricity').length>1;
    let matched=0,eligible=0;const unresolved=[];
    for(const row of rows){
      row.suggested=null;
      // Preserve a separately chosen official reference; only replace automatic matches.
      if(row.official&&!row.official.automatic&&row.official.month===month)continue;
      row.official=null;
      const result=row.mode==='hot'||splitElectricity&&row.kind==='electricity'?{status:'missing'}:Tariffs.match(records,row,context);
      row.gisStatus=result.status;if(result.status!=='separate'){eligible++;if(result.status!=='matched')unresolved.push(row);}
      if(result.status==='matched'){row.official={...Tariffs.reference(result.record,row,month),context:{...context},automatic:true};matched++;}
      else if(result.status!=='separate'&&row.mode!=='hot'&&!(splitElectricity&&row.kind==='electricity')){const preview=Tariffs.match(records,row,{...batchSuggestions,...context});if(preview.status==='matched')row.suggested={...Tariffs.reference(preview.record,row,month),assumed:true};}
    }
    const patterns={cold:/питьев|холодн/i,sewage:/водоотвед/i,heat:/теплов/i,hot:/горяч/i,gas:/газ/i,electricity:/электр/i,waste:/отход|тко/i};
    batchMissing=batchNeeded(unresolved.filter(row=>records.some(r=>patterns[row.kind]?.test(r.kind)&&Tariffs.effective(r,month)&&Tariffs.rate(r,row)!==null))).filter(([key])=>!known[key]);
    batchNotice=eligible>matched&&!batchMissing.length?'Для остальных услуг нет однозначно применимой ставки в справочнике.':'';
    renderAutomaticTariffs();
    $('gis-status').textContent=`Официальные тарифы: сверено ${matched} из ${eligible}. `+(batchMissing.length?'Не установлены автоматически: '+batchMissing.map(f=>f[1].toLowerCase()).join(', ')+'.':batchNotice);
    if(typeof renderResult==='function')renderResult(false);
    document.dispatchEvent(new CustomEvent('automatic-tariffs-result',{detail:{matched,eligible,missing:batchMissing.map(([key,title])=>({key,title}))}}));
  }catch(error){if(version===batchVersion){batchMissing=[];batchNotice='Не удалось загрузить официальные тарифы: '+error.message;renderAutomaticTariffs();$('gis-status').textContent=batchNotice;document.dispatchEvent(new CustomEvent('automatic-tariffs-result',{detail:{error:error.message,missing:[]}}));}}
}
async function openBatch(){
  const dialog=$('batch-dialog');if(!dialog.open)dialog.showModal();
  $('batch-submit').disabled=true;$('batch-message').textContent='Проверяем известные условия…';
  await automaticTariffs();
  const host=$('batch-fields');host.replaceChildren();
  for(const [key,title,type] of batchNeeded(state.entries.filter(r=>r.enabled&&r.period===period()))){
    const label=node('label',title,'fld');let input;
    if(type==='text'){input=document.createElement('input');input.placeholder='Населённый пункт';}
    else{input=document.createElement('select');const options=type==='provider'?[['','Не знаю / уточню позже'],...batchNames(key,period()).map(n=>[n,shortSupplier(n)])]:type;for(const [value,title] of options){const option=node('option',title);option.value=value;input.append(option);}}
    input.name=key;input.value=batchContext[key]||batchEvidence?.context[key]||batchSuggestions[key]||'';
    input.onchange=()=>{batchContext[key]=input.value;automaticTariffs();};
    label.append(input);host.append(label);
  }
  $('batch-message').textContent='Необязательно: меняйте только известные вам условия. Предложенные значения не подтверждаются при закрытии окна. Документы искать не нужно.';
  if(batchEvidence){const h=batchEvidence.house;for(const [url,title]of [[h.source,'Паспорт дома от '+h.sourceDate],[h.corroboration,'Публикация УК об испытаниях сетей, 2026'],[h.waterSource,'Тарифы вашей УК с 01.10.2026'],[h.electricSource,'Диапазоны и ставки электричества, 2026']]){const a=node('a',title+' ↗','evidence-link');a.href=url;a.target='_blank';a.rel='noopener';host.append(a);}}
  $('batch-submit').disabled=false;
}
$('batch-form').onsubmit=event=>{event.preventDefault();$('batch-dialog').close();automaticTariffs();};
$('gis-check').onclick=()=>{$('conditions-dialog').close();openBatch();};
$('entry-supplier').addEventListener('change',()=>{for(const key of Object.keys(supplierKinds))delete batchContext[key];scheduleAutomaticTariffs();});
document.addEventListener('tariff-region-change',()=>{batchVersion++;batchContext={};for(const row of state.entries)if(row.official?.automatic)row.official=null;scheduleAutomaticTariffs();});
document.addEventListener('receipt-clear',()=>{batchVersion++;clearTimeout(batchTimer);batchContext={};batchMissing=[];});

function renderAutomaticTariffs(){
  const host=$('automatic-tariffs');if(!host)return;
  host.hidden=!batchMissing.length&&!batchNotice&&!batchEvidence;
  const signature=batchMissing.map(f=>f[0]).join('|')+'|'+$('region').value+'|'+batchNotice+'|'+JSON.stringify(batchSuggestions)+'|'+Boolean(batchEvidence);
  if(host.dataset.fields===signature)return;
  host.dataset.fields=signature;host.replaceChildren();
  const required=batchMissing.filter(([key])=>!batchSuggestions[key]);
  const message=required.length?'Автоматически не установлены: '+required.map(f=>f[1].toLowerCase()).join(', '):batchEvidence?'Источник условий: паспорт дома от '+batchEvidence.house.sourceDate+'. '+(batchMissing.length?'Не подтверждено: '+batchMissing.map(f=>f[1].toLowerCase()).join(', '):'Условия найдены.'):'Цена сравнивается с опубликованной ставкой. Применимость к вашему дому не подтверждена.';
  host.append(node('p',batchNotice||message,'note'));
  const edit=node('button','Условия и источники','text-button');edit.onclick=openBatch;host.append(edit);
}
