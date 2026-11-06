'use strict';
let groundsCatalog,groundsRecords=[],groundsRows=[],groundsLoad=0;
const groundsCache=new Map();
const decodeGrounds=data=>data.rows.map(row=>Object.fromEntries(data.fields.map((field,i)=>[field,data.strings[row[i]]])));
async function openGrounds(){
  const dialog=$('grounds-dialog');if(!dialog.open)dialog.showModal();
  $('grounds-message').textContent='Загружаем нормативы и основания платы…';$('grounds-submit').disabled=true;
  const groundsRegion=$('region').value,groundsMonth=period(),version=++groundsLoad;
  try{
    if(!groundsRegion)throw new Error('Сначала выберите регион в верхней части страницы.');
    if(!groundsCatalog){const r=await fetch('data/norms/index.json');if(!r.ok)throw new Error('Справочник нормативов недоступен. Повторите позже.');groundsCatalog=await r.json();}
    const name=$('region').selectedOptions[0].textContent;
    const region=groundsCatalog.regions.find(r=>r.name.trim()===name.trim());
    let norms=[];
    if(region){if(!groundsCache.has(region.file)){const r=await fetch('data/norms/'+region.file);if(!r.ok)throw new Error('Не удалось загрузить нормативы региона.');groundsCache.set(region.file,decodeGrounds(await r.json()));}norms=groundsCache.get(region.file);}
    const m=await fetch('data/maintenance.json');if(!m.ok)throw new Error('Не удалось загрузить основания содержания жилья.');
    const maintenance=(await m.json()).records.filter(r=>r.region===name);
    if(version!==groundsLoad)return;
    if(groundsRegion!==$('region').value||groundsMonth!==period())throw new Error('Регион или месяц изменился. Откройте проверку заново.');
    groundsRecords=[...norms,...maintenance];
    groundsRows=state.entries.filter(r=>r.enabled&&r.period===period()&&['cold','hot','sewage','electricity','heat','gas','maintenance'].includes(r.kind));
    $('grounds-row').replaceChildren();
    for(const row of groundsRows){const o=node('option',row.title);o.value=row.id;$('grounds-row').append(o);}
    const priority=groundsRows.find(r=>r.method==='normative'||r.mode==='norm')||groundsRows.find(r=>r.kind==='maintenance');
    if(priority)$('grounds-row').value=priority.id;
    $('grounds-message').textContent=`Нормативы: официальный срез ${groundsCatalog.date}. Проверяйте условия, полный месяц и базу расчета. Показания действующего счетчика не нужно заменять нормативом.`;
    updateGroundsRow();$('grounds-submit').disabled=!groundsRows.length;
  }catch(error){if(version===groundsLoad)$('grounds-message').textContent=error.message;}
}
function updateGroundsRow(){
  const row=groundsRows.find(r=>r.id===$('grounds-row').value);if(!row)return;
  const maintenance=row.kind==='maintenance';$('grounds-maintenance').hidden=!maintenance;$('grounds-normative').hidden=maintenance;
  $('grounds-source').replaceChildren(node('option','Выберите применимое основание'));
  $('grounds-source').firstChild.value='';
  const supported=['m3/person/month','m3/m2/month','kwh/person/month','gcal/m2/month','rub/m2/month'];
  for(const ref of groundsRecords.filter(r=>r.kind===row.kind&&supported.includes(r.unit)&&ChargeGrounds.valid(r,row,period())&&!/общедом|содержани[ея].*общ|земельн|надворн|сои/i.test(r.category||''))){
    const units={'m3/person/month':'м³/чел. в месяц','m3/m2/month':'м³/м² в месяц','kwh/person/month':'кВт·ч/чел. в месяц','gcal/m2/month':'Гкал/м² в месяц','rub/m2/month':'₽/м² в месяц'};
    const text=`${ref.value} ${units[ref.unit]} · ${ref.area||ref.city||''} · ${ref.category||''} · ${ref.conditionsText||ref.title}`;
    const option=node('option',text);option.value=ref.id;$('grounds-source').append(option);
  }
  const option=node('option','Моё решение собственников / договор (ввести из документа)');option.value='local';if(maintenance)$('grounds-source').append(option);
  const saved=row.grounds;$('grounds-source').value=saved?.reference?.basis==='owners'||saved?.reference?.basis==='contract'?'local':saved?.reference?.id||'';
  $('grounds-count').value=saved?.count|| (maintenance?state.profile.area:state.profile.residents)||'';
  $('grounds-factor').value=saved?.factor||'';$('grounds-extra').value=saved?.additionalAmount??'';
  $('grounds-confirm').checked=false;$('grounds-full-month').checked=false;$('grounds-municipal').checked=false;
  $('grounds-method').value=saved?.method||(row.method==='normative'||row.mode==='norm'?'normative':'');
  updateGroundsSource();
}
function updateGroundsSource(){
  const id=$('grounds-source').value,ref=groundsRecords.find(r=>r.id===id);
  for(const name of ['grounds-confirm','grounds-full-month','grounds-municipal','grounds-schedule'])$(name).checked=false;
  $('grounds-schedule-label').hidden=!(ref&&(ref.kind==='heat'||ref.unit==='m3/m2/month'));
  $('grounds-local').hidden=id!=='local';$('grounds-municipal-label').hidden=ref?.basis!=='municipality';
  $('grounds-reference').replaceChildren();
  if(ref){$('grounds-reference').append(node('p',[ref.category,ref.title,ref.direction,ref.components,ref.conditionsText].filter(Boolean).join('. ')),node('p',ref.act));const link=node('a','Открыть первоисточник ↗');link.href=ref.sourceUrl;link.target='_blank';link.rel='noopener';$('grounds-reference').append(link);}
  else $('grounds-reference').append(node('p',id==='local'?'Введите ставку из независимого решения или договора. Этот документ проверяется вами, он не подтвержден реестром автоматически.':'Выберите источник. Отсутствие подходящей записи не означает ошибку в квитанции.'));
  const unit=ref?.unit||'';$('grounds-count-label').firstChild.textContent=unit.includes('/person/')?'Число проживающих по основанию':unit.includes('/m2/')?'Площадь по документам, м²':'Подтвержденная база (жители или площадь)';
  $('grounds-count').value=unit.includes('/person/')?state.profile.residents||'':unit.includes('/m2/')?state.profile.area||'':'';
}
$('grounds-form').onsubmit=event=>{
  event.preventDefault();const row=groundsRows.find(r=>r.id===$('grounds-row').value);if(!row)return;
  let reference=groundsRecords.find(r=>r.id===$('grounds-source').value);
  if($('grounds-source').value==='local')reference={id:'local-'+row.id,kind:'maintenance',from:$('grounds-local-from').value,to:$('grounds-local-to').value,value:$('grounds-local-rate').value,unit:'rub/m2/month',scope:'base',basis:'owners',sourceUrl:'local-document',act:$('grounds-local-act').value.trim()};
  if(!reference){$('grounds-message').textContent='Выберите источник для этой услуги.';return;}
  if(!reference.act||!reference.from){$('grounds-message').textContent='Укажите название документа и начало действия ставки.';return;}
  row.grounds={reference:{...reference},count:$('grounds-count').value,factor:$('grounds-factor').value,additionalAmount:$('grounds-extra').value,confirmed:$('grounds-confirm').checked,fullMonth:$('grounds-full-month').checked,municipalApplicable:$('grounds-municipal').checked,scheduleConfirmed:$('grounds-schedule').checked,method:$('grounds-method').value};
  if(row.kind!=='maintenance')row.official=null;
  $('grounds-dialog').close();invalidateReceipt();switchView('result');
};
$('grounds-row').onchange=updateGroundsRow;$('grounds-source').onchange=updateGroundsSource;
for(const id of ['grounds-check','grounds-check-data'])$(id).onclick=openGrounds;
