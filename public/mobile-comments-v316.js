(function (root) {
  'use strict';
  let ui, latest, busy = false;
  function viewportRect(viewport, width, height) {
    return {left:viewport?.offsetLeft || 0, top:viewport?.offsetTop || 0, width:viewport?.width || width, height:viewport?.height || height};
  }
  function init() {
    const document = root.document, form = document.getElementById('commentForm');
    if (!form) return null;
    const input = document.getElementById('commentInput');
    const marker = document.createComment('comment form home');
    form.before(marker);
    const dialog = document.createElement('dialog');
    dialog.className = 'mobile-comment-dialog-v316';
    dialog.setAttribute('aria-labelledby','mobileCommentTitleV316');
    dialog.innerHTML = '<header class="mobile-comment-heading-v316"><h2 id="mobileCommentTitleV316">コメントを書く</h2><button type="button" data-comment-return>コメントを読む</button></header><section class="mobile-comment-preview-v316" aria-label="問題の盤面プレビュー"><div class="mobile-comment-board-v316" aria-hidden="true" inert></div><button type="button" data-comment-expand aria-expanded="false" aria-label="盤面を拡大">拡大</button></section><div class="mobile-comment-form-host-v316"></div>';
    document.querySelector('.page').append(dialog);
    const host = dialog.querySelector('.mobile-comment-form-host-v316');
    const board = dialog.querySelector('.mobile-comment-board-v316');
    const preview = dialog.querySelector('.mobile-comment-preview-v316');
    const expand = dialog.querySelector('[data-comment-expand]');
    const back = dialog.querySelector('[data-comment-return]');
    const media = root.matchMedia('(max-width: 800px)');
    let active = false, expanded = false, selection = null, scrollY = 0, clone, frameWidth, frameHeight;
    let oldBody = null;
    function rememberSelection() { selection = [input.selectionStart,input.selectionEnd,input.selectionDirection]; }
    function focusInput() {
      input.focus({preventScroll:true});
      if (selection) input.setSelectionRange(...selection);
    }
    function resizeInput() {
      if (!active) return;
      input.style.height = 'auto';
      input.style.height = Math.min(160, Math.max(110,input.scrollHeight))+'px';
    }
    function fitBoard() {
      if (!active || !clone || !frameWidth || !frameHeight) return;
      const scale = Math.min(board.clientWidth/frameWidth,board.clientHeight/frameHeight);
      clone.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }
    function layout() {
      if (!active) return;
      const rect = viewportRect(root.visualViewport,root.innerWidth,root.innerHeight);
      for (const [key,value] of Object.entries(rect)) dialog.style.setProperty('--comment-'+key,value+'px');
      dialog.classList.toggle('is-short-v316',rect.height < 440);
      fitBoard();
    }
    function setExpanded(value) {
      if (value) { rememberSelection(); input.blur(); document.getElementById('commentTagPickerV271').open = false; }
      expanded = value;
      dialog.classList.toggle('is-expanded-v316',value);
      expand.textContent = value ? '入力に戻る' : '拡大';
      expand.setAttribute('aria-label',value ? '入力に戻る' : '盤面を拡大');
      expand.setAttribute('aria-expanded',String(value));
      if (!value) focusInput();
      root.requestAnimationFrame(layout);
    }
    function hide({focus=false}={}) {
      if (!active) return;
      rememberSelection(); active=false; expanded=false;
      marker.after(form);
      dialog.close();
      dialog.classList.remove('is-expanded-v316');
      board.replaceChildren(); clone=null;
      input.style.removeProperty('height');
      document.body.style.position=oldBody.position;
      document.body.style.top=oldBody.top;
      document.body.style.width=oldBody.width;
      document.body.style.overflow=oldBody.overflow;
      root.scrollTo(0,scrollY);
      if (focus) document.getElementById('commentAddButton').focus({preventScroll:true});
    }
    function show() {
      if (active) { resizeInput(); layout(); return; }
      const source = document.querySelector('.scene-card > .scene-frame');
      if (!source || source.closest('[hidden]')) return;
      const box = source.getBoundingClientRect();
      frameWidth=box.width; frameHeight=box.height;
      clone=source.cloneNode(true);
      for (const element of [clone,...clone.querySelectorAll('*')]) {
        element.removeAttribute('id'); element.removeAttribute('autofocus');
        if (element.matches('button,input,select,textarea')) element.tabIndex=-1;
      }
      Object.assign(clone.style,{position:'absolute',top:'50%',left:'50%',width:frameWidth+'px',height:frameHeight+'px',maxHeight:'none',maxWidth:'none',margin:'0',transformOrigin:'center'});
      board.replaceChildren(clone);
      host.append(form); form.hidden=false;
      scrollY=root.scrollY;
      oldBody={position:document.body.style.position,top:document.body.style.top,width:document.body.style.width,overflow:document.body.style.overflow};
      Object.assign(document.body.style,{position:'fixed',top:-scrollY+'px',width:'100%',overflow:'hidden'});
      active=true;
      expand.textContent='拡大'; expand.setAttribute('aria-label','盤面を拡大'); expand.setAttribute('aria-expanded','false');
      layout(); dialog.showModal(); resizeInput(); fitBoard(); focusInput();
      root.requestAnimationFrame(layout);
    }
    function closeFromUser() { if (!busy) { hide({focus:true}); latest?.onClose?.(); } }
    back.addEventListener('click',closeFromUser);
    expand.addEventListener('click',()=>setExpanded(!expanded));
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(expanded)setExpanded(false);else closeFromUser();});
    input.addEventListener('input',resizeInput);
    preview.addEventListener('load',fitBoard,true);
    new root.ResizeObserver(fitBoard).observe(board);
    root.visualViewport?.addEventListener('resize',layout);
    root.visualViewport?.addEventListener('scroll',layout);
    root.addEventListener('resize',layout);
    media.addEventListener('change',()=>sync(latest));
    return {dialog,media,show,hide,resizeInput,setBusy(value){back.disabled=value;expand.disabled=value;}};
  }
  function sync(options) {
    if (!options) return;
    latest=options;
    if (!ui && !options.open) return;
    ui ||= init(); if (!ui) return;
    ui.dialog.querySelector('h2').textContent = options.editing ? 'コメントを編集' : 'コメントを書く';
    if (options.open && ui.media.matches) ui.show(); else ui.hide();
  }
  function setBusy(value) { busy=value; ui?.setBusy(value); }
  root.MinkiruMobileCommentsV316 = {sync,setBusy,viewportRect};
})(window);
