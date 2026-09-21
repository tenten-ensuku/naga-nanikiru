(function(host) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const person = row => escape(row?.display_name || '表示名未登録') + (row?.disabled ? '（利用停止中）' : '');
  function visibility(info) {
    const label = {private:'プライベート',request:'承認許可制',public:'全体公開',unlisted:'全体公開',limited:'限定公開',workspace:'ワークスペース内'}[info.visibility] || '不明';
    if (!info.published && ['public','unlisted','request'].includes(info.visibility)) return `未公開（設定：${label}）`;
    return label + (info.visibility==='workspace' && info.workspace_name ? `（${info.workspace_name}）` : '');
  }
  function contents(record) {
    const heading='<h5>管理権限・公開範囲 <span>管理人専用</span></h5>';
    if (!record || record.status==='loading') return heading+'<p role="status">管理情報を読み込んでいます…</p>';
    if (record.status==='error') return heading+'<p role="status">管理情報を読み込めませんでした。</p><button type="button" data-admin-info-retry>再読み込み</button>';
    const info=record.value;
    return heading+`<dl><div><dt>公開範囲</dt><dd>${escape(visibility(info))}</dd></div><div><dt>作成者</dt><dd>${person(info.owner)}</dd></div><div><dt>管理メンバー</dt><dd>${info.managers.length?info.managers.map(person).join('、'):'指定なし'}</dd></div>${info.editors.length?`<div><dt>編集メンバー</dt><dd>${info.editors.map(person).join('、')}</dd></div>`:''}</dl><p class="collection-admin-note-v328">作成者は権限・公開範囲も管理できます。管理メンバーは問題と本の情報、編集メンバーは問題を編集できます。管理人はすべて管理できます。</p>`;
  }
  function create({session,load}) {
    let owner='',revision=0;
    const records=new Map(),bound=new WeakSet();
    function clear(){revision++;records.clear();}
    function scope(){
      const user=session(),id=user?.isAdmin===true?String(user.userId || ''):'';
      if(id!==owner){owner=id;clear();}
      return id;
    }
    function markup(book){
      const id=scope(),slug=String(book?.slug || '');
      if(!id || !slug)return '';
      return `<section class="collection-admin-v328" data-collection-admin-v328="${escape(slug)}" data-admin-user="${escape(id)}" aria-label="${escape(book.fullTitle)}の管理権限・公開範囲">${contents(records.get(slug))}</section>`;
    }
    async function bind(root){
      const id=scope(),node=root?.querySelector('[data-collection-admin-v328]');
      if(!node)return;
      if(!id || node.dataset.adminUser!==id){node.remove();return;}
      const slug=node.dataset.collectionAdminV328,currentRevision=revision;
      const current=()=>scope()===id && revision===currentRevision && node.isConnected && node.dataset.collectionAdminV328===slug;
      if(!bound.has(node)){
        bound.add(node);
        node.addEventListener('click',event=>{
          if(event.target.closest('[data-admin-info-retry]') && node.isConnected && scope()===node.dataset.adminUser){
            records.delete(node.dataset.collectionAdminV328);void bind(root);
          }
        });
      }
      let record=records.get(slug);
      if(!record){
        record={status:'loading'};records.set(slug,record);
        record.task=Promise.resolve().then(()=>load(slug)).then(value=>{
          if(scope()!==id || revision!==currentRevision)return;
          if(!value || value.share_slug!==slug || !Array.isArray(value.managers) || !Array.isArray(value.editors))throw Error('Invalid management information');
          Object.assign(record,{status:'ready',value});
        }).catch(()=>{if(scope()===id && revision===currentRevision)record.status='error';});
      }
      node.innerHTML=contents(record);
      if(record.task)await record.task;
      if(current())node.innerHTML=contents(record);
    }
    return {markup,bind,clear};
  }
  host.MinkiruCollectionAdminV328={create,visibility};
})(globalThis);
