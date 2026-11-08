import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
function source(name){const m=html.match(new RegExp(`^      (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^      \\}`, 'm'));assert.ok(m,name);return m[0];}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode=s=>s.replace(/&(amp|lt|gt|quot|#39);/g,(_,c)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[c]));
// DOM surface used by the status area: textContent discards child buttons.
class Status {
  classList={remove(){},toggle(){}};
  set innerHTML(value){this.markup=value;}
  get innerHTML(){return this.markup||'';}
  set textContent(value){this.markup=escape(value);}
  get textContent(){return decode(this.innerHTML.replace(/<[^>]*>/g,''));}
  get buttons(){return [...this.innerHTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([,attrs,label])=>({textContent:decode(label),dataset:Object.fromEntries([...attrs.matchAll(/data-([a-z0-9-]+)="([^"]*)"/g)].map(([,key,value])=>[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),decode(value)]))}));}
  querySelector(){return this.buttons.find(b=>b.dataset.generatorExisting)||null;}
  insertAdjacentHTML(position,markup){assert.equal(position,'beforeend');this.markup+=markup;}
}
function harness(n=1){
  const status=new Status(),results={},navigations=[],opened=[],destination={kind:'shared',shareSlug:'book2',label:'第2巻',row:{visibility:'private'}};
  const ctx=vm.createContext({URL,document:{getElementById:id=>id==='generatorStatus'?status:id==='generatorResults'?results:null},
    escapeHtml:escape,currentGeneratorDestinationV130:()=>destination,selectedGeneratorCandidateIndexesV249:()=>Array.from({length:n},(_,i)=>i),
    canAddGeneratedQuestionV130:()=>true,supabaseSessionV46:{user:{id:'author'}},sharedCollectionV46:{share_slug:'book2'},
    questionsV16:[],generatorCandidatesV44:Array.from({length:n},(_,i)=>({id:'candidate'+i,boardScene:{}})),
    generatorSelectedCandidatesV158:new Set(Array.from({length:n},(_,i)=>i)),generatorAddedKeysV130:new Set(),generatorDuplicateKeysV153:new Set(),generatorCommentDraftsV273:new Map(),
    generatedHandIsValidV237:()=>true,prepareJsonBoardV248:()=>true,nextQuestionNumberV154:()=>1,currentUserDisplayNameV47:()=> '作者',normalizeDiscordThreadUrlV222:x=>x,
    renderGeneratorCandidatesV44:()=>'',bindGeneratorCandidateInputsV44:()=>{},setGeneratorStageV159:()=>{},renderQuestionOptionsV16:()=>{},refreshBookCapacityV235:()=>{},
    window:{NagaGenerationConfirmV241:{ask:async()=>true},MinkiruCommentToolsV274:{getAttachments:async()=>[]},confirm:()=>true,
      location:{href:'https://minkiru.naga-study.workers.dev/?collection=book2&view=generator',assign:url=>navigations.push(url)},
      NagaSupabase:{createCollectionVolume:async()=>({share_slug:'book3'})}},
    showMenuV16:view=>opened.push(view),openQuestionV16:index=>opened.push(index)});
  for(const name of ['generatorExistingButtonMarkupV359','setGeneratorStatusV44','showGeneratorExistingStatusV153','navigateToExistingGeneratorQuestionV153','addSelectedGeneratorQuestionsV158','addGeneratedQuestionV44'])vm.runInContext(source(name),ctx);
  return {ctx,status,results,navigations,opened,destination};
}
test('bulk completion keeps a real existing-question button and its navigation target',async()=>{
  const h=harness();h.ctx.invokeSharedMutationV47=async()=>({id:'existing-id',alreadyExists:true,shareSlug:'book2'});
  await h.ctx.addSelectedGeneratorQuestionsV158();assert.equal(h.status.buttons.length,1);assert.equal(h.status.buttons[0].textContent,'既存問題へ移動');
  h.ctx.navigateToExistingGeneratorQuestionV153(h.status.buttons[0]);
  const url=new URL(h.navigations[0]);assert.equal(url.searchParams.get('collection'),'book2');assert.equal(url.searchParams.get('existing_question'),'existing-id');
  assert.equal(h.ctx.questionsV16.length,0);assert.equal(h.ctx.generatorSelectedCandidatesV158.size,1);
});
test('ten duplicates retain ten distinct destinations; repeated destinations are grouped',async()=>{
  const h=harness(10);let n=0;h.ctx.invokeSharedMutationV47=async()=>({id:'existing-'+n++,alreadyExists:true,shareSlug:'book2'});
  await h.ctx.addSelectedGeneratorQuestionsV158();assert.equal(h.status.buttons.length,10);
  assert.equal(h.status.buttons[9].textContent,'候補10の既存問題へ移動');assert.equal(h.status.buttons[9].dataset.generatorExistingQuestion,'existing-9');
  const grouped=harness(2);grouped.ctx.invokeSharedMutationV47=async()=>({id:'same',alreadyExists:true,shareSlug:'book2'});
  await grouped.ctx.addSelectedGeneratorQuestionsV158();assert.equal(grouped.status.buttons.length,1);
});
test('a later unrelated error does not remove a previous duplicate navigation button',async()=>{
  const h=harness(2);let n=0;h.ctx.invokeSharedMutationV47=async()=>{if(n++)throw Error('通信エラー');return {id:'existing',alreadyExists:true,shareSlug:'book2'};};
  await h.ctx.addSelectedGeneratorQuestionsV158();assert.match(h.status.textContent,/通信エラー/);assert.equal(h.status.buttons[0].dataset.generatorExistingQuestion,'existing');
});
test('duplicate found after a full-volume rollover opens the actual next volume',async()=>{
  const h=harness(),writes=[];h.ctx.invokeSharedMutationV47=async(action,payload)=>{writes.push(payload.shareSlug);return writes.length===1?{capacityReached:true,nextVolume:3,parentShareSlug:'series'}:{id:'next-existing',alreadyExists:true,shareSlug:'book3'};};
  await h.ctx.addSelectedGeneratorQuestionsV158();assert.deepEqual(writes,['book2','book3']);assert.equal(h.status.buttons[0].dataset.generatorExistingCollection,'book3');
  h.ctx.navigateToExistingGeneratorQuestionV153(h.status.buttons[0]);assert.equal(new URL(h.navigations[0]).searchParams.get('collection'),'book3');
});
test('already loaded existing question opens in place and target metadata is escaped',()=>{
  const h=harness();h.ctx.questionsV16.push({id:'q',serverQuestionId:'existing'});
  h.ctx.showGeneratorExistingStatusV153('登録済み',{sharedSlug:'book2',questionId:'existing'});h.ctx.navigateToExistingGeneratorQuestionV153(h.status.buttons[0]);
  assert.deepEqual(h.opened,['my',0]);assert.equal(h.navigations.length,0);
  const markup=h.ctx.generatorExistingButtonMarkupV359({sharedSlug:'"><img src=x>',questionId:'" onclick="bad'},'<実行>');
  assert.doesNotMatch(markup,/<img|" onclick=/);assert.match(markup,/&lt;実行&gt;/);assert.equal(h.ctx.generatorExistingButtonMarkupV359({}), '');
});
