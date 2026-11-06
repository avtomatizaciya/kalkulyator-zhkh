'use strict';
// Receipt bytes remain in this page and its worker. All engine assets are same-origin.
let receiptJob = 0, receiptWorker = null, receiptRows = [], receiptImageUrl = '';
const uploadStatus = text => { document.getElementById('upload-status').textContent = text; };
function clearReceipt() {
  if (receiptImageUrl) URL.revokeObjectURL(receiptImageUrl);
  receiptImageUrl = ''; receiptRows = [];
  document.getElementById('receipt-image-host').replaceChildren();
  document.getElementById('receipt-image-panel').hidden = true;
  document.getElementById('receipt-text').textContent = '';
  document.getElementById('receipt-preview').replaceChildren();
  document.getElementById('receipt-review').hidden = true;
  document.getElementById('upload-intake').hidden = false;
  document.getElementById('receipt-toolbar').hidden = true;
  uploadStatus('');
}
async function prepareImage(image) {
  const source = image instanceof Blob ? await createImageBitmap(image) : image;
  const scale = Math.min(3, 3200 / Math.max(source.width, source.height));
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
function reviewRow(row) {
  const card = document.createElement('div'); card.className = 'review-row';
  const controls = [
    ['kind', 'Услуга', Object.entries(kinds).map(([value, [label]]) => [value, label])],
    ['quantity', 'Объем или площадь'], ['rate', 'Тариф, ₽'],
    ['rateBasis', 'Тариф указан за', [['1', '1 единицу'], ['1000', '1000 единиц (газ)']]],
    ['billed', 'Начислено за услугу, ₽'],
  ];
  for (const [key, title, options] of controls) {
    const label = document.createElement('label'); label.className = 'fld review-field'; label.textContent = title;
    const input = document.createElement(options ? 'select' : 'input'); input.dataset.key = key;
    if (options) for (const [value, name] of options) { const option = document.createElement('option'); option.value = value; option.textContent = name; input.append(option); }
    else { input.type = 'text'; input.inputMode = 'decimal'; input.autocomplete = 'off'; }
    input.value = row[key] || (key === 'rateBasis' ? '1' : '');
    input.oninput = () => label.classList.remove('review-field');
    label.append(input); card.append(label);
  }
  const remove = document.createElement('button'); remove.className = 'remove'; remove.textContent = 'Убрать строку'; remove.onclick = () => card.remove(); card.append(remove);
  document.getElementById('receipt-preview').append(card);
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
  try {
    if (job !== receiptJob) throw new Error('Отменено');
    const canvas = await prepareImage(image);
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas); canvas.width = canvas.height = 0; return data.text;
  } finally { await worker.terminate(); if (receiptWorker === worker) receiptWorker = null; }
}
async function readPdf(file, job) {
  const pdfjs = await import('./vendor/pdfjs-dist/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs-dist/pdf.worker.mjs';
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  const pdf = await task.promise; const pages = [];
  try {
    if (pdf.numPages > 5) throw new Error('В PDF больше 5 страниц. Выберите отдельную квитанцию до 5 страниц.');
    for (let i = 1; i <= pdf.numPages; i++) {
      if (job !== receiptJob) throw new Error('Отменено');
      uploadStatus(`Читаем PDF: страница ${i} из ${pdf.numPages}`);
      const page = await pdf.getPage(i), content = await page.getTextContent();
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
        text = await recognizeImage(canvas, job); canvas.width = canvas.height = 0;
      }
      pages.push(text);
    }
    return pages.join('\n');
  } finally { await task.destroy(); }
}
document.getElementById('receipt-file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  const job = ++receiptJob;
  clearReceipt();
  document.getElementById('cancel-upload').hidden = false;
  event.target.disabled = true;
  try {
    if (file.size > 15 * 1024 * 1024) throw new Error('Файл больше 15 МБ. Выберите снимок или PDF меньшего размера.');
    const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!pdf && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Выберите JPG, PNG, WebP или PDF. Для HEIC сохраните фото как JPG.');
    if (!pdf) {
      receiptImageUrl = URL.createObjectURL(file);
      const original = document.createElement('img'); original.id = 'receipt-image'; original.alt = 'Выбранная квитанция'; original.src = receiptImageUrl;
      document.getElementById('receipt-image-host').append(original);
      document.getElementById('receipt-image-panel').hidden = false;
    }
    uploadStatus('Открываем файл на вашем устройстве…');
    const text = pdf ? await readPdf(file, job) : await recognizeImage(file, job);
    if (job !== receiptJob) return;
    const parsed = Receipt.parse(text); receiptRows = parsed.rows;
    document.getElementById('receipt-text').textContent = text;
    const preview = document.getElementById('receipt-preview'); preview.replaceChildren();
    receiptRows.forEach(reviewRow);
    if (!receiptRows.length) reviewRow({ kind: 'other' });
    document.getElementById('apply-receipt').hidden = false;
    document.getElementById('receipt-review').hidden = false;
    document.getElementById('upload-intake').hidden = true;
    document.getElementById('receipt-toolbar').hidden = false;
    document.getElementById('totals').replaceChildren();
    document.getElementById('summary').textContent = 'Сначала сверьте данные квитанции.';
    document.getElementById('comparison').textContent = 'Результат появится после нажатия «Проверить эти данные».';
    document.getElementById('warnings').textContent = 'Найденные цифры пока не включены в расчет.';
    document.getElementById('receipt-period').textContent = parsed.period ? 'Период в квитанции: ' + parsed.period : 'Период не найден. Укажите месяц вручную.';
    document.getElementById('receipt-review').dataset.period = parsed.period;
    uploadStatus(receiptRows.length ? `Найдено строк: ${receiptRows.length}. Проверьте поля ниже. Возможно, прочитаны не все услуги.` : 'Текст прочитан, но столбцы этой квитанции не удалось надежно разобрать. Откройте распознанный текст и перенесите объем, тариф и начисление вручную.');
  } catch (error) { if (job === receiptJob) uploadStatus('Не удалось прочитать: ' + error.message + ' Можно ввести данные вручную.'); }
  finally { if (job === receiptJob) { event.target.disabled = false; event.target.value = ''; document.getElementById('cancel-upload').hidden = true; } }
};
document.getElementById('cancel-upload').onclick = () => {
  receiptJob++; if (receiptWorker) { receiptWorker.terminate(); receiptWorker = null; }
  document.getElementById('receipt-file').disabled = false; document.getElementById('receipt-file').value = '';
  document.getElementById('cancel-upload').hidden = true; uploadStatus('Распознавание отменено.');
};
document.getElementById('apply-receipt').onclick = () => {
  receiptRows = [...document.querySelectorAll('.review-row')].map(card => ({ ...values(card), mode: 'quantity' }));
  if (!receiptRows.length) { uploadStatus('Добавьте хотя бы одну строку для проверки.'); return; }
  const error = receiptRows.map(row => Zhkh.calculate(row)).find(result => !result.ok);
  if (error) { uploadStatus('Проверьте выделенные поля: ' + error.error); return; }
  if (receiptRows.some(row => row.rateBasis === '1000' && row.kind !== 'gas')) { uploadStatus('Тариф за 1000 единиц в этой версии поддерживается для газа. Для другой услуги пересчитайте тариф за 1 единицу.'); return; }
  document.getElementById('services').replaceChildren(); counter = 0;
  document.getElementById('demo').hidden = true;
  receiptRows.forEach(row => add(row)); receiptRows = [];
  const period = document.getElementById('receipt-review').dataset.period; if (period) document.getElementById('period').value = period;
  document.getElementById('apply-receipt').hidden = true;
  showManual(); render(); uploadStatus('Строки добавлены в расчет. Проверьте и при необходимости исправьте цифры в полях.');
};
document.getElementById('add-review').onclick = () => reviewRow({ kind: 'other' });
document.getElementById('choose-another').onclick = () => { clearReceipt(); document.getElementById('receipt-file').click(); };
