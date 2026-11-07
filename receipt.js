(function (root) {
  'use strict';
  const names = [['cold', /холодн\S*\s+вод|\bхвс\b/i], ['hot', /горяч\S*\s+вод|\bгвс\b/i], ['sewage', /водоотвед|канализац/i], ['electricity', /электроэнерг|электрич/i], ['heat', /отоплен/i], ['gas', /газоснабжен|поставка\s+природного\s+газа/i], ['maintenance', /содержание\s+(?:жил|помещ)|содерж\S*\s+и\s+ремонт/i], ['capital', /кап\S*\s+ремонт|капремонт/i], ['waste', /обращение\s+с\s+тко|вывоз\s+(?:мусор|тко)/i]];
  const numbers = text => (text.match(/\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d+|\d+[,.]\d+|\d+/g) || []).map(s => Number(s.replace(/\s/g, '').replace(',', '.')));
  function tableRows(pages) {
    const rows = [];
    for (const page of pages || []) {
      // PDF text runs can contain both a unit and its value, or a grouped amount.
      const words = (page.words || []).flatMap(w => [...w.text.matchAll(/\S+/g)].map(m => ({ ...w, text: m[0], x: w.x + (w.w || 0) * m.index / w.text.length })));
      const anchor = label => words.find(w => w.text === label);
      const tariff = anchor('Тариф');
      const epd = words.some(w => w.text === 'Компенсация') && words.some(w => /(?:Вид )?платежа/.test(w.text));
      const heat = words.some(w => w.text === 'Vотоп./') && words.some(w => w.text === 'Всего');
      const volume = tariff && words.find(w => w.text === 'Объем' && (epd || w.x < tariff.x) && Math.abs(w.y - tariff.y) < 12);
      if (!tariff || !volume) continue;
      if (!epd && !heat) continue;
      const totals = words.filter(w => w.text === (epd ? 'Итого' : 'Всего') && w.x > tariff.x && w.y >= tariff.y - 2 && w.y < tariff.y + 35).sort((a, b) => a.x - b.x);
      const final = totals.at(-1);
      const base = epd ? anchor('Стоимость') : words.find(w => w.text === 'Начислено' && Math.abs(w.y - tariff.y) < 12) || totals[0];
      if (!base || !final) continue;
      const lines = [];
      for (const word of words) {
        let line = lines.find(l => Math.abs(l.y - word.y) < 2);
        if (!line) { line = { y: word.y, words: [] }; lines.push(line); }
        line.words.push(word);
      }
      for (const line of lines.sort((a, b) => a.y - b.y)) {
        if (line.y < tariff.y + 20) continue;
        const ws = line.words.sort((a, b) => a.x - b.x);
        const label = ws.filter(w => w.x < tariff.x - (epd ? 35 : 110)).map(w => w.text).join(' ');
        if (/^Итого|^ИТОГО/.test(label)) break;
        if (/в\s*т\.?\s*ч\.?/i.test(label)) continue;
        const found = names.find(([, pattern]) => pattern.test(label));
        const component = /ГВС компонент на (тепловую энергию|теплоноситель)/i.test(label);
        if (!found && !component && (!epd || !/[а-я]/i.test(label))) continue;
        const cell = (left, right) => {
          const text = ws.filter(w => w.x >= left && w.x < right).map(w => w.text).join('').replace(/\s/g, '').replace(/−/g, '-').replace(',', '.');
          return /^-?\d+(?:\.\d+)?$/.test(text) ? text : '';
        };
        const quantity = cell(volume.x - (epd ? 14 : 24), epd ? base.x - 3 : tariff.x - 12);
        const rate = cell(tariff.x - 10, tariff.x + 32);
        const billed = cell(final.x - 10, final.x + (epd ? 32 : 45));
        const original = cell(base.x - (epd ? 3 : 10), base.x + (epd ? 35 : 28));
        // Corrections have their own printed columns. Never infer one from a mismatch.
        const correctionValues = ws.filter(w => w.x >= base.x + (epd ? 35 : 28) && w.x < final.x - 10);
        const corrections = []; let pending = '';
        for (const w of correctionValues) {
          pending += w.text.replace(/\s/g, '');
          if (/[,.]\d{2}$/.test(pending)) { corrections.push(Number(pending.replace('−', '-').replace(',', '.'))); pending = ''; }
        }
        if (pending || corrections.some(v => !Number.isFinite(v))) continue;
        if (!quantity || !rate || !billed || !original) continue;
        const correction = corrections.reduce((a, b) => a + b, 0);
        if (Math.abs(Number(original) + correction - Number(billed)) > .011) continue;
        const printedUnit = ws.find(w => w.x < volume.x && /^(?:м[23³²]\.?|Гкал|кВт\/ч|кВт·ч)$/i.test(w.text))?.text || '';
        const unit = /^м2/.test(printedUnit) ? 'м²' : /^м3/.test(printedUnit) ? 'м³' : printedUnit.replace('кВт/ч', 'кВт·ч');
        rows.push({ kind: component ? 'hot' : found?.[0] || 'other', mode: 'quantity', quantity, rate, billed, correction: String(correction), rateBasis: '1', title: label.replace(/^.*?(?=Отопление)/, ''), unit, confidence: 'table' });
      }
    }
    return rows;
  }
  function croppedTableRows(pages) {
    const rows=[];
    for(const page of pages||[]) {
      const words=(page.words||[]).flatMap(w=>[...w.text.matchAll(/\S+/g)].map(m=>({...w,text:m[0],x:w.x+(w.w||0)*m.index/w.text.length}))).filter(w=>! /^[|!]+$/.test(w.text));
      const financial=words.filter(w=>/\d[.,]\d/.test(w.text)&&w.h>0);
      const heights=(financial.length>=3?financial:words).map(w=>w.h).filter(h=>h>0).sort((a,b)=>a-b),height=heights[Math.floor(heights.length/2)]||10;
      const epdHeader=words.some(w=>/^платежа$/i.test(w.text))&&words.some(w=>/^(?:тарифу|населения)$/i.test(w.text))&&words.some(w=>/^Перерасчеты/i.test(w.text));
      if(epdHeader){
        const lines=[];
        for(const word of words){let line=lines.find(l=>Math.abs(l.y-word.y)<=height*.5);if(!line){line={y:word.y,words:[]};lines.push(line)}line.words.push(word)}
        for(const line of lines.sort((a,b)=>a.y-b.y)){
          const ws=line.words.sort((a,b)=>a.x-b.x),unit=ws.find(w=>/^(?:м[23³²]\.?|кВт\/ч|кВт·ч)$/i.test(w.text));
          if(!unit)continue;
          const label=ws.filter(w=>w.x<unit.x&&!/^[−\-\d.,]+$/.test(w.text)).map(w=>w.text).join(' ');
          if(/в\s*т\.?\s*ч\.?/i.test(label))continue;
          const found=names.find(([,pattern])=>pattern.test(label));
          const kind=found?.[0]||(/^Техническое обслуживание ВКГО$/i.test(label)?'other':'');
          if(!kind)continue;
          const cells=[];
          for(const w of ws.filter(w=>/^[−\-\d.,]+$/.test(w.text))){const last=cells.at(-1);if(last&&w.x-last.right<height*.9){last.text+=w.text;last.right=w.x+(w.w||0)}else cells.push({x:w.x,right:w.x+(w.w||0),text:w.text})}
          for(const c of cells)c.text=c.text.replace(/−/g,'-').replace(',','.');
          const numericCells=cells.filter(c=>!/^[-—]$/.test(c.text));
          if(numericCells.some(c=>! /^-?\d+(?:\.\d+)?$/.test(c.text)))continue;
          const before=numericCells.filter(c=>c.right<=unit.x),after=numericCells.filter(c=>c.x>unit.x+(unit.w||0));
          // Printed EPD order: code, tariff, optional normative, unit, volume, cost, corrections, final.
          const rate=before.find(c=>/\./.test(c.text));if(!rate||after.length<3){rows.push({kind,mode:'quantity',quantity:'',rate:rate?.text||'',billed:'',correction:'0',rateBasis:'1',title:label,unit:unit.text,confidence:'partial'});continue;}
          const [quantity,original]=after,final=after.at(-1),correction=after.slice(2,-1).reduce((a,c)=>a+Number(c.text),0);
          if(Math.abs(Number(original.text)+correction-Number(final.text))>.011){rows.push({kind,mode:'quantity',quantity:quantity.text,rate:rate.text,billed:'',correction:String(correction),rateBasis:'1',title:label,unit:unit.text,confidence:'partial'});continue;}
          rows.push({kind,mode:'quantity',quantity:quantity.text,rate:rate.text,billed:final.text,correction:String(correction),rateBasis:'1',title:label,unit:unit.text.replace(/^м2\.?$/,'м²').replace(/^м3\.?$/,'м³').replace('кВт/ч','кВт·ч'),confidence:'table'});
        }
        continue;
      }
      const find=pattern=>words.find(w=>pattern.test(w.text));
      const tariff=find(/^Тариф$/i),volume=find(/^Об[ъь]?[её]м$/i),base=find(/^Стоимость$/i)||find(/^Начислено$/i);
      const epd=Boolean(find(/^Стоимость$/i)&&find(/^платежа$/i));
      const heat=Boolean(find(/отоп.*\//i));
      let final=find(epd?/^Итого$/i:/^Всего$/i);
      if(!final&&!epd){const tail=find(/^сего$/i),head=tail&&words.find(w=>/^В$/i.test(w.text)&&Math.abs(w.y-tail.y)<height&&w.x<tail.x&&tail.x-w.x<height*2);if(head)final={...head,w:tail.x+(tail.w||0)-head.x};}
      // The older thermal form prints eleven column numbers below the headers.
      // Its first "Всего" is before corrections; the final amount is column 11.
      const numberedEnd=heat&&tariff&&words.find(w=>w.text==='11'&&w.y>tariff.y&&w.y<tariff.y+height*14);
      let numbered=numberedEnd?Array.from({length:11},(_,i)=>words.find(w=>w.text===String(i+1)&&Math.abs(w.y-numberedEnd.y)<height*.5)):null;
      if(numbered?.some((w,i)=>!w||(i&&w.x<=numbered[i-1].x)))numbered=null;
      if(!tariff||!volume||(!numbered&&(!base||!final))||(!epd&&!heat))continue;
      // Header centres define the columns at any OCR raster scale. Never derive values from arithmetic.
      const centre=w=>w.x+(w.w||0)/2;
      const corrections=heat&&!numbered?words.filter(w=>/^Пере-$/i.test(w.text)&&w.x>base.x&&w.x<final.x):[];
      const anchors=numbered?Object.entries({quantity:3,rate:5,original:8,correction0:9,correction1:10,billed:11}).map(([key,column])=>({key,column,word:numbered[column-1]})):[{key:'quantity',word:volume},{key:'rate',word:tariff},{key:'original',word:base},...corrections.map((word,i)=>({key:'correction'+i,word})),{key:'billed',word:final}].sort((a,b)=>centre(a.word)-centre(b.word));
      if(new Set(anchors.map(a=>centre(a.word))).size!==anchors.length)continue;
      const lines=[];
      for(const word of words){let line=lines.find(l=>Math.abs(l.y-word.y)<=height*.65);if(!line){line={y:word.y,words:[]};lines.push(line)}line.words.push(word)}
      const headerBottom=Math.max(...anchors.map(a=>a.word.y+(a.word.h||height)));
      for(const line of lines.sort((a,b)=>a.y-b.y)) {
        if(line.y<=headerBottom+height*.3)continue;
        const ws=line.words.sort((a,b)=>a.x-b.x),first=anchors[0];
        const printedUnit=ws.find(w=>/^(?:м[23³²]\.?|Гкал|кВт\/ч|кВт·ч)$/i.test(w.text));
        const label=ws.filter(w=>centre(w)<Math.min(centre(first.word)-height,printedUnit?.x??Infinity)).map(w=>w.text).join(' ');
        if(/^Итого|^Всего|^Справоч|^Примечан/i.test(label))break;
        if(/в\s*т\.?\s*ч\.?/i.test(label))continue;
        const found=names.find(([,pattern])=>pattern.test(label)),component=/ГВС\s+компонент\s+на\s+(?:теплов|теплоносител)/i.test(label);
        if(!found&&!component)continue;
        const values={};let ambiguous=false;
        for(let i=0;i<anchors.length;i++) {
          const a=anchors[i],unitHeader=find(/^(?:Ед\.?|изм\.?)$/i);
          const previous=numbered?numbered[a.column-2]:anchors[i-1]?.word||unitHeader;
          const next=numbered?numbered[a.column]:anchors[i+1]?.word;
          const left=previous?(centre(previous)+centre(a.word))/2:centre(a.word)-height*3;
          const right=next?(centre(a.word)+centre(next))/2:centre(a.word)+height*4;
          // Separate printed correction columns must not be swallowed into an amount cell.
          const cell=ws.filter(w=>centre(w)>=left&&centre(w)<right&&/^[−\-\d.,]+$/.test(w.text)).map(w=>w.text).join('').replace(/−/g,'-').replace(',','.');
          if(!cell&&a.key.startsWith('correction')){values[a.key]='0';continue}
          if(!/^-?\d+(?:\.\d+)?$/.test(cell)){ambiguous=true;values[a.key]='';continue}values[a.key]=cell;
        }
        const correction=Object.entries(values).filter(([key])=>key.startsWith('correction')).reduce((a,[,v])=>a+Number(v),0);
        if(values.original&&values.billed&&Math.abs(Number(values.original)+correction-Number(values.billed))>.011){values.billed='';ambiguous=true;}
        if(heat&&/^\d{7,}$/.test(values.quantity)){values.quantity='';ambiguous=true;}
        const unit=ws.find(w=>/^(?:м[23³²]\.?|Гкал|кВт\/ч|кВт·ч)$/i.test(w.text))?.text||'';
        rows.push({kind:component?'hot':found[0],mode:'quantity',quantity:values.quantity,rate:values.rate,billed:values.billed,correction:String(correction),rateBasis:'1',title:label,unit:unit.replace(/^м2\.?$/,'м²').replace(/^м3\.?$/,'м³').replace('кВт/ч','кВт·ч'),confidence:ambiguous?'partial':'table'});
      }
    }
    return rows;
  }
  function parse(text, pages = []) {
    text = text.replace(/\u00a0/g, ' ');
    const rows = tableRows(pages);
    if(!rows.length)rows.push(...croppedTableRows(pages));
    // A gas table has an explicit method row and a tariff per thousand cubic metres.
    // Never use the account-balance table or the total payable as a service charge.
    const gas = /поставка\s+природного\s+газа|газоснабжение/i.test(text)||(/Метод\s+расчета/i.test(text)&&/Температ/i.test(text)&&/Узел/i.test(text));
    const thousand = /тыс\.?\s*м[³3]|1000\s*м[³3]/i.test(text);
    if (!rows.length && gas && thousand) {
      const section=text.split(/2\s*[.)]\s*Расчет размера платы\s*:/i)[1];
      const part=(section||(/Метод\s+расчета/i.test(text)?text:'')).split(/3\s*[.)]\s*Сведения|Наименование\s+Долг|Пени/i)[0];
      const match = part.replace(/\|/g,' ').match(/Узел\s*[\dОO]+\s+Норматив\s+([\s\S]+)/i);
      if (match) {
        const n = numbers(match[1]);
        if (n.length >= 4 && n[2] === 1) rows.push({ kind: 'gas', mode: 'quantity', method:'normative', quantity: String(n[0]), rate: String(n[1]), rateBasis: '1000', billed: String(n[3]) });
      }
    }
    const simple = text.split(/^\s*Услуга\s+Об[ъь]ем\s+Тариф\s+Начислено\s*$/im)[1]?.split(/^\s*(?:Итого|Всего|Сальдо|Справочная|Сведения)/im)[0] || '';
    if (!rows.length) for (const line of simple.split(/\n/)) {
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
    let period = date ? date[2] + '-' + String(monthNames.indexOf(date[1]) + 1).padStart(2, '0') : '';
    if (!period) {
      const dates = [...new Set([...text.matchAll(/На\s+01\.(\d{2})\.(20\d{2})/g)].map(m => m[2] + '-' + m[1]))].sort();
      if (dates.length === 2 && new Date(dates[1] + '-01').getTime() === Date.UTC(Number(dates[0].slice(0, 4)), Number(dates[0].slice(5)), 1)) period = dates[0];
    }
    return { rows, period, hasBalance: /долг|аванс|пени|сальдо/i.test(text), thousand };
  }
  const api = { parse, tableRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Receipt = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
