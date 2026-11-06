(function(root){
  'use strict';
  function rectangle(bounds,width,height){
    if(!bounds||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
    const a=bounds.map(Number);if(a.length!==4||a.some(v=>!Number.isFinite(v)))return null;
    const [left,top,right,bottom]=a.map(v=>Math.max(0,Math.min(100,v)));
    if(right<=left||bottom<=top)return null;
    const x=Math.floor(width*left/100),y=Math.floor(height*top/100);
    const w=Math.min(width,Math.ceil(width*right/100))-x,h=Math.min(height,Math.ceil(height*bottom/100))-y;
    return w>=40&&h>=30?{x,y,width:w,height:h}:null;
  }
  if(typeof module!=='undefined'&&module.exports){module.exports={rectangle};return;}
  const $=id=>document.getElementById(id),keys=['left','top','right','bottom'];
  let source=null,finish=null,bounds=null,start=null;
  const dialog=$('crop-dialog'),view=$('crop-canvas');
  function paint(){
    if(!source)return;
    const ctx=view.getContext('2d');ctx.drawImage(source,0,0,view.width,view.height);
    ctx.fillStyle='rgba(15,29,23,.68)';ctx.fillRect(0,0,view.width,view.height);
    const rect=rectangle(bounds,source.width,source.height);
    if(rect){
      const sx=view.width/source.width,sy=view.height/source.height;
      ctx.drawImage(source,rect.x,rect.y,rect.width,rect.height,rect.x*sx,rect.y*sy,rect.width*sx,rect.height*sy);
      ctx.strokeStyle='#32bd8d';ctx.lineWidth=Math.max(2,view.width/350);ctx.strokeRect(rect.x*sx,rect.y*sy,rect.width*sx,rect.height*sy);
      $('crop-size').textContent=`Выделено ${rect.width} × ${rect.height} пикселей. Проверьте, что все нужные строки и заголовки внутри.`;
    }else $('crop-size').textContent='Выделите таблицу начислений. ФИО, адрес, лицевой счет, QR-код и номера счетчиков оставьте снаружи.';
    $('crop-accept').disabled=!rect||!$('crop-safe').checked||!$('crop-period').value;
  }
  function point(event){const r=view.getBoundingClientRect();return [Math.max(0,Math.min(100,(event.clientX-r.left)/r.width*100)),Math.max(0,Math.min(100,(event.clientY-r.top)/r.height*100))];}
  function drawTo(event){
    if(!start)return;const p=point(event);
    bounds=[Math.min(start[0],p[0]),Math.min(start[1],p[1]),Math.max(start[0],p[0]),Math.max(start[1],p[1])];
    keys.forEach((key,i)=>{$('crop-'+key).value=bounds[i].toFixed(1);});$('crop-safe').checked=false;paint();
  }
  view.addEventListener('pointerdown',event=>{if(!source||event.button>0)return;event.preventDefault();start=point(event);view.setPointerCapture(event.pointerId);bounds=null;$('crop-safe').checked=false;paint();});
  view.addEventListener('pointermove',event=>{if(start){event.preventDefault();drawTo(event);}});
  view.addEventListener('pointerup',event=>{if(start){drawTo(event);start=null;if(view.hasPointerCapture(event.pointerId))view.releasePointerCapture(event.pointerId);}});
  view.addEventListener('pointercancel',()=>{start=null;});
  for(const key of keys)$('crop-'+key).addEventListener('input',()=>{bounds=keys.map(k=>$('crop-'+k).value);$('crop-safe').checked=false;paint();});
  $('crop-period').addEventListener('input',()=>{$('crop-safe').checked=false;paint();});
  $('crop-safe').addEventListener('change',paint);
  function settle(result){
    const resolve=finish;finish=null;source=null;bounds=null;start=null;
    view.width=view.height=0;keys.forEach(k=>{$('crop-'+k).value='';});$('crop-safe').checked=false;$('crop-period').value='';$('crop-size').textContent='';
    if(dialog.open)dialog.close();if(resolve)resolve(result);
  }
  $('crop-form').addEventListener('submit',event=>{
    event.preventDefault();if(!source||!$('crop-safe').checked||!$('crop-period').value)return;
    const rect=rectangle(bounds,source.width,source.height);if(!rect)return;
    // A fresh raster contains only selected pixels: no EXIF, PDF text or outside area.
    const canvas=document.createElement('canvas');canvas.width=rect.width;canvas.height=rect.height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,rect.x,rect.y,rect.width,rect.height,0,0,canvas.width,canvas.height);
    settle({canvas,period:$('crop-period').value});
  });
  $('crop-skip').onclick=()=>settle({skip:true});
  function cancelImport(){const cancel=$('cancel-upload');if(cancel)cancel.click();else settle(null);}
  $('crop-cancel').onclick=cancelImport;dialog.addEventListener('cancel',event=>{event.preventDefault();cancelImport();});
  root.ReceiptCrop={rectangle,cancel:()=>settle(null),select:(canvas,options={})=>{
    if(finish)throw new Error('Сначала завершите выделение предыдущей страницы.');
    source=canvas;bounds=null;start=null;keys.forEach(k=>{$('crop-'+k).value='';});$('crop-safe').checked=false;
    $('crop-period').value=options.period||$('period').value;$('crop-period').readOnly=Boolean(options.fixedPeriod);
    $('crop-page').textContent=options.pages>1?`Страница ${options.page} из ${options.pages}. Можно пропустить страницу без начислений.`:'Выделите только таблицу, которую нужно проверить.';
    $('crop-skip').textContent=options.pages>1?'Пропустить страницу':'Пропустить файл';
    const scale=Math.min(1,1400/Math.max(canvas.width,canvas.height));view.width=Math.round(canvas.width*scale);view.height=Math.round(canvas.height*scale);
    dialog.showModal();paint();return new Promise(resolve=>{finish=resolve;});
  }};
})(globalThis);
