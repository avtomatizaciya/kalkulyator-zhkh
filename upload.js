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
  // Remove long, straight table rules which otherwise merge digits into grid borders.
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), d = pixels.data, w = canvas.width, h = canvas.height;
  const black = i => d[i] + d[i + 1] + d[i + 2] < 450;
  const erase = [];
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      if (x < w && black((y * w + x) * 4)) { if (start < 0) start = x; }
      else if (start >= 0) { if (x - start > w * .15) erase.push([start, y, x - start, 1]); start = -1; }
    }
  }
  for (let x = 0; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      if (y < h && black((y * w + x) * 4)) { if (start < 0) start = y; }
      else if (start >= 0) { if (y - start > h * .035) erase.push([x, start, 1, y - start]); start = -1; }
    }
  }
  ctx.fillStyle = '#fff'; erase.forEach(([x, y, width, height]) => ctx.fillRect(x - 1, y - 1, width + 2, height + 2));
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
async function readPdf(file, job) {
  const pdfjs = await import('./vendor/pdfjs-dist/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs-dist/pdf.worker.mjs';
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  const pdf = await task.promise; const pages = [], geometry = [];
  try {
    if (pdf.numPages > 5) throw new Error('В PDF больше 5 страниц. Выберите отдельную квитанцию до 5 страниц.');
    for (let i = 1; i <= pdf.numPages; i++) {
      if (job !== receiptJob) throw new Error('Отменено');
      uploadStatus(`Читаем PDF: страница ${i} из ${pdf.numPages}`);
      const page = await pdf.getPage(i), content = await page.getTextContent();
      const viewport1 = page.getViewport({ scale: 1 });
      let pageWords = content.items.filter(item => item.str?.trim()).map(item => ({ x: item.transform[4], y: viewport1.height - item.transform[5] - item.height, w: item.width, h: item.height, text: item.str.trim() }));
      const lines = [];
      for (const item of content.items) {
        if (!item.str) continue;
        const y = item.transform[5];
        let line = lines.find(row => Math.abs(row.y - y) < 2);
        if (!line) { line = { y, parts: [] }; lines.push(line); }
        line.parts.push({ x: item.transform[4], text: item.str });
      }
      let text = lines.sort((a, b) => b.y - a.y).map(line => line.parts.sort((a, b) => a.x - b.x).map(p => p.text).join(' ')).join('\n');
      if (text.trim().length < 80) {
        const viewport = page.getViewport({ scale: Math.min(2.5, 2400 / page.getViewport({ scale: 1 }).width) });
        const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const recognized = await recognizeImage(canvas, job); text = recognized.text; pageWords = recognized.pages[0].words; canvas.width = canvas.height = 0;
      }
      pages.push(text); geometry.push({ words: pageWords });
    }
    return { text: pages.join('\n'), pages: geometry };
  } finally { await task.destroy(); }
}
