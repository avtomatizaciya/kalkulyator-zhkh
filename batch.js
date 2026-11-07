'use strict';
// Conditions are confirmed once. Invoice prices never select an official rate.
let batchRecords=[], batchContext={};
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
function batchNames(key,month){return [...new Set(batchRecords.filter(r=>Tariffs.effective(r,month)&&supplierKinds[key].test(r.kind)&&r.supplier).map(r=>r.supplier))].sort();}
function rememberKnownSuppliers(month){
  const chosen=$('entry-supplier').value.trim().toLowerCase();
  const text=state.invoices.filter(d=>d.period===month).map(d=>d.text).join(' ').toLowerCase();
  for(const key of Object.keys(supplierKinds)){
    if(batchContext[key])continue;
    const found=batchNames(key,month).filter(name=>name.toLowerCase()===chosen||text.includes(name.toLowerCase()));
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
    batchMissing=batchNeeded(rows).filter(([key])=>!batchContext[key]);
    const context={...batchContext,month},splitElectricity=rows.filter(r=>r.kind==='electricity').length>1;
    let matched=0,eligible=0;const unresolved=[];
    for(const row of rows){
      // Preserve a separately chosen official reference; only replace automatic matches.
      if(row.official&&!row.official.automatic&&row.official.month===month)continue;
      row.official=null;
      const result=row.mode==='hot'||splitElectricity&&row.kind==='electricity'?{status:'missing'}:Tariffs.match(records,row,context);
      row.gisStatus=result.status;if(result.status!=='separate'){eligible++;if(result.status!=='matched')unresolved.push(row);}
      if(result.status==='matched'){row.official={...Tariffs.reference(result.record,row,month),context:{...context},automatic:true};matched++;}
    }
    const patterns={cold:/питьев|холодн/i,sewage:/водоотвед/i,heat:/теплов/i,hot:/горяч/i,gas:/газ/i,electricity:/электр/i,waste:/отход|тко/i};
    batchMissing=batchNeeded(unresolved.filter(row=>records.some(r=>patterns[row.kind]?.test(r.kind)&&Tariffs.effective(r,month)&&Tariffs.rate(r,row)!==null))).filter(([key])=>!batchContext[key]);
    batchNotice=eligible>matched&&!batchMissing.length?'Для остальных услуг нет однозначно применимой ставки в справочнике.':'';
    renderAutomaticTariffs();
    $('gis-status').textContent=`Официальные тарифы: сверено ${matched} из ${eligible}. `+(batchMissing.length?'Для остальных нужны: '+batchMissing.map(f=>f[1].toLowerCase()).join(', ')+'.':batchNotice);
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
    else{input=document.createElement('select');const options=type==='provider'?[['','Не знаю / уточню позже'],...batchNames(key,period()).map(n=>[n,n])]:type;for(const [value,title] of options){const option=node('option',title);option.value=value;input.append(option);}}
    input.name=key;input.value=batchContext[key]||'';
    input.onchange=()=>{batchContext[key]=input.value;automaticTariffs();};
    label.append(input);host.append(label);
  }
  $('batch-message').textContent='Условия сверки можно исправить. Результат обновляется сразу после изменения.';
  $('batch-submit').disabled=false;
}
$('batch-form').onsubmit=event=>{event.preventDefault();Object.assign(batchContext,Object.fromEntries(new FormData(event.target)));$('batch-dialog').close();automaticTariffs();};
$('gis-check').onclick=()=>{$('conditions-dialog').close();openBatch();};
$('entry-supplier').addEventListener('change',()=>{for(const key of Object.keys(supplierKinds))delete batchContext[key];scheduleAutomaticTariffs();});
document.addEventListener('tariff-region-change',()=>{batchVersion++;batchContext={};for(const row of state.entries)if(row.official?.automatic)row.official=null;scheduleAutomaticTariffs();});
document.addEventListener('receipt-clear',()=>{batchVersion++;clearTimeout(batchTimer);batchContext={};batchMissing=[];});

function renderAutomaticTariffs(){
  const host=$('automatic-tariffs');if(!host)return;
  host.hidden=!batchMissing.length&&!batchNotice;
  const signature=batchMissing.map(f=>f[0]).join('|')+'|'+$('region').value+'|'+batchNotice;
  if(host.dataset.fields===signature)return;
  host.dataset.fields=signature;host.replaceChildren();
  if(batchNotice)host.append(node('p',batchNotice,'note'));
  if(!batchMissing.length)return;
  host.append(node('p','Для сверки тарифов уточните только эти условия. Результат обновится автоматически.','note'));
  const fields=node('div',undefined,'grid');host.append(fields);
  for(const [key,title,type] of batchMissing){
    const label=node('label',title,'fld');let input;
    if(type==='text'){input=document.createElement('input');input.placeholder='Населённый пункт';}
    else{input=document.createElement('select');const options=type==='provider'?[['','Выберите поставщика'],...batchNames(key,period()).map(n=>[n,n])]:type;for(const [value,title] of options){const option=node('option',title);option.value=value;input.append(option);}}
    input.name=key;input.value=batchContext[key]||'';
    input.onchange=()=>{batchContext[key]=input.value;scheduleAutomaticTariffs();};label.append(input);fields.append(label);
  }
}
