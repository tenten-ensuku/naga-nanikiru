(function(host){
  'use strict';
  let active=null;
  function markup(){
    return '<section class="book-delete-v244" aria-labelledby="bookDeleteHeadingV244"><div><h4 id="bookDeleteHeadingV244">問題集の削除</h4><p>この問題集を本棚・学習対象から削除します。実行前に対象を確認できます。</p></div><button type="button" class="book-delete-button-v244" data-book-delete-v244>削除</button></section>';
  }
  async function open({target,api,getActor,onDeleted,trigger}){
    if(active)return;
    const actor=getActor();
    if(!actor||!target?.share_slug)return;
    const dialog=document.createElement('dialog');
    dialog.className='book-delete-dialog-v244';
    dialog.setAttribute('aria-labelledby','bookDeleteTitleV244');
    dialog.setAttribute('aria-describedby','bookDeleteDescriptionV244');
    dialog.innerHTML='<h2 id="bookDeleteTitleV244">この問題集を削除しますか？</h2><p class="book-delete-name-v244"></p><p id="bookDeleteDescriptionV244">削除する範囲を確認しています…</p><p class="book-delete-retention-v244">誤削除に備えて、問題・回答履歴・画像のデータは保管します。元に戻したい場合は管理者へご相談ください。</p><p class="book-delete-status-v244" role="status" aria-live="polite"></p><div class="book-delete-actions-v244"><button type="button" data-delete-cancel autofocus>キャンセル</button><button type="button" class="book-delete-button-v244" data-delete-confirm disabled>削除する</button></div>';
    const name=dialog.querySelector('.book-delete-name-v244');
    const description=dialog.querySelector('#bookDeleteDescriptionV244');
    const status=dialog.querySelector('.book-delete-status-v244');
    const cancel=dialog.querySelector('[data-delete-cancel]');
    const confirm=dialog.querySelector('[data-delete-confirm]');
    const state={dialog,pending:false,preview:null};active=state;
    name.textContent=target.title||'選択した問題集';
    const close=()=>{if(state.pending)return;dialog.close();};
    dialog.addEventListener('cancel',event=>{if(state.pending)event.preventDefault();});
    dialog.addEventListener('close',()=>{if(active===state)active=null;dialog.remove();if(trigger?.isConnected)trigger.focus();},{once:true});
    cancel.addEventListener('click',close);
    confirm.addEventListener('click',async()=>{
      if(state.pending||!state.preview||active!==state)return;
      if(getActor()!==actor){status.textContent='ログイン状態が変わりました。閉じて確認し直してください。';confirm.disabled=true;return;}
      state.pending=true;confirm.disabled=true;cancel.disabled=true;
      status.textContent='削除しています…';dialog.setAttribute('aria-busy','true');
      try{
        const result=await api.deleteCollection(target.share_slug,state.preview.confirmation_token);
        if(result?.deleted!==true)throw new Error('削除を確認できませんでした。');
        status.textContent='問題集を削除しました。本棚へ戻ります。';
        state.pending=false;dialog.close();
        // Account switching while a request was in flight must not alter the
        // new account's remembered selection or navigation state.
        if(getActor()===actor)onDeleted(result);
      }catch(error){
        status.textContent=error?.message||'削除を確認できませんでした。接続を確認して、もう一度お試しください。';
        state.pending=false;cancel.disabled=false;
        confirm.disabled=getActor()!==actor||error?.code==='collection_deletion_changed';
        dialog.removeAttribute('aria-busy');
      }
    });
    document.body.append(dialog);dialog.showModal();cancel.focus();
    try{
      const preview=await api.previewCollectionDeletion(target.share_slug);
      if(active!==state||!dialog.isConnected)return;
      if(getActor()!==actor)throw new Error('ログイン状態が変わりました。閉じて確認し直してください。');
      if(preview?.share_slug!==target.share_slug||!Number.isSafeInteger(preview.question_count)||preview.question_count<0||!Number.isSafeInteger(preview.child_count)||preview.child_count<0||!Number.isSafeInteger(preview.collection_count)||preview.collection_count!==preview.child_count+1||!/^[a-f0-9]{64}$/.test(preview.confirmation_token||''))throw new Error('削除対象を確認できませんでした。閉じて、もう一度お試しください。');
      name.textContent=preview.title;
      const scope=preview.child_count>0?`このシリーズと含まれる${preview.child_count}冊（合計${preview.question_count}問）`: `この${preview.is_volume?'巻':'問題集'}（${preview.question_count}問）`;
      description.textContent=`${scope}を本棚・学習対象から削除します。共有している利用者も、この問題集を開けなくなります。${preview.is_volume?'他の巻は削除しません。':''}`;
      state.preview=preview;confirm.disabled=false;
    }catch(error){if(active===state){description.textContent='削除は行われていません。';status.textContent=error?.message||'削除対象を確認できませんでした。接続を確認してください。';confirm.disabled=true;}}
  }
  function bind(options){
    const button=document.querySelector('[data-book-delete-v244]');
    if(!button||button.dataset.deletionBound)return;
    button.dataset.deletionBound='true';
    button.addEventListener('click',()=>void open({...options,trigger:button}));
  }
  host.MinkiruCollectionDeletionV244={markup,bind,open};
})(globalThis);
