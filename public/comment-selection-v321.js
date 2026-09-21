(function (root) {
  'use strict';
  const colors = {red:'赤', yellow:'黄', blue:'青', green:'緑', purple:'紫'};
  const bindings = new WeakMap();
  let active, listening = false;

  // Work on text offsets, never HTML: existing comment rendering stays authoritative.
  function formatEdit(text, start, end, kind, value = '', maxLength = -1) {
    const wrappers = {bold:['**','**'], spoiler:['||','||'],
      color:colors[value] ? [`[color:${value}]`,'[/color]'] : null,
      size:value === 'large' ? ['[size:large]','[/size]'] : null};
    const wrapper = wrappers[kind];
    if (!wrapper || start < 0 || end < start || end > text.length) return null;
    let from = start, to = end, selected = text.slice(start,end), [before,after] = wrapper, active = false;
    if (selected) {
      const layers = [];
      const layerFor = open => {
        const kind = open === '**' ? 'bold' : open === '||' ? 'spoiler' : open.toLowerCase().startsWith('[color:') ? 'color' : 'size';
        return {open,kind,close:kind === 'color' ? '[/color]' : kind === 'size' ? '[/size]' : open};
      };
      // Selecting the whole formatted text also lets the user change or remove its style.
      while (selected) {
        const open = selected.match(/^(?:\*\*|\|\||\[color:(?:red|yellow|blue|green|purple)\]|\[size:large\])/i)?.[0];
        if (!open) break;
        const layer = layerFor(open);
        if (selected.length < open.length+layer.close.length || !selected.toLowerCase().endsWith(layer.close)) break;
        layers.unshift(layer);selected=selected.slice(open.length,-layer.close.length);
      }
      while (from > 0) {
        const open = text.slice(0,from).match(/(?:\*\*|\|\||\[color:(?:red|yellow|blue|green|purple)\]|\[size:large\])$/i)?.[0];
        if (!open) break;
        const layer = layerFor(open);
        if (text.slice(to,to+layer.close.length).toLowerCase() !== layer.close) break;
        layers.push(layer);from-=open.length;to+=layer.close.length;
      }
      const matching = layers.findIndex(layer=>layer.kind===kind);
      if (matching >= 0) {
        active = layers[matching].open.toLowerCase() === before;
        layers.splice(matching,1,...(active ? [] : [{open:before,close:after,kind}]));
        before='';after='';
      }
      for (const layer of layers) {before=layer.open+before;after+=layer.close;}
    }
    if (start === end) selected = 'ここに文字';
    const replacement = before+selected+after;
    if (maxLength > 0 && text.length-(to-from)+replacement.length > maxLength) return {tooLong:true};
    return {from,to,replacement,active,start:from+before.length,end:from+before.length+selected.length,
      value:text.slice(0,from)+replacement+text.slice(to)};
  }

  function apply(input, kind, value = '', range) {
    if (!input || input.disabled || input.readOnly) return false;
    if (range && (range.text !== input.value || range.end <= range.start)) return false;
    const edit = formatEdit(input.value,range?.start ?? input.selectionStart,range?.end ?? input.selectionEnd,kind,value,input.maxLength);
    if (!edit) return false;
    const ui = bindings.get(input);
    if (edit.tooLong) {
      if (ui) { ui.status.textContent = '文字数の上限を超えるため、装飾を追加できません。'; ui.status.hidden = false; }
      return false;
    }
    const top = input.scrollTop, left = input.scrollLeft;
    input.focus({preventScroll:true});
    input.setRangeText(edit.replacement,edit.from,edit.to,'preserve');
    input.setSelectionRange(edit.start,edit.end,range?.direction || 'forward');
    input.scrollTop = top; input.scrollLeft = left;
    input.dispatchEvent(new root.Event('input',{bubbles:true}));
    ui?.refresh();
    return true;
  }

  function bind(input) {
    if (!input || bindings.has(input)) return;
    const document = input.ownerDocument;
    const toolbar = document.createElement('div');
    toolbar.className = 'comment-selection-v321'; toolbar.hidden = true;
    toolbar.setAttribute('role','group'); toolbar.setAttribute('aria-label','選択した文字の装飾');
    toolbar.innerHTML = '<div class="comment-selection-actions-v321"><button type="button" data-selection-format="bold" aria-label="選択した文字を太字にする・解除する"><strong>B</strong> 太字</button><button type="button" data-selection-format="spoiler" aria-label="選択した文字を伏せ字にする・解除する">伏せ字</button><button type="button" data-selection-colors aria-expanded="false">文字色</button><button type="button" data-selection-format="size" data-selection-value="large" aria-label="選択した文字を大きくする・解除する">大きく</button></div><div class="comment-selection-colors-v321" role="group" aria-label="選択した文字の色" hidden>'+Object.entries(colors).map(([value,label])=>`<button type="button" data-selection-format="color" data-selection-value="${value}" aria-label="選択した文字を${label}色にする・解除する"><span class="comment-color-${value}" aria-hidden="true">●</span>${label}</button>`).join('')+'</div><p class="comment-selection-status-v321" role="status" hidden></p>';
    (input.closest('.comment-input-v324') || input).after(toolbar);
    const colorPanel = toolbar.querySelector('.comment-selection-colors-v321');
    const colorButton = toolbar.querySelector('[data-selection-colors]');
    const status = toolbar.querySelector('[role=status]');
    let range, composing = false, dismissed = '';
    const signature = () => `${input.selectionStart}:${input.selectionEnd}:${input.value}`;
    function close() { toolbar.hidden = true; colorPanel.hidden = true; colorButton.setAttribute('aria-expanded','false'); range = null; }
    function refresh() {
      const focused = document.activeElement === input || toolbar.contains(document.activeElement);
      if (!input.isConnected || !focused || composing || input.disabled || input.readOnly || input.selectionStart === input.selectionEnd || dismissed === signature()) { close(); return; }
      if (active && active !== ui) active.close();
      active = ui;
      range = {start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,text:input.value};
      toolbar.hidden = false;
      for (const button of toolbar.querySelectorAll('[data-selection-format]')) {
        const edit = formatEdit(input.value,range.start,range.end,button.dataset.selectionFormat,button.dataset.selectionValue);
        button.setAttribute('aria-pressed',String(Boolean(edit?.active)));
      }
    }
    const ui = {input,toolbar,status,refresh,close}; bindings.set(input,ui);
    // Prevent the formatting tap from moving the caret or dismissing the phone keyboard.
    toolbar.addEventListener('pointerdown',event=>{if(event.target.closest('button'))event.preventDefault();});
    toolbar.addEventListener('mousedown',event=>{if(event.target.closest('button'))event.preventDefault();});
    toolbar.addEventListener('click',event=>{
      const button = event.target.closest('button'); if (!button || !range || composing) return;
      if (button.hasAttribute('data-selection-colors')) {
        colorPanel.hidden = !colorPanel.hidden; colorButton.setAttribute('aria-expanded',String(!colorPanel.hidden));
        if (!colorPanel.hidden) colorPanel.scrollIntoView({block:'nearest',inline:'nearest'});
        return;
      }
      if (apply(input,button.dataset.selectionFormat,button.dataset.selectionValue || '',range)) {
        colorPanel.hidden = true; colorButton.setAttribute('aria-expanded','false');
      }
    });
    for (const event of ['select','selectionchange','keyup','pointerup','focus']) input.addEventListener(event,refresh);
    input.addEventListener('input',()=>{status.textContent='';status.hidden=true;dismissed='';refresh();});
    input.addEventListener('compositionstart',()=>{composing=true;close();});
    input.addEventListener('compositionend',()=>{composing=false;refresh();});
    input.addEventListener('keydown',event=>{
      if (!composing && !event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b' && input.selectionStart !== input.selectionEnd) {
        event.preventDefault(); apply(input,'bold');
      }
    });
    toolbar.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismissed=signature();close();input.focus({preventScroll:true});}});
    input.addEventListener('keydown',event=>{if(event.key==='Escape' && !toolbar.hidden){event.preventDefault();event.stopPropagation();dismissed=signature();close();}});
    if (!listening) {
      listening = true;
      document.addEventListener('selectionchange',()=>{const next=bindings.get(document.activeElement);(next || active)?.refresh();});
      document.addEventListener('focusin',event=>{if(active && event.target!==active.input && !active.toolbar.contains(event.target))active.close();});
      document.addEventListener('pointerdown',event=>{if(active && event.target!==active.input && !active.toolbar.contains(event.target))active.close();});
    }
  }
  root.MinkiruCommentSelectionV321 = {bind,apply,formatEdit};
})(typeof window === 'undefined' ? globalThis : window);
