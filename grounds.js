(function(root){
  'use strict';
  const Calc=typeof module!=='undefined'&&module.exports?require('./calc.js'):root.Zhkh;
  const numeric=value=>{try{return Calc.number(value,'подтвержденное значение');}catch{return null;}};
  function valid(reference,row,month){
    if(!reference?.sourceUrl||!reference.act||reference.kind!==row.kind||!/^20\d{2}-\d{2}$/.test(month)||!reference.from)return false;
    const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
    return month+'-01'>=reference.from&&(!reference.to||end<=reference.to);
  }
  function compatible(row,ref,official){
    const clean=s=>String(s||'').toLowerCase().replace(/ё/g,'е');
    const normText=clean([ref.conditionsText,ref.title,ref.direction].join(' '));
    const tariffText=clean([official.description,official.criteria].join(' '));
    if(row.kind==='gas'){
      if(ref.unit==='m3/m2/month')return /отоплен/.test(tariffText);
      const heater=/плитой и газовым водонагревателем/.test(normText);
      return /приготовлен.*пищ.*газов.*плит/.test(tariffText)&& (heater?/газов.*водонагревател/.test(tariffText):!/водонагревател/.test(tariffText));
    }
    if(row.kind==='electricity'){
      const category=official.context?.electricCategory;
      if(!category)return false;
      if(/электр.*плит/.test(normText)&&category!=='electricStove')return false;
    }
    return true;
  }
  function inspect(row,month){
    const result={checks:[],normChecked:false,maintenanceChecked:false};
    const add=(type,title,detail)=>result.checks.push({type,title,detail,action:'grounds',sourceUrl:row.grounds?.reference?.sourceUrl,sourceAct:row.grounds?.reference?.act});
    const selection=row.grounds;
    if(!selection)return result;
    const ref=selection.reference;
    if(!selection.confirmed||!selection.fullMonth||!valid(ref,row,month)){
      add('missing',row.title+': основание не подтверждено','Выберите действующий источник для этой услуги и месяца и подтвердите его условия.');return result;
    }
    const value=numeric(ref.value),count=numeric(selection.count);
    if(value===null||count===null||count<=0){add('missing',row.title+': укажите базу расчета','Нужны подтвержденные число проживающих или площадь.');return result;}
    let rate,quantity,additional=0;
    if(row.kind==='maintenance'){
      if(ref.unit!=='rub/m2/month'||!['owners','contract','municipality'].includes(ref.basis)){add('missing',row.title+': неподходящее основание','Нужна ставка платы за содержание именно за квадратный метр и применимое решение или договор.');return result;}
      if(ref.basis==='municipality'&&!selection.municipalApplicable){add('missing','Муниципальная ставка подходит не каждому дому','Подтвердите применимость муниципального порядка. Решение собственников или договор могут устанавливать другую плату.');return result;}
      quantity=count;rate=value;
      if(ref.scope!=='total'){
        additional=numeric(selection.additionalAmount);
        if(additional===null){result.maintenanceChecked=false;add('missing','Отделите базовую плату от дополнительных начислений','Муниципальная или договорная базовая ставка не включает автоматически все строки СОИ. Укажите сумму отдельных компонентов, в том числе 0 при их отсутствии.');return result;}
        result.componentsUnverified=true;
        add('missing','Дополнительные компоненты содержания проверяются отдельно','Базовая плата сопоставлена с основанием. СОИ и другие добавленные компоненты требуют собственных объемов, ставок и перерасчетов.');
      }
      const billedArea=numeric(row.quantity);
      if(billedArea!==null&&Math.abs(billedArea-count)>.01)add('warning','Содержание жилья: отличается площадь',`В квитанции ${billedArea} м², по подтвержденным документам ${count} м². Проверьте основание использованной площади.`);
    }else{
      if((row.kind==='heat'||ref.unit==='m3/m2/month')&&!selection.scheduleConfirmed){add('missing',row.title+': подтвердите периодичность','Нужны отопительный сезон либо равномерная оплата за год и соответствующая этому нормативу схема. Полного месяца недостаточно.');return result;}
      if(selection.method!=='normative'){add('missing',row.title+': уточните способ начисления','Норматив нельзя применять к показаниям действующего счетчика или расчету по среднему.');return result;}
      if(!['m3/person/month','m3/m2/month','kwh/person/month','gcal/m2/month'].includes(ref.unit)){add('missing',row.title+': единица норматива не поддержана','Нужен норматив на человека или площадь за месяц.');return result;}
      const requiredUnit=ref.unit.startsWith('m3/')?'м³':ref.unit.startsWith('gcal/')?'Гкал':'кВт·ч';
      if(row.unit!==requiredUnit){add('missing',row.title+': не совпала единица','Норматив и начисление должны иметь одну единицу измерения.');return result;}
      if(ref.unit.includes('/person/')&&!Number.isInteger(count)){add('missing',row.title+': проверьте число проживающих','Число проживающих должно быть целым.');return result;}
      quantity=count*value;
      const printed=numeric(row.quantity);
      result.normChecked=true;
      if(printed!==null&&Math.abs(printed-quantity)>.005)add('warning',row.title+': объем отличается от норматива',`По источнику ${value} × ${count} = ${Number(quantity.toFixed(6))}, в квитанции ${printed}. Учтите полный месяц и основания перерасчета.`);
      const official=row.official;
      if(!official||official.month!==month){add('missing',row.title+': норматив проверен, тариф еще нет','Объем сопоставлен с нормативом. Для независимой проверки суммы выберите подходящую ставку ГИС ЖКХ.');return result;}
      if(!compatible(row,ref,official)){add('missing',row.title+': условия тарифа и норматива не согласованы','Проверьте оборудование и категорию потребителя, затем заново выберите подходящий тариф. Сумму по несовместимым основаниям не подтверждаем.');return result;}
      rate=official.rate;
    }
    const factor=numeric(selection.factor);
    if(factor===null||factor<=0){add('missing',row.title+': подтвердите коэффициент','Укажите коэффициент из применимого основания, включая 1 при его отсутствии.');return result;}
    const calculated=Calc.calculate({...row,mode:'quantity',quantity:String(quantity),rate:String(rate),factor:String(factor),rateBasis:row.kind==='maintenance'?'1':row.rateBasis});
    if(!calculated.ok){add('missing',row.title+': расчет не выполнен',calculated.error);return result;}
    if(row.kind==='maintenance')result.maintenanceChecked=calculated.billed!==null;
    calculated.expected+=Calc.cents(additional);calculated.difference=calculated.billed===null?null:calculated.billed-calculated.expected;
    result.expected=calculated.expected;result.difference=calculated.difference;
    if(calculated.billed===null)add('missing',row.title+': нет начисленной суммы','Введите сумму услуги без долгов и пеней.');
    else add(calculated.difference?'warning':'ok',row.title+(calculated.difference?': отличается от подтвержденного основания':': совпало с подтвержденным основанием'),`Ожидается ${new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(calculated.expected/100)} ₽, начислено ${new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(calculated.billed/100)} ₽. Основание: ${ref.act}. Условия и перерасчеты требуют сверки с документами.`);
    return result;
  }
  const api={valid,compatible,inspect};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ChargeGrounds=api;
})(globalThis);
