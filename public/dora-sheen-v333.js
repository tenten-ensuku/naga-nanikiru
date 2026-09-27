(function(root) {
  'use strict';
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const settingsMarkup=()=>'<div class="dora-settings-v333"><label class="dora-toggle-v333" for="doraSheenToggleV333"><span>ドラ光沢</span><input id="doraSheenToggleV333" type="checkbox" role="switch" checked disabled aria-describedby="doraSheenHelpV333 doraSheenStatusV333"></label><p class="settings-form-note" id="doraSheenHelpV333">自分の手牌・ツモ牌・副露のドラを光らせます。設定は同じアカウントの端末で共有します。</p><p id="doraSheenStatusV333" role="status">読み込み中…</p><button id="doraSheenRetryV333" type="button" hidden>再試行</button></div>';
  const tileFace=(image,tile,enabled)=>enabled?`<span class="dora-tile-face-v333" data-dora-tile-v333="${esc(tile)}">${image}<span class="dora-tile-gloss-v333" aria-hidden="true"></span></span>`:image;

  // Keep the existing tile faces mounted when only selection/recommendations change.
  function syncHand(layer,markup,key) {
    layer.classList.add('dora-sheen-surface-v333');
    if(layer.dataset.doraHandKey!==key){layer.innerHTML=markup;layer.dataset.doraHandKey=key;return;}
    const template=layer.ownerDocument.createElement('template');template.innerHTML=markup;
    const existing=new Map(Array.from(layer.querySelectorAll('[data-tile-index]'),button=>[button.dataset.tileIndex,button]));
    for(const source of template.content.querySelectorAll('[data-tile-index]')){
      const target=existing.get(source.dataset.tileIndex);
      if(!target){layer.innerHTML=markup;return;}
      target.className=source.className;
      target.setAttribute('aria-label',source.getAttribute('aria-label'));
      const before=target.querySelector('.naga-tile-recommendations-v312'),after=source.querySelector('.naga-tile-recommendations-v312');
      if(before?.outerHTML!==after?.outerHTML){
        if(before&&after)before.replaceWith(after);
        else if(before)before.remove();
        else if(after)target.insertBefore(after,target.querySelector('.selection-marker'));
      }
    }
  }

  function create({api,userId}) {
    const doc=root.document;
    let owner=null,value=true,confirmed=true,ready=false,loading=false,saving=false,revision=0,pending=null,status='',failed=false;
    const observed=new Set();
    const observer=typeof root.IntersectionObserver==='function'?new root.IntersectionObserver(entries=>{
      for(const entry of entries)entry.target.classList.toggle('dora-sheen-visible-v333',entry.isIntersecting);
    }):null;
    const cacheKey=id=>`minkiru:dora-sheen:v1:${id}`;
    function cached(id){try{const v=root.localStorage.getItem(cacheKey(id));return v==='off'?false:true;}catch{return true;}}
    function cache(){try{root.localStorage.setItem(cacheKey(owner),value?'on':'off');}catch{/* Account storage is authoritative. */}}
    function apply(){
      doc.documentElement.dataset.doraSheen=value?'on':'off';
      doc.documentElement.dataset.doraSheenSuspended=String(doc.visibilityState==='hidden');
      const input=doc.getElementById('doraSheenToggleV333');
      if(input){input.checked=value;input.disabled=!owner||!ready||loading||saving;}
      const message=doc.getElementById('doraSheenStatusV333');
      if(message)message.textContent=!owner?'Discordでログインすると設定できます。':loading?'読み込み中…':status;
      const retry=doc.getElementById('doraSheenRetryV333');if(retry)retry.hidden=!failed||loading||saving;
    }
    function syncOwner(){
      const next=String(userId()||'');
      if(next!==owner){owner=next;revision++;pending=null;ready=false;loading=false;saving=false;failed=false;status='';value=confirmed=next?cached(next):true;apply();}
      return owner;
    }
    function valid(data){if(typeof data?.dora_sheen!=='boolean')throw Error('invalid_display_preferences');return data.dora_sheen;}
    function refresh(){
      const who=syncOwner();if(!who||saving)return Promise.resolve();if(pending)return pending;
      const token=++revision;loading=true;failed=false;apply();
      const task=Promise.resolve().then(async()=>{
        try{
          const data=await api().getDisplayPreferences();
          if(who!==String(userId()||'')||token!==revision)return;
          value=confirmed=valid(data);ready=true;status='';cache();
        }catch{
          if(who===String(userId()||'')&&token===revision){failed=true;status='設定を読み込めませんでした。再試行してください。';}
        }finally{if(token===revision){loading=false;pending=null;apply();}}
      });
      pending=task;return task;
    }
    async function setEnabled(enabled){
      const who=syncOwner();if(!who||!ready||loading||saving||typeof enabled!=='boolean')return;
      const token=++revision,previous=confirmed;saving=true;value=enabled;failed=false;status='保存中…';apply();
      try{
        const data=await api().saveDisplayPreferences(enabled);
        if(who!==String(userId()||'')||token!==revision)return;
        value=confirmed=valid(data);cache();status='保存しました。';
      }catch{
        if(who===String(userId()||'')&&token===revision){value=previous;failed=true;status='保存できなかったため、元の設定に戻しました。接続を確認して再度切り替えてください。';}
      }finally{if(token===revision){saving=false;apply();}}
    }
    function observe(){
      for(const node of observed)if(!node.isConnected){observer?.unobserve(node);observed.delete(node);}
      for(const node of doc.querySelectorAll('.dora-sheen-surface-v333'))if(!observed.has(node)){
        observed.add(node);if(observer)observer.observe(node);else node.classList.add('dora-sheen-visible-v333');
      }
    }
    async function bindSettings(){
      const input=doc.getElementById('doraSheenToggleV333');
      if(input)input.onchange=()=>{void setEnabled(input.checked);};
      const retry=doc.getElementById('doraSheenRetryV333');if(retry)retry.onclick=()=>{void refresh();};
      apply();await refresh();
    }
    doc.addEventListener('visibilitychange',()=>{apply();if(doc.visibilityState!=='hidden')void refresh();});
    syncOwner();
    return {refresh,setEnabled,bindSettings,observe,
      accountChanged(){const previous=owner;syncOwner();if(owner&&(owner!==previous||!ready))return refresh();return Promise.resolve();}
    };
  }
  root.MinkiruDoraSheenV333=Object.freeze({create,settingsMarkup,tileFace,syncHand});
})(typeof window==='undefined'?globalThis:window);
