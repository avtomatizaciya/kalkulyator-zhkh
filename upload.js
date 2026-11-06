'use strict';
let receiptJob=0, receiptWorker=null;
const uploadStatus=text=>{document.getElementById('upload-status').textContent=text};
async function prepareImage(image) {
  const source = image instanceof Blob ? await createImageBitmap(image) : image;
  const scale = Math.min(3, 2400 / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(source.width * scale); canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  // Keep glyph pixels intact: line removal corrupts digits in tightly cropped tables.
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
    logger: m => { if (job === receiptJob) uploadStatus(m.status === 'recognizing text' ? `Читаем квитанцию: ${Math.round(m.progress * 100)}%` : 'Подготавливаем распознавание на вашем устройстве…'); },
  });
  receiptWorker = worker;
  let deadline;
  try {
    if (job !== receiptJob) throw new Error('Отменено');
    const canvas = await prepareImage(image);
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    const { data } = await Promise.race([worker.recognize(canvas, {}, { text: true, tsv: true }), new Promise((resolve, reject) => { deadline = setTimeout(() => reject(new Error('Распознавание заняло слишком много времени. Попробуйте четкое фото только таблицы.')), 90000); })]);
    const words = (data.tsv || '').split('\n').slice(1).map(line => line.split('\t')).filter(c => c[0] === '5' && c[11]?.trim()).map(c => ({ x: Number(c[6]), y: Number(c[7]), w: Number(c[8]), h: Number(c[9]), text: c.slice(11).join('\t') }));
    const result = { text: data.text, pages: [{ width: canvas.width, height: canvas.height, words }] };
    canvas.width = canvas.height = 0; return result;
  } finally { clearTimeout(deadline); await worker.terminate(); if (receiptWorker === worker) receiptWorker = null; }
}
async function cropAndRead(canvas, job, options={}) {
  if(job!==receiptJob)throw new Error('Отменено');
  const selected=await ReceiptCrop.select(canvas,options);
  if(job!==receiptJob) { if(selected?.canvas)selected.canvas.width=selected.canvas.height=0;throw new Error('Отменено'); }
  if(!selected||selected.skip)return {skipped:true};
  try { return {...await recognizeImage(selected.canvas,job),period:selected.period}; }
  finally { selected.canvas.width=selected.canvas.height=0; }
}
async function readPhoto(file,job) {
  const bitmap=await createImageBitmap(file),scale=Math.min(1,3600/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  try {
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return await cropAndRead(canvas,job,{page:1,pages:1});
  } finally { canvas.width=canvas.height=0;bitmap.close(); }
}
async function readPdf(file, job) {
  const pdfjs = await import('./vendor/pdfjs-dist/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs-dist/pdf.worker.mjs';
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  const pages=[],geometry=[];let month='';
  try {
    const pdf=await task.promise;
    if(pdf.numPages>5)throw new Error('В PDF больше 5 страниц. Выберите отдельную квитанцию до 5 страниц.');
    for(let i=1;i<=pdf.numPages;i++) {
      if(job!==receiptJob)throw new Error('Отменено');
      uploadStatus(`Готовим PDF: страница ${i} из ${pdf.numPages}. Выделите таблицу без личных реквизитов.`);
      const page=await pdf.getPage(i),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2.5,2400/Math.max(base.width,base.height))});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      try {
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        const read=await cropAndRead(canvas,job,{page:i,pages:pdf.numPages,period:month||document.getElementById('period').value,fixedPeriod:Boolean(month)});
        if(read.skipped)continue;
        month=read.period;pages.push(read.text);geometry.push(...read.pages);
      } finally { canvas.width=canvas.height=0;page.cleanup(); }
    }
    return {text:pages.join('\n'),pages:geometry,period:month,skipped:!pages.length};
  } finally { await task.destroy(); }
}
