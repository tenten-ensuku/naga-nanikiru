(function(root) {
  'use strict';
  const bindings = new WeakMap(), histories = new Map();
  let active, openAttachment, listening = false, nextId = 0;
  const tagApi = () => root.MinkiruCommentTagsV270;
  const account = () => String(root.nagaCurrentUserIdV75 || '');
  const storageKey = id => `naga-nanikiru:comment-tag-history-v1:${id}`;
  function normalizeRecent(values, tags = tagApi()) {
    return [...new Set((Array.isArray(values) ? values : []).map(value => tags.normalizeTag(value)).filter(Boolean))].slice(0,64);
  }
  function recent() {
    const id = account();
    if (!id) return [];
    try {
      const saved = root.localStorage.getItem(storageKey(id));
      if (saved !== null) histories.set(id,normalizeRecent(JSON.parse(saved)));
    } catch { /* Keep the in-memory history if browser storage is unavailable. */ }
    return histories.get(id) || [];
  }
  // Remember completed tags locally, including drafts, without posting a comment.
  function remember(text) {
    const id = account(), tags = tagApi();
    if (!id || !tags) return;
    const used = tags.extractTags(text);
    if (!used.length) return;
    const values = normalizeRecent([...used.slice().reverse(),...recent()],tags);
    histories.set(id,values);
    try { root.localStorage.setItem(storageKey(id),JSON.stringify(values)); } catch { /* Best effort preference. */ }
  }
  function tokenAtCaret(text, start, end = start) {
    if (start !== end || start < 0 || start > text.length) return null;
    const before = text.slice(0,start);
    const match = before.match(/(?:^|[^\p{L}\p{M}\p{N}_/#＃])([#＃])([\p{L}\p{M}\p{N}_]*)$/u);
    if (!match || /https?:\/\/\S*$/iu.test(before)) return null;
    const query = match[2].normalize('NFKC');
    if ([...query].length > 30) return null;
    const tail = text.slice(start).match(/^[\p{L}\p{M}\p{N}_]*/u)[0];
    return {from:start-match[1].length-match[2].length,to:start+tail.length,query};
  }
  function rememberDraft(text, start, end = start) {
    const token = tokenAtCaret(text,start,end);
    // Do not learn a partial tag while its name is still being typed.
    remember(token ? text.slice(0,token.from)+text.slice(token.to) : text);
  }
  function candidates(history, query, tags = tagApi()) {
    const prefix = query.normalize('NFKC').toLocaleLowerCase('ja');
    return [...new Set([...normalizeRecent(history,tags),...tags.TAGS])].filter(tag=>tag.toLocaleLowerCase('ja').startsWith(prefix));
  }
  function completion(text, token, tag, maxLength, tags = tagApi()) {
    const normalized = tags.normalizeTag(tag);
    if (!token || !normalized) return null;
    const suffix = text.slice(token.to), replacement = '#'+normalized+(!suffix || !/^\s/u.test(suffix) ? ' ' : '');
    const value = text.slice(0,token.from)+replacement+suffix;
    return maxLength > 0 && value.length > maxLength ? null : {value,from:token.from,to:token.to,replacement,caret:token.from+replacement.length};
  }
  function popupPosition(rect, viewport, contentHeight) {
    const margin=8, gap=6, leftEdge=viewport.left+margin, topEdge=viewport.top+margin;
    const rightEdge=viewport.left+viewport.width-margin, bottomEdge=viewport.top+viewport.height-margin;
    const width=Math.min(380,Math.max(240,rect.width),Math.max(0,rightEdge-leftEdge));
    const above=Math.max(0,rect.top-gap-topEdge), below=Math.max(0,bottomEdge-rect.bottom-gap);
    const upward=above>=120 || above>=below;
    const height=Math.min(contentHeight,320,upward?above:below);
    return {left:Math.max(leftEdge,Math.min(rect.left,rightEdge-width)),top:upward?rect.top-gap-height:rect.bottom+gap,
      width,height,placement:upward?'above':'below'};
  }
  function closeAttachment() {
    if (!openAttachment) return;
    openAttachment.menu.hidden = true;
    openAttachment.button.setAttribute('aria-expanded','false');
    openAttachment = null;
  }
  function bind(input) {
    if (!input || bindings.has(input)) return;
    const document = input.ownerDocument, field = input.closest('.comment-input-v324');
    if (!field) return;
    const panel = document.createElement('div');
    panel.className = 'comment-tag-suggestions-v324'; panel.id = `comment-tag-suggestions-${++nextId}`;
    panel.hidden = true; panel.setAttribute('role','listbox'); panel.setAttribute('aria-label','ハッシュタグ候補');
    // The top layer escapes the generator card and mobile dialog's scroll clipping.
    panel.setAttribute('popover','manual');
    field.after(panel);
    input.setAttribute('aria-autocomplete','list'); input.setAttribute('aria-controls',panel.id); input.setAttribute('aria-expanded','false');
    let token, options = [], index = -1, composing = false, dismissed = '', rendered = '';
    const signature = () => `${input.selectionStart}:${input.selectionEnd}:${input.value}`;
    function close() {
      if (panel.hidePopover && panel.matches(':popover-open')) panel.hidePopover();
      panel.hidden=true; input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant'); index=-1; token=null; rendered='';
    }
    function position() {
      if (panel.hidden || !input.isConnected) return;
      if (panel.showPopover && !panel.matches(':popover-open')) panel.showPopover();
      const rect=input.getBoundingClientRect(), view=root.visualViewport;
      const viewport={left:view?.offsetLeft || 0,top:view?.offsetTop || 0,width:view?.width || root.innerWidth,height:view?.height || root.innerHeight};
      if (!rect.width || rect.bottom<=viewport.top || rect.top>=viewport.top+viewport.height) {close();return;}
      panel.style.width=popupPosition(rect,viewport,320).width+'px';
      panel.style.maxHeight='320px';
      const box=popupPosition(rect,viewport,panel.scrollHeight+2);
      if (box.height<44) {close();return;}
      panel.style.left=box.left+'px';panel.style.top=box.top+'px';panel.style.width=box.width+'px';panel.style.maxHeight=box.height+'px';
      panel.dataset.placement=box.placement;
    }
    function select(i) {
      index=i;
      [...panel.children].forEach((button,n)=>button.setAttribute('aria-selected',String(n===index)));
      input.setAttribute('aria-activedescendant',panel.children[index].id);
    }
    function refresh() {
      if (!input.isConnected || input.disabled || input.readOnly || !tagApi() || dismissed === signature() || (document.activeElement !== input && !panel.contains(document.activeElement))) {close();return;}
      // Some IMEs select the preedit text. Use its end to show candidates before Enter.
      const next = tokenAtCaret(input.value,composing ? input.selectionEnd : input.selectionStart,input.selectionEnd);
      if (!next) {close();return;}
      if (active && active !== ui) active.close(); active = ui;
      const history=recent(), nextRender=account()+':'+signature()+':'+history.join('\0');
      if(rendered===nextRender){position();return;}
      rendered=nextRender; token = next; options = candidates(history,token.query); index=-1;
      panel.replaceChildren(); input.removeAttribute('aria-activedescendant');
      options.forEach((tag,i)=>{
        const button=document.createElement('button');button.type='button';button.textContent=tag;button.id=panel.id+'-'+i;
        button.setAttribute('aria-label','#'+tag);
        button.dataset.tagIndex=String(i);button.setAttribute('role','option');button.setAttribute('aria-selected','false');
        panel.append(button);
      });
      if (!options.length) {close();return;}
      select(0);panel.hidden=false;input.setAttribute('aria-expanded','true');
      if (panel.showPopover && !panel.matches(':popover-open')) panel.showPopover();
      panel.scrollTop=0;position();
    }
    function choose(i) {
      if (input.disabled || input.readOnly || !token || !options[i]) return;
      const chosen = options[i], previousToken = token, wasComposing = composing;
      // Blurring commits the IME's preedit before replacing the selected tag.
      if (composing) input.blur();
      if (composing) return;
      const current = tokenAtCaret(input.value,wasComposing ? input.selectionEnd : input.selectionStart,input.selectionEnd);
      if (!current || current.from !== previousToken.from || current.to !== previousToken.to || current.query !== previousToken.query) {close();return;}
      const edit = completion(input.value,current,chosen,input.maxLength);
      if (!edit) return;
      input.focus({preventScroll:true});input.setRangeText(edit.replacement,edit.from,edit.to,'end');input.setSelectionRange(edit.caret,edit.caret);
      input.dispatchEvent(new root.Event('input',{bubbles:true}));close();
    }
    const ui={input,panel,refresh,close,position};bindings.set(input,ui);
    panel.addEventListener('pointerdown',event=>{if(event.target.closest('button'))event.preventDefault();});
    panel.addEventListener('mousedown',event=>{if(event.target.closest('button'))event.preventDefault();});
    panel.addEventListener('click',event=>{const button=event.target.closest('[data-tag-index]');if(button)choose(Number(button.dataset.tagIndex));});
    panel.addEventListener('pointermove',event=>{const button=event.target.closest('[data-tag-index]');if(button)select(Number(button.dataset.tagIndex));});
    input.addEventListener('input',event=>{
      dismissed='';
      if (!composing && !event.isComposing) rememberDraft(input.value,input.selectionStart,input.selectionEnd);
      refresh();
    });
    for (const name of ['focus','select','keyup','pointerup']) input.addEventListener(name,refresh);
    input.addEventListener('compositionstart',()=>{composing=true;dismissed='';refresh();});
    input.addEventListener('compositionend',()=>{composing=false;rememberDraft(input.value,input.selectionStart,input.selectionEnd);refresh();});
    input.addEventListener('blur',()=>{if (!composing && !input.disabled && !input.readOnly) remember(input.value);});
    input.addEventListener('keydown',event=>{
      if(composing || event.isComposing || event.keyCode===229 || panel.hidden)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismissed=signature();close();return;}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault(); select((index+(event.key==='ArrowDown'?1:options.length-1)+options.length)%options.length);
        panel.children[index].scrollIntoView({block:'nearest',inline:'nearest'});
      }
      if((event.key==='Enter'||(event.key==='Tab'&&!event.shiftKey))&&index>=0){event.preventDefault();choose(index);}
    });
    const button = field.querySelector('[data-comment-attach-toggle]'), menu = field.querySelector('[data-comment-attach-menu]');
    button?.addEventListener('click',()=>{
      const show=menu.hidden;closeAttachment();if(!show)return;
      menu.hidden=false;button.setAttribute('aria-expanded','true');openAttachment={button,menu};
    });
    menu?.addEventListener('click',()=>closeAttachment());
    field.addEventListener('keydown',event=>{if(event.key==='Escape' && openAttachment?.button===button){event.preventDefault();event.stopPropagation();closeAttachment();button.focus();}});
    if(!listening){
      listening=true;
      let layoutPending=false;
      const reflow=()=>{
        if(layoutPending)return;
        layoutPending=true;
        // Measure after the mobile dialog has resized/moved the form for the keyboard.
        root.requestAnimationFrame(()=>{layoutPending=false;active?.refresh();});
      };
      document.addEventListener('selectionchange',()=>bindings.get(document.activeElement)?.refresh());
      document.addEventListener('scroll',event=>{if(active&&!active.panel.contains(event.target))reflow();},true);
      root.addEventListener('resize',reflow);
      root.visualViewport?.addEventListener('resize',reflow);
      root.visualViewport?.addEventListener('scroll',reflow);
      document.addEventListener('focusin',event=>{if(active&&event.target!==active.input&&!active.panel.contains(event.target))active.close();});
      document.addEventListener('pointerdown',event=>{
        if(active&&event.target!==active.input&&!active.panel.contains(event.target))active.close();
        if(openAttachment&&event.target!==openAttachment.button&&!openAttachment.button.contains(event.target)&&!openAttachment.menu.contains(event.target))closeAttachment();
      });
    }
  }
  function refresh(input) { bindings.get(input)?.refresh(); }
  root.MinkiruCommentComposerV324={bind,refresh,remember,rememberDraft,recent,normalizeRecent,tokenAtCaret,candidates,completion,popupPosition,closeAttachment};
})(typeof window==='undefined'?globalThis:window);
