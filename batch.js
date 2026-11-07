'use strict';
// Conditions are confirmed once. Invoice prices never select an official rate.
let batchRecords=[], batchContext={};
const batchFields=[['city','Город / населенный пункт','text'],['waterSupplier','Поставщик холодной воды и водоотведения','provider'],['heatSupplier','Поставщик тепла и горячей воды','provider'],['gasSupplier','Поставщик газа','provider'],['heatSupply','Получение тепла',[['','Не знаю'],['network','Через тепловую сеть']]],['hotSystem','Система горячей воды',[['','Не знаю'],['open','Открытая'],['closed','Закрытая']]],['gasUse','Использование газа',[['','Не знаю'],['cooking','Только газовая плита'],['heater','Плита и газовый водонагреватель'],['heating','Газовое отопление']]],['electricCategory','Категория электричества',[['','Не знаю'],['ordinary','Город, без льготы за электроплиту'],['electricStove','Стационарная электроплита'],['rural','Сельское население']]],['electricBand','Диапазон потребления',[['','Не знаю'],['1','Первый'],['2','Второй'],['3','Третий']]],['electricZone','Зона электричества',[['','Не знаю'],['single','Одноставочный тариф'],['day','День (две зоны)'],['night','Ночь (две зоны)']]]];
async function openBatch(){
  const dialog=$('batch-dialog'); if(!dialog.open)dialog.showModal();
  const host=$('batch-fields'); host.replaceChildren(); $('batch-message').textContent='Загружаем официальный справочник…'; $('batch-submit').disabled=true;
  const file=$('region').value, month=period();
  if(!file){$('batch-message').textContent='Сначала выберите регион вверху страницы, затем откройте проверку снова.';return;}
  try {
    batchRecords=await Tariffs.regionData(file);
    if(file!==$('region').value||month!==period())throw new Error('Регион или месяц изменился. Откройте проверку заново.');
    const text=state.invoices.filter(d=>d.period===month).map(d=>d.text).join('\n');
    if(!batchContext.city&&/ярославл[ья]/i.test(text))batchContext.city='Ярославль';
    const enabled=new Set(state.entries.filter(r=>r.enabled&&r.period===month).map(r=>r.kind));
    for(const [key,title,type] of batchFields){
      if(key==='waterSupplier'&&![...enabled].some(k=>['cold','sewage'].includes(k)))continue;
      if(['heatSupplier','heatSupply','hotSystem'].includes(key)&&![...enabled].some(k=>['hot','heat'].includes(k)))continue;
      if(['gasSupplier','gasUse'].includes(key)&&!enabled.has('gas'))continue;
      if(key.startsWith('electric')&&!enabled.has('electricity'))continue;
      const label=node('label',title,'fld');let input;
      if(type==='text'){input=document.createElement('input');input.placeholder='Например, Ярославль';input.required=true;}
      else{
        input=document.createElement('select');let options=type;
        if(type==='provider'){
          const kinds=key==='waterSupplier'?/питьев|холодн|водоотвед/i:key==='heatSupplier'?/теплов|горяч/i:/газ/i;
          const names=[...new Set(batchRecords.filter(r=>Tariffs.effective(r,month)&&kinds.test(r.kind)&&r.supplier).map(r=>r.supplier))].sort();
          options=[['','Не знаю / уточню позже'],...names.map(n=>[n,n])];
        }
        for(const [value,title] of options){const option=node('option',title);option.value=value;input.append(option);}
      }
      input.name=key;input.value=batchContext[key]||'';label.append(input);host.append(label);
    }
    $('batch-message').textContent='Укажите условия из договора или квитанции. Если не знаете, оставьте «Не знаю»: неподтвержденную ставку мы не подставим. Условия применяются ко всем услугам выбранного месяца.';
    $('batch-submit').disabled=false;
  }catch(error){$('batch-message').textContent=error.message;}
}
$('batch-form').onsubmit=event=>{
  event.preventDefault();batchContext=Object.fromEntries(new FormData(event.target));
  const context={...batchContext,month:period()};let matched=0,eligible=0;
  const rows=state.entries.filter(r=>r.enabled&&r.period===period());
  const splitElectricity=rows.filter(r=>r.kind==='electricity').length>1;
  for(const row of rows){
    row.official=null;const result=row.mode==='hot'||splitElectricity&&row.kind==='electricity'?{status:'missing'}:Tariffs.match(batchRecords,row,context);row.gisStatus=result.status;
    if(result.status!=='separate')eligible++;
    if(result.status==='matched'){row.official={...Tariffs.reference(result.record,row,period()),context:{...context}};matched++;}
  }
  $('batch-dialog').close();invalidateReceipt();renderAll();switchView('result');
  $('gis-status').textContent=`По условиям найдены ставки для ${matched} из ${eligible} коммунальных услуг. ${matched<eligible?'Для остальных уточните условия или выберите ставку вручную.':'Проверьте источники и распознанные цифры.'} ${splitElectricity?'Электричество разбито на несколько строк: выберите зону и диапазон каждой строки вручную. ':''}Содержание жилья и капремонт проверяются по отдельным основаниям.`;
};
$('gis-check').onclick=()=>{$('conditions-dialog').close();openBatch();};
document.addEventListener('tariff-region-change',()=>{batchContext={};$('gis-status').textContent=$('region').value?'Выберите условия, чтобы сравнить начисления с официальными ставками.':'Сначала выберите регион вверху страницы.';});

document.addEventListener('receipt-clear',()=>{batchContext={};$('gis-status').textContent='Один раз укажите поставщиков и условия для всех услуг месяца.';});
