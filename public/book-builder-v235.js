(function(host){
  'use strict';
  const tones=Object.freeze([
    ['walnut','胡桃','#614930'],['navy','紺','#193950'],['forest','深緑','#3d5235'],['burgundy','葡萄酒','#633333'],
    ['plum','紫','#62406f'],['teal','青緑','#27635f'],['ochre','山吹','#a17930'],['ivory','象牙','#d5cdc1']
  ]);
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function palette(prefix,selected='walnut'){
    return `<fieldset class="book-colors-v235"><legend>本の色</legend><div>${tones.map(([key,name,color])=>`<label title="${name}"><input type="radio" name="${prefix}Tone" value="${key}"${key===selected?' checked':''}><span style="--swatch:${color}"></span>${name}</label>`).join('')}</div></fieldset>`;
  }
  function appearance(prefix){
    return `<div class="book-appearance-v235"><figure><div class="book-preview-v235 library-tone-walnut" data-book-preview><img src="assets/library-v214/spine.webp" width="160" height="960" alt=""><span class="library-leather-tint"></span><strong data-book-preview-title>あなたの問題集</strong><small>1</small></div><figcaption>本棚での背表紙</figcaption></figure><div>${palette(prefix)}<p class="book-hint-v235">自分らしい一冊に。色は後から変更できます。<br>1冊200問まで。195問から次巻をご案内します。</p></div></div>`;
  }
  function bindPreview(form,prefix){
    const update=()=>{const node=form.querySelector('[data-book-preview]');if(!node)return;const selected=form.querySelector(`input[name="${prefix}Tone"]:checked`)?.value||'walnut';node.className=`book-preview-v235 library-tone-${tones.some(t=>t[0]===selected)?selected:'walnut'}`;form.querySelector('[data-book-preview-title]').textContent=form.querySelector(`#${prefix}Title`)?.value.trim()||'あなたの問題集';};
    form.addEventListener('input',update);form.addEventListener('change',update);update();return update;
  }
  function capacityMarkup(c){
    if(!c||!Number.isSafeInteger(c.question_count))return '<p>収録数を確認できません。接続を確認して保存先を選び直してください。</p>';
    const total=c.question_count;
    return `<div class="book-capacity-heading-v235"><strong>${escape(c.collection_title)}</strong><span><b>${total}</b> / 200問</span></div><progress max="200" value="${Math.min(total,200)}" aria-label="収録数"></progress><p>${total>=200?'この巻は満杯です。':`あと${200-total}問追加できます。`}</p>${total>=195?`<div class="book-next-v235"><p>一冊の問題集に収録できるのは200問までです。<br>「${escape(c.next_title)}」${c.next_share_slug?'を使いますか？':'を作成しますか？'}</p>${c.can_create_volume||c.next_share_slug?`<button type="button" data-next-volume-v235>${c.next_share_slug?'次の巻を保存先にする':'次の巻を作成して使う'}</button>`:'<small>次巻の作成は問題集の所有者に依頼してください。</small>'}<small>現在の問題・回答履歴はそのまま残ります。</small></div>`:''}`;
  }
  host.MinkiruBookBuilderV235={tones,palette,appearance,bindPreview,capacityMarkup};
})(globalThis);
