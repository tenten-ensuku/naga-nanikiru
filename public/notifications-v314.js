(function(root){
 'use strict';
 const labels={enabled:'通知を受け取る',created_comments:'自分が作成した問題へのコメント',managed_comments:'所有・管理する問題集へのコメント',conversation_comments:'自分がコメントした問題への新しいコメント',added_questions:'選んだ問題集への問題追加',access_requests:'自分が所有する問題集への閲覧申請'};
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const element=id=>document.getElementById(id);
 function create({api,userId,openTarget,isReady}){
  let owner='',items=[],unread=0,cursor=null,filter='unread',busy=false,error='',request=0,settingsRequest=0,resuming=false,visiting=false,settings=null;
  const syncOwner=()=>{const next=userId();if(next!==owner){owner=next;items=[];unread=0;cursor=null;error='';settings=null;request++;settingsRequest++;busy=false;}return owner;};
  function badge(){syncOwner();const node=element('commentNotificationBadge'),button=element('commentNotificationsButton');if(node){node.hidden=!unread;node.textContent=unread>99?'99+':String(unread);}if(button){button.title=unread?`通知（未読${unread}件）`:'通知';button.setAttribute('aria-label',button.title);}}
  function render(){
   badge();const list=element('commentNotificationList');if(!list)return;
   const tabs=element('notificationFiltersV314');if(tabs)tabs.innerHTML=['unread','all'].map(value=>`<button type="button" data-notification-filter="${value}" aria-pressed="${filter===value}">${value==='unread'?'未読':'すべて'}</button>`).join('');
   const shown=filter==='unread'?items.filter(row=>!row.read_at):items;
   list.innerHTML=(error?`<p role="alert">${escape(error)} <button data-notification-retry type="button">再試行</button></p>`:'')+shown.map(row=>{
    const action=row.kind==='comment'?'コメントしました':row.kind==='question'?'問題を追加しました':row.kind==='access_requested'?'閲覧を申請しました':'閲覧申請の更新';
    return `<button type="button" class="notice-item${row.read_at?' is-read':''}" data-account-notification="${escape(row.id)}"><span class="notice-item-top"><strong>${escape(row.collection_title||'通知')} ${escape(row.question_title||'')}</strong><time>${escape(new Date(row.created_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</time></span><span>${escape(row.available?`${row.actor_name}さんが${action}`:row.unavailable_reason)}</span>${row.body?`<span class="notice-item-body">${escape(row.body)}</span>`:''}</button>`;
   }).join('')+(!shown.length&&!error?`<p class="notice-empty">${busy?'読み込み中…':filter==='unread'?'未読の通知はありません。':'通知はまだありません。'}</p>`:'')+(cursor?'<button type="button" data-notification-more>さらに表示</button>':'');
   list.setAttribute('aria-busy',String(busy));
  }
  async function refresh({more=false}={}){
   if(!syncOwner()||!api()?.loadAccountNotifications)return;
   if(busy)return;busy=true;error='';const token=++request,who=owner;render();
   try{const page=await api().loadAccountNotifications({unreadOnly:filter==='unread',cursor:more?cursor:null});if(token!==request||who!==userId())return;
    items=more?[...items,...page.items.filter(row=>!items.some(old=>old.id===row.id))]:page.items;cursor=page.next_cursor;unread=page.unread_count;
   }catch(e){if(token===request)error='通知を読み込めませんでした。接続を確認して再試行してください。';}
   finally{if(token===request){busy=false;render();}}
  }
  async function mark(ids){const who=syncOwner();if(!who)return;await api().markAccountNotificationsRead(ids);if(who!==userId())return;request++;busy=false;const set=ids&&new Set(ids);let count=0;items=items.map(row=>{if(!row.read_at&&(!set||set.has(row.id))){count++;return {...row,read_at:new Date().toISOString()};}return row;});unread=ids?Math.max(0,unread-count):0;render();await refresh();}
  async function visit(id){
   const who=syncOwner();if(!who||visiting)return false;visiting=true;
   try{const row=await api().getNotificationTarget(id);if(who!==userId())return false;
    if(!row.available){error=row.unavailable_reason;render();element('commentNotificationDialog')?.showModal();return false;}
    const pending=new URL(location.href);pending.searchParams.set('notification',id);history.replaceState(history.state,'',pending);
    element('commentNotificationDialog')?.close();
    if(!await openTarget(row)||who!==userId())return false;
    await mark([id]);const url=new URL(location.href);url.searchParams.delete('notification');history.replaceState(history.state,'',url);return true;
   }catch(e){error=e?.message||'移動先を読み込めませんでした。もう一度通知を開いてお試しください。';render();element('commentNotificationDialog')?.showModal();return false;}finally{visiting=false;}
  }
  async function resume(){const id=new URL(location.href).searchParams.get('notification');if(!id||resuming||!syncOwner()||!isReady())return;resuming=true;try{await visit(id);}finally{resuming=false;}}
  function bindInbox(){
   element('notificationFiltersV314')?.addEventListener('click',event=>{const button=event.target.closest('[data-notification-filter]');if(!button||busy)return;filter=button.dataset.notificationFilter;items=[];cursor=null;void refresh();});
   element('commentNotificationList')?.addEventListener('click',event=>{const row=event.target.closest('[data-account-notification]');if(row){row.disabled=true;void visit(row.dataset.accountNotification).finally(()=>{row.disabled=false;});}else if(event.target.closest('[data-notification-more]'))void refresh({more:true});else if(event.target.closest('[data-notification-retry]'))void refresh();});
  }
  function settingsMarkup(){return '<div id="notificationSettingsV314" class="notification-settings-v314" aria-live="polite">読み込み中…</div>';}
  async function bindSettings(){
   const node=element('notificationSettingsV314');if(!node)return;const who=syncOwner(),token=++settingsRequest;
   if(!who){node.textContent='Discordでログインすると通知を設定できます。';return;}
   try{const loaded=await api().getNotificationPreferences();if(who!==userId()||token!==settingsRequest||!node.isConnected)return;settings=loaded;renderSettings(node);}
   catch{if(token===settingsRequest&&node.isConnected){node.innerHTML='<p>設定を読み込めませんでした。</p><button type="button">再試行</button>';node.querySelector('button').onclick=bindSettings;}}
  }
  function renderSettings(node){
   const p=settings.preferences,selected=new Set(settings.subscriptions),available=new Set(settings.collections.map(c=>c.id));
   node.innerHTML=`<form><p>設定と既読状態は、ログイン中のアカウントで同期します。</p>${Object.entries(labels).map(([key,label])=>`<label class="notification-toggle-v314"><span>${label}</span><input type="checkbox" role="switch" name="${key}" ${p[key]?'checked':''}></label>`).join('')}<fieldset class="notification-books-v314"><legend>問題追加の通知を受け取る本</legend><p>シリーズは、今後追加される巻も含みます。</p><div>${settings.collections.map(c=>`<label><input type="checkbox" name="book" value="${escape(c.id)}" ${selected.has(c.id)?'checked':''}><span>${escape(c.title)}${c.series_key?'（シリーズ）':''}</span></label>`).join('')||'<p>選択できる問題集はありません。</p>'}</div></fieldset><p>OFFにすると新しい通知を止めます。過去の通知は残ります。</p><button type="submit" class="primary">通知設定を保存</button><p data-notification-status role="status"></p></form>`;
   const form=node.querySelector('form');const update=()=>{const on=form.elements.enabled.checked;for(const key of Object.keys(labels))if(key!=='enabled')form.elements[key].disabled=!on;form.querySelector('fieldset').disabled=!on||!form.elements.added_questions.checked;};update();form.addEventListener('change',update);
   form.addEventListener('submit',async event=>{event.preventDefault();const who=userId(),button=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]');button.disabled=true;status.textContent='保存中…';
    const preferences=Object.fromEntries(Object.keys(labels).map(k=>[k,form.elements[k].checked]));
    const subscriptions=[...selected].filter(id=>!available.has(id)).concat([...form.querySelectorAll('[name=book]:checked')].map(input=>input.value));
    try{const saved=await api().saveNotificationPreferences(preferences,subscriptions);if(who!==userId()||!node.isConnected)return;settings=saved;status.textContent='保存しました。';}catch(e){status.textContent=e?.message||'保存できませんでした。再試行してください。';}finally{button.disabled=false;}
   });
  }
  return {badge,render,refresh,resume,settingsMarkup,bindSettings,bindInbox,
   async open(){render();element('commentNotificationDialog')?.showModal();await refresh();},
   async markAll(){try{await mark(null);}catch{error='既読にできませんでした。再試行してください。';render();}},
   count(questionId){syncOwner();return items.filter(row=>row.kind==='comment'&&!row.read_at&&row.question_id===questionId).length;},
   async accountChanged(){syncOwner();badge();await refresh();await resume();}
  };
 }
 root.MinkiruNotificationsV314={create};
})(typeof window==='undefined'?globalThis:window);
