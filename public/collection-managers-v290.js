(function(host){
  'use strict';
  const controllers=new WeakMap();
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function identity(row){
    const date=String(row.registered_at||'').slice(0,10).replaceAll('-','/');
    return [date?`${date} 登録`:'',row.account_hint?`ID末尾 ${row.account_hint}`:'',row.disabled?'利用停止中':''].filter(Boolean).join(' · ');
  }
  function markup({draft=false}={}){
    return `<details class="collection-managers-v290" data-manager-picker data-draft="${draft}"><summary>管理メンバーを選ぶ<span data-manager-count></span></summary><p class="manager-help-v290">問題の追加・編集・整理、本の名前・説明・色の変更を任せられます。${draft?'作成と同時に権限を付与します。':'指定・解除は作成者が行います。'}</p><div data-manager-selected></div><div class="manager-search-v290"><label>ユーザー名で検索<input type="search" data-manager-query maxlength="80" placeholder="みん切るの表示名 または Discord ID" autocomplete="off"></label><button type="button" data-manager-search>検索</button></div><div data-manager-results></div><p class="manager-status-v290" data-manager-status role="status" aria-live="polite"></p></details>`;
  }
  function bind(root,{api,shareSlug='',initial=[],isCurrent=()=>root.isConnected,onChange=()=>{}}){
    if(!root||controllers.has(root))return controllers.get(root);
    const draft=root.dataset.draft==='true',selected=new Map(initial.map(row=>[row.user_id,row]));
    let results=[],request=0,loaded=false,busy=false,loading=null;
    const status=root.querySelector('[data-manager-status]'),query=root.querySelector('[data-manager-query]');
    const message=(text,error=false)=>{if(!isCurrent())return;status.textContent=text;status.classList.toggle('is-error',error);};
    const changed=()=>{onChange([...selected.values()]);root.dispatchEvent(new Event('change',{bubbles:true}));};
    const render=()=>{
      root.querySelector('[data-manager-count]').textContent=selected.size?`${selected.size}人`:'';
      root.querySelector('[data-manager-selected]').innerHTML=selected.size?`<ul class="manager-people-v290" aria-label="${draft?'選択した管理メンバー':'現在の管理メンバー'}">${[...selected.values()].map(row=>`<li><span><strong>${escape(row.display_name)}</strong><small>${escape(identity(row))}</small></span><button type="button" data-manager-remove="${escape(row.user_id)}"${busy?' disabled':''} aria-label="${escape(row.display_name)}の${draft?'選択を外す':'管理権限を解除'}">${draft?'外す':'解除'}</button></li>`).join('')}</ul>`:draft?'':`<p class="manager-empty-v290">管理メンバーはまだ指定されていません。</p>`;
      root.querySelector('[data-manager-results]').innerHTML=results.length?`<ul class="manager-people-v290" aria-label="ユーザー検索結果">${results.map(row=>`<li><span><strong>${escape(row.display_name)}</strong><small>${escape(identity(row))}</small></span><button type="button" data-manager-add="${escape(row.user_id)}"${busy||selected.has(row.user_id)?' disabled':''}>${selected.has(row.user_id)?'選択済み':draft?'選ぶ':'管理に追加'}</button></li>`).join('')}</ul>`:'';
    };
    async function load(){
      if(loading)return loading;
      loading=(async()=>{try{
        const rows=await api.loadCollectionManagers(shareSlug);
        if(!isCurrent())return;
        selected.clear();for(const row of rows)selected.set(row.user_id,row);
        loaded=true;render();message('');
      }catch(error){message(error?.message||'管理メンバーを読み込めませんでした。',true);}})().finally(()=>{loading=null;});
      return loading;
    }
    async function search(){
      if(busy||!isCurrent())return;
      if(!draft&&!loaded){await load();if(!loaded||!isCurrent())return;}
      const value=query.value.trim();if(!value){results=[];render();message('ユーザー名を入力してください。');return;}
      const token=++request;message('検索中…');
      try{
        const rows=await api.searchCollectionManagers(value,draft?'':shareSlug);
        if(token!==request||!isCurrent())return;
        results=rows;render();message(rows.length?'登録日とID末尾を確認して、対象者を選んでください。':'該当するユーザーがいません。相手がみん切るにログイン済みか確認してください。');
      }catch(error){if(token===request)message(error?.message||'検索できませんでした。',true);}
    }
    root.querySelector('[data-manager-search]').addEventListener('click',search);
    query.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void search();}});
    root.addEventListener('toggle',()=>{if(root.open&&!draft&&!loaded)void load();});
    root.addEventListener('click',async event=>{
      const button=event.target.closest('[data-manager-add],[data-manager-remove]');
      if(!button||!root.contains(button)||busy||!isCurrent())return;
      const adding=button.hasAttribute('data-manager-add'),id=adding?button.dataset.managerAdd:button.dataset.managerRemove;
      const row=(adding?results:[...selected.values()]).find(item=>item.user_id===id);if(!row)return;
      if(adding&&selected.size>=20){message('管理メンバーは20人以内で選択してください。',true);return;}
      if(draft){if(adding)selected.set(id,row);else selected.delete(id);render();changed();message('');return;}
      busy=true;request++;render();message('保存中…');
      try{
        await api.setCollectionManager(shareSlug,id,adding);
        if(!isCurrent())return;
        if(adding)selected.set(id,row);else selected.delete(id);
        message(`${row.display_name}さんの管理権限を${adding?'付与':'解除'}しました。`);
      }catch(error){message(error?.message||'保存できませんでした。',true);}
      finally{busy=false;if(isCurrent())render();}
    });
    const controller={values:()=>[...selected.values()],set(rows){selected.clear();for(const row of rows||[])selected.set(row.user_id,row);render();},load};
    controllers.set(root,controller);render();return controller;
  }
  host.MinkiruCollectionManagersV290={markup,bind,values:root=>controllers.get(root)?.values()||[],restore:(root,rows)=>controllers.get(root)?.set(rows),identity};
})(globalThis);
