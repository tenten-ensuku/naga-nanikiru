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
  // Only successful comment/question saves call this, never typing or picking a suggestion.
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
    field.after(panel);
    input.setAttribute('aria-autocomplete','list'); input.setAttribute('aria-controls',panel.id); input.setAttribute('aria-expanded','false');
    let token, options = [], index = -1, composing = false, dismissed = '', rendered = '';
    const signature = () => `${input.selectionStart}:${input.selectionEnd}:${input.value}`;
    function close() { panel.hidden=true; input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant'); index=-1; token=null; rendered=''; }
    function refresh() {
      if (!input.isConnected || input.disabled || input.readOnly || composing || !tagApi() || dismissed === signature() || (document.activeElement !== input && !panel.contains(document.activeElement))) {close();return;}
      const next = tokenAtCaret(input.value,input.selectionStart,input.selectionEnd);
      if (!next) {close();return;}
      if (active && active !== ui) active.close(); active = ui;
      const history=recent(), nextRender=account()+':'+signature()+':'+history.join('\0');
      if(rendered===nextRender)return;
      rendered=nextRender; token = next; options = candidates(history,token.query); index=-1;
      panel.replaceChildren(); input.removeAttribute('aria-activedescendant');
      options.forEach((tag,i)=>{
        const button=document.createElement('button');button.type='button';button.textContent='#'+tag;button.id=panel.id+'-'+i;
        button.dataset.tagIndex=String(i);button.setAttribute('role','option');button.setAttribute('aria-selected','false');
        panel.append(button);
      });
      panel.hidden = !options.length; input.setAttribute('aria-expanded',String(!panel.hidden));
    }
    function choose(i) {
      if (composing || input.disabled || input.readOnly || !token || !options[i]) return;
      const current = tokenAtCaret(input.value,input.selectionStart,input.selectionEnd);
      if (!current || current.from !== token.from || current.to !== token.to || current.query !== token.query) {close();return;}
      const edit = completion(input.value,current,options[i],input.maxLength);
      if (!edit) return;
      input.focus({preventScroll:true});input.setRangeText(edit.replacement,edit.from,edit.to,'end');input.setSelectionRange(edit.caret,edit.caret);
      input.dispatchEvent(new root.Event('input',{bubbles:true}));close();
    }
    const ui={input,panel,refresh,close};bindings.set(input,ui);
    panel.addEventListener('pointerdown',event=>{if(event.target.closest('button'))event.preventDefault();});
    panel.addEventListener('mousedown',event=>{if(event.target.closest('button'))event.preventDefault();});
    panel.addEventListener('click',event=>{const button=event.target.closest('[data-tag-index]');if(button)choose(Number(button.dataset.tagIndex));});
    input.addEventListener('input',()=>{dismissed='';refresh();});
    for (const name of ['focus','select','keyup','pointerup']) input.addEventListener(name,refresh);
    input.addEventListener('compositionstart',()=>{composing=true;close();});
    input.addEventListener('compositionend',()=>{composing=false;refresh();});
    input.addEventListener('keydown',event=>{
      if(composing || event.isComposing || panel.hidden)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismissed=signature();close();}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault(); index = index < 0 ? (event.key==='ArrowDown'?0:options.length-1) : (index+(event.key==='ArrowDown'?1:options.length-1)+options.length)%options.length;
        [...panel.children].forEach((button,i)=>button.setAttribute('aria-selected',String(i===index)));
        input.setAttribute('aria-activedescendant',panel.children[index].id);panel.children[index].scrollIntoView({block:'nearest',inline:'nearest'});
      }
      if(event.key==='Enter'&&index>=0){event.preventDefault();choose(index);}
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
      document.addEventListener('selectionchange',()=>bindings.get(document.activeElement)?.refresh());
      document.addEventListener('focusin',event=>{if(active&&event.target!==active.input&&!active.panel.contains(event.target))active.close();});
      document.addEventListener('pointerdown',event=>{
        if(active&&event.target!==active.input&&!active.panel.contains(event.target))active.close();
        if(openAttachment&&event.target!==openAttachment.button&&!openAttachment.button.contains(event.target)&&!openAttachment.menu.contains(event.target))closeAttachment();
      });
    }
  }
  function refresh(input) { bindings.get(input)?.refresh(); }
  root.MinkiruCommentComposerV324={bind,refresh,remember,recent,normalizeRecent,tokenAtCaret,candidates,completion,closeAttachment};
})(typeof window==='undefined'?globalThis:window);
