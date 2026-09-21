(function(host){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone=value=>JSON.parse(JSON.stringify(value));
  const newKey=/^standard_[0-9a-f]{32}$/;
  const fields=definition=>({key:definition.storageKey,label:definition.label,icon:definition.icon,iconType:definition.iconType||'emoji',tone:definition.tone,hidden:false});
  function merge(base,rows){
    const baseMap=new Map(base.map(item=>[item.storageKey,item])),seen=new Set(),result=[];
    for(const row of Array.isArray(rows)?rows:[]){
      if(!row||typeof row.key!=='string'||seen.has(row.key)||(!baseMap.has(row.key)&&!newKey.test(row.key)))continue;
      if(typeof row.label!=='string'||typeof row.icon!=='string')continue;
      const original=baseMap.get(row.key);
      result.push({...original,id:original?.id||row.key,storageKey:row.key,label:row.label,icon:row.icon,
        iconType:row.key==='riichi'&&row.iconType==='riichi-stick'?'riichi-stick':'emoji',
        tone:['gold','teal','blue','purple','red'].includes(row.tone)?row.tone:'gold',hidden:row.hidden===true});
      seen.add(row.key);
    }
    for(const item of base)if(!seen.has(item.storageKey))result.push({...item,hidden:false});
    return result;
  }
  function create({base,session,load,save,changed=()=>{},icon=item=>escape(item.icon)}){
    let account='',epoch=0,snapshot={revision:0,rows:[]},loaded=false,pending=null,error='',busy=false;
    let draft=null,draftBase='',draftRevision=0,selected='',notice='',node=null;
    const bound=new WeakSet();
    const admin=()=>session()?.isAdmin===true && !!session()?.userId;
    function scope(){
      const id=String(session()?.userId||'');
      if(id!==account){account=id;epoch++;snapshot={revision:0,rows:[]};loaded=false;pending=null;draft=null;notice='';error='';busy=false;}
      return id;
    }
    const definitions=()=>merge(base,snapshot.rows);
    const dirty=()=>!!draft && JSON.stringify(draft)!==draftBase;
    function beginDraft(){draft=definitions().map(item=>({...fields(item),hidden:!!item.hidden}));draftBase=JSON.stringify(draft);draftRevision=snapshot.revision;if(!draft.some(row=>row.key===selected))selected=draft[0]?.key||'';}
    const selectedRow=()=>draft?.find(row=>row.key===selected);
    const definition=row=>({...base.find(item=>item.storageKey===row.key),...row,id:row.key,storageKey:row.key});
    function status(){
      if(!node?.isConnected)return;
      node.querySelector('[data-standard-status]').textContent=error||notice||(dirty()?'未保存の変更があります。':loaded?'保存済みの定番を表示しています。':'定番を読み込んでいます…');
      node.querySelector('[data-standard-save]').disabled=busy||!loaded||!dirty();
      node.querySelector('[data-standard-add]').disabled=busy||!loaded||draft.length>=128;
    }
    function grid(){
      if(!node?.isConnected||!draft)return;
      node.querySelector('[data-standard-grid]').innerHTML=draft.map((row,i)=>`<button type="button" class="standard-preview-item-v329${row.key===selected?' is-active':''}${row.hidden?' is-hidden':''}" draggable="${!busy}" data-standard-select="${escape(row.key)}" aria-pressed="${row.key===selected}" aria-label="${i+1}番 ${escape(row.label||row.icon)}${row.hidden?'（非表示）':''}"${busy?' disabled':''}><small>${i+1}</small><span class="standard-preview-icon-v329">${icon(definition(row))}</span><span>${escape(row.label)}</span>${row.hidden?'<i>非表示</i>':''}</button>`).join('');
      status();
    }
    function render(){
      if(!node?.isConnected)return;
      if(!scope()||!admin()){node.replaceChildren();return;}
      if(!draft)beginDraft();
      const row=selectedRow()||draft[0];selected=row.key;
      const index=draft.indexOf(row),original=base.find(item=>item.storageKey===row.key);
      node.innerHTML=`<div class="standard-editor-heading-v329"><h3>定番リアクションを編集 <small>管理人専用</small></h3><p>保存すると全利用者に反映されます。左から右、上から下の順に表示します。</p></div><div class="standard-editor-layout-v329"><div><p class="standard-editor-hint-v329">選んで編集。ドラッグでも並べ替えできます。</p><div class="standard-preview-grid-v329" data-standard-grid aria-label="定番リアクションのプレビュー"></div><button type="button" data-standard-add>＋ 定番を追加</button></div><fieldset class="standard-editor-fields-v329"${(busy||!loaded)?' disabled':''}><legend>選択中のリアクション</legend><label>文言<input data-standard-field="label" aria-label="定番の文言" maxlength="48" value="${escape(row.label)}" autocomplete="off"></label><label>絵文字<input data-standard-field="icon" aria-label="定番の絵文字" maxlength="32" value="${escape(row.icon)}" autocomplete="off"${row.iconType==='riichi-stick'?' disabled':''}></label>${row.iconType==='riichi-stick'?'<p class="standard-editor-hint-v329">立直棒のアイコンを使います。</p>':''}<div class="standard-editor-order-v329"><label>順番<input type="number" data-standard-position aria-label="表示する順番" min="1" max="${draft.length}" value="${index+1}"></label><button type="button" data-standard-move="-1"${index===0?' disabled':''}>← 前へ</button><button type="button" data-standard-move="1"${index===draft.length-1?' disabled':''}>次へ →</button></div><label class="standard-editor-hidden-v329"><input type="checkbox" data-standard-field="hidden"${row.hidden?' checked':''}>定番の候補から非表示</label><p class="standard-editor-hint-v329">非表示でも、すでに付いたリアクションは残ります。</p>${original?'<button type="button" data-standard-restore>元の文言・絵文字に戻す</button>':''}</fieldset></div><div class="standard-editor-actions-v329"><button type="button" class="primary" data-standard-save>保存して全員に反映</button><button type="button" data-standard-reload${busy?' disabled':''}>保存済みに戻す</button><p role="status" aria-live="polite" data-standard-status></p></div>`;
      grid();
    }
    async function refresh({force=false}={}){
      const id=scope(),revision=epoch;
      if(!id){changed();render();return false;}
      if(pending)return pending;
      if(loaded&&!force)return true;
      const task=(async()=>{
        try{
          const data=await load();
          if(scope()!==id||epoch!==revision)return false;
          if(!data||!Number.isSafeInteger(data.revision)||data.revision<0||!Array.isArray(data.rows))throw Error('定番を読み込めませんでした。');
          const keepDraft=dirty(),updated=JSON.stringify(snapshot.rows)!==JSON.stringify(data.rows);snapshot=clone(data);loaded=true;error='';if(!keepDraft)beginDraft();if(updated)changed();render();return true;
        }catch(e){if(scope()===id&&epoch===revision){error=e?.message||'定番を読み込めませんでした。「保存済みに戻す」で再読み込みできます。';render();}return false;}
      })();
      pending=task;try{return await task;}finally{if(pending===task)pending=null;}
    }
    function move(key,to){
      const from=draft.findIndex(row=>row.key===key);if(from<0||!Number.isInteger(to)||to<0||to>=draft.length)return;
      const [row]=draft.splice(from,1);draft.splice(to,0,row);selected=key;notice='';error='';render();
      node?.querySelector(`[data-standard-select="${key}"]`)?.focus();
    }
    async function commit(){
      if(busy||!loaded||!dirty()||!admin())return;
      if(draft.some(row=>Array.from(row.label.trim()).length>24||Array.from(row.icon.trim()).length>16||(!row.label.trim()&&!row.icon.trim()))||!draft.some(row=>!row.hidden)){
        error='文言は24文字以内、絵文字は16文字以内です。少なくとも1種類は表示してください。';status();return;
      }
      const id=scope(),revision=epoch;busy=true;error='';notice='保存しています…';render();
      try{
        const data=await save(clone(draft),draftRevision);
        if(scope()!==id||epoch!==revision||!admin())return;
        if(!data||!Number.isSafeInteger(data.revision)||!Array.isArray(data.rows))throw Error('保存結果を確認できませんでした。');
        snapshot=clone(data);loaded=true;beginDraft();notice='保存しました。全利用者の定番に反映されます。';changed();
      }catch(e){if(scope()===id&&epoch===revision)error=e?.message||'保存できませんでした。編集内容は残っています。';}
      finally{if(scope()===id&&epoch===revision){busy=false;render();}}
    }
    function markup(){return scope()&&admin()?'<section class="standard-editor-v329" data-standard-reactions-editor aria-label="定番リアクションの編集"></section>':'';}
    function bind(root){
      scope();node=root?.querySelector('[data-standard-reactions-editor]');if(!node)return;
      if(!admin()){node.remove();return;}
      if(!bound.has(node)){
        bound.add(node);
        node.addEventListener('input',event=>{
          if(busy||!admin())return;const field=event.target.dataset.standardField;if(!field||!['label','icon','hidden'].includes(field))return;
          selectedRow()[field]=field==='hidden'?event.target.checked:event.target.value;notice='';error='';grid();
        });
        node.addEventListener('change',event=>{if(!busy&&admin()&&event.target.matches('[data-standard-position]'))move(selected,Number(event.target.value)-1);});
        node.addEventListener('click',async event=>{
          const button=event.target.closest('button');if(!button||busy||!admin())return;
          if(button.dataset.standardSelect){selected=button.dataset.standardSelect;render();}
          else if(button.dataset.standardMove)move(selected,draft.findIndex(row=>row.key===selected)+Number(button.dataset.standardMove));
          else if(button.hasAttribute('data-standard-add')&&loaded&&draft.length<128){
            selected='standard_'+host.crypto.randomUUID().replaceAll('-','');draft.push({key:selected,label:'新しいリアクション',icon:'😊',iconType:'emoji',tone:'gold',hidden:false});notice='';error='';render();node.querySelector('[data-standard-field="label"]').focus();node.querySelector('[data-standard-field="label"]').select();
          }else if(button.hasAttribute('data-standard-restore')){const original=base.find(item=>item.storageKey===selected);if(original){Object.assign(selectedRow(),{label:original.label,icon:original.icon,iconType:original.iconType||'emoji'});notice='';error='';render();}}
          else if(button.hasAttribute('data-standard-save'))await commit();
          else if(button.hasAttribute('data-standard-reload')){if(await refresh({force:true})){beginDraft();notice='保存済みの内容に戻しました。';render();}}
        });
        node.addEventListener('dragstart',event=>{const card=event.target.closest('[data-standard-select]');if(!card||busy||!admin())return;event.dataTransfer.setData('text/plain',card.dataset.standardSelect);event.dataTransfer.effectAllowed='move';});
        node.addEventListener('dragover',event=>{if(!busy&&admin()&&event.target.closest('[data-standard-select]'))event.preventDefault();});
        node.addEventListener('drop',event=>{const card=event.target.closest('[data-standard-select]');if(!card||busy||!admin())return;event.preventDefault();move(event.dataTransfer.getData('text/plain'),draft.findIndex(row=>row.key===card.dataset.standardSelect));});
      }
      render();void refresh();
    }
    return {definitions,refresh,markup,bind,canEdit:admin};
  }
  host.MinkiruStandardReactionsV329={create,merge};
})(globalThis);
