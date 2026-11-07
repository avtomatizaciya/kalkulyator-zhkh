(function(root){
  'use strict';
  const normal=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^а-яa-z0-9]/g,'');
  // Only service metadata and a public building ID survive; no apartment or resident data.
  function extract(text){
    const city=[...text.matchAll(/(?:^|[\s,])г(?:ород)?[.\s]+([А-ЯЁ][а-яё]+(?:-[А-ЯЁа-яё]+)?)/g)].filter(m=>! /банк|бик|корр|филиал/i.test(text.slice(Math.max(0,m.index-100),m.index))).map(m=>m[1]);
    const companies=[...text.matchAll(/(?:ООО|ПАО|ОАО|АО|МУП|ГУП)\s*[«"“]([^»"”\n]{3,100})[»"”]/gi)].map(m=>m[1]);
    const usage=/Плита\s+с\s+ЦГВ|Оборудование\s*:\s*плита/i.test(text)?'cooking':'';
    const house=(root.HouseEvidence||[]).filter(h=>normal(text).includes(normal(h.city))&&new RegExp('(?:ул[.\\s]*'+h.street+'|'+h.street+'\\s+ул[.]?)[,\\s]*(?:д[.]?\\s*)?'+h.number+'(?=[,\\s]|$)(?!\\s*(?:к(?:орп)?[.]?\\s*\\d|[а-я]))','i').test(text));
    return {city:[...new Set(city)].length===1?city[0]:house.length===1?house[0].city:'',companies,gasUse:usage,houseId:house.length===1?house[0].key:''};
  }
  function evidence(metadata,rows,month,regionFile){
    const ids=[...new Set(metadata.map(m=>m.houseId).filter(Boolean))],house=ids.length===1?(root.HouseEvidence||[]).find(h=>h.key===ids[0]):null;
    if(!house||house.regionFile!==regionFile||month<'2026-10'||month>'2026-12')return null;
    const context={city:house.city,waterSupplier:house.waterSupplier,heatSupply:house.heatSupply,hotSystem:house.hotSystem};
    if(metadata.some(m=>m.gasUse==='cooking'))context.electricCategory='ordinary';
    const electric=rows.filter(r=>r.kind==='electricity'),quantity=electric.reduce((s,r)=>s+Number(String(r.quantity).replace(',','.')),0);
    if(electric.length&&electric.every(r=>r.mode==='quantity'&&r.quantity!=='')&&quantity>=0&&quantity<=3900)context.electricBand='1';
    return {context,house};
  }
  function supplierMatches(name,company){
    const short=name.match(/[«"]([^»"]+)[»"]/);const n=normal(short?short[1]:name),c=normal(company);
    return c.length>3&&(n===c||(/^тгк\d+$/.test(c)&&n===normal('ТЕРРИТОРИАЛЬНАЯ ГЕНЕРИРУЮЩАЯ КОМПАНИЯ №'+c.replace('тгк',''))));
  }
  function suggest(rows,context,records,month){
    const defaults={heatSupply:'network',hotSystem:rows.some(r=>/теплоноситель/i.test(r.title))?'open':'closed',gasUse:'cooking',electricCategory:'ordinary',electricBand:'1',electricZone:'single'};
    if(context.city){
      const city=normal(context.city);
      const names=[...new Set(records.filter(r=>/питьев|холодн|водоотвед/i.test(r.kind)&&root.Tariffs.effective(r,month)&&normal(r.supplier).includes(city+'водоканал')).map(r=>r.supplier))];
      if(names.length===1)defaults.waterSupplier=names[0];
    }
    const keys=new Set(rows.flatMap(r=>r.kind==='gas'?['city','gasSupplier','gasUse']:r.kind==='heat'?['city','heatSupplier','heatSupply']:r.kind==='hot'?['city','heatSupplier','heatSupply','hotSystem']:r.kind==='electricity'?['city','electricCategory','electricBand','electricZone']:['cold','sewage'].includes(r.kind)?['city','waterSupplier']:[]));
    return Object.fromEntries(Object.entries(defaults).filter(([k])=>keys.has(k)&&!context[k]));
  }
  const api={extract,supplierMatches,suggest,evidence};if(typeof module!=='undefined')module.exports=api;root.ReceiptContext=api;
})(typeof globalThis!=='undefined'?globalThis:this);
