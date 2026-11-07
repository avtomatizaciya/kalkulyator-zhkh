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
  let source=null,finish=null,bounds=null,start=null,panStart=null,zoom=1;
  const dialog=$('crop-dialog'),view=$('crop-canvas');
  const surface=dialog.querySelector('.crop-surface');
  const panButton=$('crop-pan');
  function setPan(enabled){
    panButton.setAttribute('aria-pressed',String(enabled));
    view.dataset.pan=String(enabled);
  }
  function resizePreview(nextZoom=zoom){
    if(!source||!dialog.open)return;
    const old=view.getBoundingClientRect(),frame=surface.getBoundingClientRect();
    const focusX=old.width?(frame.left+surface.clientWidth/2-old.left)/old.width:.5;
    const focusY=old.height?(frame.top+surface.clientHeight/2-old.top)/old.height:.5;
    const ratio=source.width/source.height;
    const fitted=Math.max(1,Math.min(surface.clientWidth-18,(surface.clientHeight-18)*ratio));
    zoom=nextZoom;
    view.style.width=Math.round(fitted*zoom)+'px';
    view.style.height=Math.round(fitted*zoom/ratio)+'px';
    const current=view.getBoundingClientRect();
    surface.scrollLeft+=current.left+focusX*current.width-frame.left-surface.clientWidth/2;
    surface.scrollTop+=current.top+focusY*current.height-frame.top-surface.clientHeight/2;
    $('crop-zoom-out').disabled=zoom<=1;
    $('crop-zoom-in').disabled=zoom>=4;
  }
  $('crop-zoom-in').onclick=()=>resizePreview(Math.min(4,zoom*1.5));
  $('crop-zoom-out').onclick=()=>resizePreview(Math.max(1,zoom/1.5));
  $('crop-fit').onclick=()=>{resizePreview(1);setPan(false);};
  panButton.onclick=()=>setPan(panButton.getAttribute('aria-pressed')!=='true');
  new ResizeObserver(()=>resizePreview()).observe(surface);
  function paint(){
    if(!source)return;
    const ctx=view.getContext('2d');ctx.drawImage(source,0,0,view.width,view.height);
    const rect=rectangle(bounds,source.width,source.height);
    if(rect){
      ctx.fillStyle='rgba(15,29,23,.48)';ctx.fillRect(0,0,view.width,view.height);
      const sx=view.width/source.width,sy=view.height/source.height;
      ctx.drawImage(source,rect.x,rect.y,rect.width,rect.height,rect.x*sx,rect.y*sy,rect.width*sx,rect.height*sy);
      ctx.strokeStyle='#32bd8d';ctx.lineWidth=Math.max(2,view.width/350);ctx.strokeRect(rect.x*sx,rect.y*sy,rect.width*sx,rect.height*sy);
      $('crop-size').textContent=`Выделено ${rect.width} × ${rect.height} пикселей. Проверьте, что все нужные строки и заголовки внутри.`;
    }else $('crop-size').textContent='Выделите таблицу вместе с заголовками столбцов. Личные реквизиты и QR-код оставьте за рамкой.';
    $('crop-accept').disabled=!rect||!$('crop-safe').checked||!$('crop-period').value;
  }
  function point(event){const r=view.getBoundingClientRect();return [Math.max(0,Math.min(100,(event.clientX-r.left)/r.width*100)),Math.max(0,Math.min(100,(event.clientY-r.top)/r.height*100))];}
  function drawTo(event){
    if(!start)return;const p=point(event);
    bounds=[Math.min(start[0],p[0]),Math.min(start[1],p[1]),Math.max(start[0],p[0]),Math.max(start[1],p[1])];
    keys.forEach((key,i)=>{$('crop-'+key).value=bounds[i].toFixed(1);});$('crop-safe').checked=false;paint();
  }
  view.addEventListener('pointerdown',event=>{
    if(!source||!event.isPrimary||event.button>0)return;
    event.preventDefault();
    view.setPointerCapture(event.pointerId);
    if(view.dataset.pan==='true'){
      panStart={x:event.clientX,y:event.clientY,left:surface.scrollLeft,top:surface.scrollTop};
      return;
    }
    start=point(event);
    bounds=null;
    $('crop-safe').checked=false;
    paint();
  });
  view.addEventListener('pointermove',event=>{
    if(!event.isPrimary)return;
    if(panStart){
      surface.scrollLeft=panStart.left+panStart.x-event.clientX;
      surface.scrollTop=panStart.top+panStart.y-event.clientY;
    }else if(start)drawTo(event);
  });
  view.addEventListener('pointerup',event=>{
    if(!event.isPrimary)return;
    if(start)drawTo(event);
    start=panStart=null;
    if(view.hasPointerCapture(event.pointerId))view.releasePointerCapture(event.pointerId);
  });
  view.addEventListener('pointercancel',()=>{start=panStart=null;});
  for(const key of keys)$('crop-'+key).addEventListener('input',()=>{bounds=keys.map(k=>$('crop-'+k).value);$('crop-safe').checked=false;paint();});
  $('crop-period').addEventListener('input',()=>{$('crop-safe').checked=false;paint();});
  $('crop-safe').addEventListener('change',paint);
  function settle(result){
    const resolve=finish;finish=null;source=null;bounds=null;start=panStart=null;
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
    $('crop-page').textContent=options.pages>1?`Страница ${options.page} из ${options.pages}. Можно пропустить страницу без начислений.`:'Перетащите указатель по таблице. Для мелкого текста нажмите «+».';
    $('crop-skip').textContent=options.pages>1?'Пропустить страницу':'Пропустить файл';
    const scale=Math.min(1,3000/Math.max(canvas.width,canvas.height));
    view.width=Math.round(canvas.width*scale);view.height=Math.round(canvas.height*scale);
    view.style.width=view.style.height='1px';
    dialog.showModal();
    setPan(false);
    resizePreview(1);
    surface.scrollLeft=surface.scrollTop=0;
    paint();
    return new Promise(resolve=>{finish=resolve;});
  }};
})(globalThis);
