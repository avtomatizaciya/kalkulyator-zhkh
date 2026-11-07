'use strict';
let receiptJob=0, receiptWorker=null, receiptQueue=null;
const uploadStatus=text=>{document.getElementById('upload-status').textContent=text};
function cancelReceiptQueue(){if(receiptQueue)receiptQueue.cancel();}
function createReceiptQueue(job){
  cancelReceiptQueue();
  let tail=Promise.resolve(),closed=false,abort,completed=0,total=0;
  const rasters=new Set(),cancelled=new Promise(resolve=>{abort=resolve;});
  const queue={
    get pending(){return total-completed;},
    status(text){
      if(job!==receiptJob||closed)return;
      // A recognition progress tick must never replace the next crop's instructions.
      if(!document.getElementById('crop-dialog').open)uploadStatus(text);
    },
    enqueue(canvas,period){
      total++;rasters.add(canvas);
      const pending=tail.then(async()=>{
        if(closed||job!==receiptJob)throw new Error('Отменено');
        const preview=canvas.toDataURL('image/jpeg',.9);
        const read=await Promise.race([recognizeImage(canvas,job),cancelled.then(()=>{throw new Error('Отменено');})]);
        if(closed||job!==receiptJob)throw new Error('Отменено');
        return {...read,period,previews:[preview]};
      }).finally(()=>{completed++;canvas.width=canvas.height=0;rasters.delete(canvas);});
      // Keep processing later crops even if one is unreadable. Callers own each result.
      tail=pending.catch(()=>{});
      return pending;
    },
    cancel(){
      if(closed)return;closed=true;abort();
      for(const canvas of rasters)canvas.width=canvas.height=0;
      rasters.clear();
    },
    close(){queue.cancel();if(receiptQueue===queue)receiptQueue=null;}
  };
  receiptQueue=queue;return queue;
}
async function prepareImage(image, maxSize=3600) {
  const source = image instanceof Blob ? await createImageBitmap(image) : image;
  const scale = Math.min(3, maxSize / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(source.width * scale); canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  // Remove only rules spanning most of the table, never short glyph strokes.
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),d=pixels.data,w=canvas.width,h=canvas.height;
  const black=i=>d[i]+d[i+1]+d[i+2]<450,erase=[];
  for(let y=0;y<h;y++){
    let start=-1;
    for(let x=0;x<=w;x++){
      if(x<w&&black((y*w+x)*4)){if(start<0)start=x;}
      else if(start>=0){if(x-start>Math.max(120,w*.5))erase.push([start,y,x-start,1]);start=-1;}
    }
  }
  for(let x=0;x<w;x++){
    let start=-1;
    for(let y=0;y<=h;y++){
      if(y<h&&black((y*w+x)*4)){if(start<0)start=y;}
      else if(start>=0){if(y-start>Math.max(120,h*.5))erase.push([x,start,1,y-start]);start=-1;}
    }
  }
  ctx.fillStyle='#fff';for(const [x,y,width,height]of erase)ctx.fillRect(x-1,y-1,width+2,height+2);
  return canvas;
}
async function recognizeImage(image, job) {
  if (!window.Tesseract) await new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'vendor/tesseract.js/tesseract.min.js';
    script.onload = resolve; script.onerror = () => reject(new Error('Не удалось загрузить модуль распознавания.')); document.head.append(script);
  });
  if (job !== receiptJob) throw new Error('Отменено');
  const worker = await Tesseract.createWorker('rus', 1, {
    workerPath: 'vendor/tesseract.js/worker.min.js', corePath: 'vendor/tesseract.js-core',
    langPath: 'vendor/lang', cacheMethod: 'none', workerBlobURL: false,
    logger: m => { if (job === receiptJob) {const text=m.status === 'recognizing text' ? `Читаем квитанцию: ${Math.round(m.progress * 100)}%` : 'Подготавливаем распознавание на вашем устройстве…';if(receiptQueue)receiptQueue.status(text);else uploadStatus(text);} },
  });
  if(job!==receiptJob){await worker.terminate();throw new Error('Отменено');}
  receiptWorker = worker;
  let deadline;
  try {
    if (job !== receiptJob) throw new Error('Отменено');
    let canvas = await prepareImage(image);
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    const timeout=new Promise((resolve,reject)=>{deadline=setTimeout(()=>reject(new Error('Распознавание заняло слишком много времени. Попробуйте четкое фото только таблицы.')),90000);});
    let { data } = await Promise.race([worker.recognize(canvas, {}, { text: true, tsv: true }),timeout]);
    // Thermal receipts mix very small volume figures with larger labels.
    let refinementExpired=false;
    if(/ГВС\s+компонент/i.test(data.text)){
      const refined=await prepareImage(image,4800);
      try{await worker.setParameters({tessedit_pageseg_mode:'3'});const next=await Promise.race([worker.recognize(refined,{}, {text:true,tsv:true}),timeout]);data=next.data;canvas.width=canvas.height=0;canvas=refined;}
      catch(error){refined.width=refined.height=0;refinementExpired=true;}
    }
    const words = (data.tsv || '').split('\n').slice(1).map(line => line.split('\t')).filter(c => c[0] === '5' && c[11]?.trim()).map(c => ({ x: Number(c[6]), y: Number(c[7]), w: Number(c[8]), h: Number(c[9]), text: c.slice(11).join('\t') }));
    // Re-read long numbers with ambiguous punctuation as isolated cells. Changed digits require
    // agreement of two segmentation modes; no value is inferred from a charge.
    let text=data.text;
    const candidates=words.filter(w=>/^(?:\d{7,12}|\d-\d{6,10}|©[.,]\d{6,10})$/.test(w.text)).slice(0,12);
    if(candidates.length&&!refinementExpired){
      try{
      await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789.,-'});
      for(const word of candidates){
        if(job!==receiptJob)throw new Error('Отменено');
        const left=Math.max(0,word.x-10),top=Math.max(0,word.y-10);
        const peers=words.filter(w=>Math.abs(w.x-word.x)<20&&/^\d+[.,]\d+$/.test(w.text)).map(w=>w.h).sort((a,b)=>a-b);
        const cellHeight=peers.length?Math.min(word.h,peers[Math.floor(peers.length/2)]*1.4):word.h;
        const rectangle={left,top,width:Math.min(canvas.width-left,word.w+30),height:Math.min(canvas.height-top,cellHeight+20)};
        await worker.setParameters({tessedit_pageseg_mode:'7'});
        const malformed=/[-©]/.test(word.text);
        const isolated=malformed?document.createElement('canvas'):canvas;
        if(malformed){
          isolated.width=word.w*2+40;
          isolated.height=word.h*2+40;
          const context=isolated.getContext('2d');
          context.fillStyle='#fff';
          context.fillRect(0,0,isolated.width,isolated.height);
          context.drawImage(canvas,word.x,word.y,word.w,word.h,20,20,word.w*2,word.h*2);
        }
        const options=malformed?{}:{rectangle};
        const reread=await Promise.race([worker.recognize(isolated,options,{text:true}),timeout]);
        const value=reread.data.text.trim();
        if(!/^\d+[.,]\d+$/.test(value))continue;
        const hasMisreadSeparator=word.text.includes('-');
        if(hasMisreadSeparator&&value.replace(',','.')!==word.text.replace('-','.'))continue;
        let accepted=hasMisreadSeparator?reread.data.confidence>=80:value.replace(/[.,]/g,'')===word.text;
        if(!accepted&&reread.data.confidence>=85){
          await worker.setParameters({tessedit_pageseg_mode:'13'});
          const confirm=await Promise.race([worker.recognize(isolated,options,{text:true}),timeout]);
          // For an unreadable leading glyph, both passes must agree and preserve the readable suffix.
          const sameSuffix=word.text.startsWith('©')&&value.slice(1)===word.text.slice(1);
          accepted=confirm.data.confidence>=(sameSuffix?80:85)&&confirm.data.text.trim()===value;
        }
        if(accepted){text=text.replace(word.text,value);word.text=value;}
      }
      }catch(error){/* Optional digit refinement must not discard the readable receipt. */}
    }
    if(job!==receiptJob)throw new Error('Отменено');
    const result = { text, pages: [{ width: canvas.width, height: canvas.height, words }] };
    canvas.width = canvas.height = 0; return result;
  } finally { clearTimeout(deadline); await worker.terminate(); if (receiptWorker === worker) receiptWorker = null; }
}
async function cropAndRead(canvas, job, options={}, queue=null) {
  if(job!==receiptJob)throw new Error('Отменено');
  const selected=await ReceiptCrop.select(canvas,options);
  if(job!==receiptJob) { if(selected?.canvas)selected.canvas.width=selected.canvas.height=0;throw new Error('Отменено'); }
  if(!selected||selected.skip)return {skipped:true};
  if(queue)return {pending:queue.enqueue(selected.canvas,selected.period),period:selected.period};
  try { return {...await recognizeImage(selected.canvas,job),period:selected.period,previews:[selected.canvas.toDataURL("image/jpeg",.9)]}; }
  finally { selected.canvas.width=selected.canvas.height=0; }
}
async function readPhoto(file,job,queue=null) {
  const bitmap=await createImageBitmap(file),scale=Math.min(1,3600/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  try {
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return await cropAndRead(canvas,job,{page:1,pages:1,period:receiptFilePeriod(file.name)},queue);
  } finally { canvas.width=canvas.height=0;bitmap.close(); }
}
async function readPdf(file, job, queue=null) {
  const pdfjs = await import('./vendor/pdfjs-dist/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs-dist/pdf.worker.mjs';
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  const pages=[],geometry=[],previews=[],pending=[];let month='';
  try {
    const pdf=await task.promise;
    if(pdf.numPages>5)throw new Error('В PDF больше 5 страниц. Выберите отдельную квитанцию до 5 страниц.');
    for(let i=1;i<=pdf.numPages;i++) {
      if(job!==receiptJob)throw new Error('Отменено');
      uploadStatus(`Готовим PDF: страница ${i} из ${pdf.numPages}. Выделите таблицу без личных реквизитов.`);
      const page=await pdf.getPage(i),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(6,4800/Math.max(base.width,base.height))});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      try {
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        const read=await cropAndRead(canvas,job,{page:i,pages:pdf.numPages,period:month||receiptFilePeriod(file.name),fixedPeriod:Boolean(month)},queue);
        if(read.skipped)continue;
        if(read.pending){month=read.period;pending.push(read.pending);continue;}
        month=read.period;pages.push(read.text);geometry.push(...read.pages);previews.push(...read.previews);
      } finally { canvas.width=canvas.height=0;page.cleanup(); }
    }
    if(queue&&pending.length){
      const result=Promise.all(pending).then(reads=>({previews:reads.flatMap(r=>r.previews),text:reads.map(r=>r.text).join('\n'),pages:reads.flatMap(r=>r.pages),period:month,skipped:false}));
      result.catch(()=>{});return {pending:result};
    }
    return {previews,text:pages.join('\n'),pages:geometry,period:month,skipped:!pages.length};
  } finally { await task.destroy(); }
}

function receiptFilePeriod(name){
  const m=name.match(/(?:^|[^0-9])(20[0-9]{2})[ ._-](0[1-9]|1[0-2])(?:[^0-9]|$)/);
  return m?m[1]+'-'+m[2]:'';
}
