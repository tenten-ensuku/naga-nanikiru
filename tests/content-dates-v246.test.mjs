import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {readRpc} from '../cloudflare/read-api.mjs';
import {builderRpc} from '../cloudflare/collection-builder-v235.mjs';
const read = file => fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const dateSource=read('public/content-dates-v246.js'),html=read('public/index.html');
function datesContext(){const ctx=vm.createContext({window:{},Date,Intl,queueMicrotask});vm.runInContext(dateSource,ctx);return ctx;}
const dates=datesContext().window.MinkiruContentDatesV246;

test('recorded dates stay in Japan time without a timezone suffix, reject invalid values and never invent a current date',()=>{
  assert.equal(dates.timestamp('2026-09-13T16:05:00Z').date,'2026/09/14');
  assert.equal(dates.timestamp('2026-09-14T01:05:00+09:00').full,'2026/09/14 01:05');
  assert.equal(dates.timestamp('2026-09-13T16:05:00Z').full,'2026/09/14 01:05');
  assert.equal(dates.timestamp('2026-09-14').date,'2026/09/14');
  for(const value of [null,undefined,'',0,{},'invalid','2026-02-30','2026-02-30T10:00:00Z','2026-09-14T01:00:00'])assert.equal(dates.timestamp(value),null);
  assert.equal(dates.questionCreated({}),null);
  assert.equal(dates.questionCreated({createdAt:'bad',created_at:'2026-08-01T00:00:00Z'}).date,'2026/08/01');
  const now=Date.parse('2026-09-14T00:00:00Z');
  assert.equal(dates.isRecent(dates.timestamp('2026-09-07T00:00:00.001Z'),now),true);
  assert.equal(dates.isRecent(dates.timestamp('2026-09-07T00:00:00Z'),now),false);
  assert.equal(dates.isRecent(dates.timestamp('2026-09-15T00:00:00Z'),now),false);
  assert.equal(dates.isRecent(null,now),false);
  assert.equal(dates.bookUpdated({last_activity_at:'2026-09-14T00:00:00Z'}),null);
});

function fixture(t){
  const db=testD1();t.after(()=>db.close());
  db.sqlite.exec(`INSERT INTO profiles(id) VALUES('owner'),('outsider');
    INSERT INTO collections(id,owner_id,title,share_slug,created_at,updated_at) VALUES
    ('book','owner','Fixture','book','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'),
    ('other','owner','Other','other','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z');
    INSERT INTO questions(id,collection_id,created_by,title,payload,created_at,updated_at) VALUES
    ('q1','book','owner','問題1','{"id":"q1","number":1,"createdAt":"2026-07-20T00:00:00Z"}','2026-08-02T00:00:00Z','2026-09-10T18:00:00+09:00'),
    ('q2','other','owner','別の本','{}','2026-09-14T00:00:00Z','2026-09-14T00:00:00Z');`);
  return {db,actor:{id:'owner'}};
}

test('book update metadata is content-only, scoped, normalized and read-only',async t=>{
  const ctx=fixture(t),{db}=ctx;
  db.sqlite.exec("INSERT INTO answer_attempts(client_attempt_id,user_id,question_id,grade,answer,answered_at) VALUES('answer','owner','q1','◎','{}','2026-09-14T00:00:00Z')");
  const before=db.sqlite.prepare('SELECT total_changes() n').get().n;
  const [summary]=await readRpc('get_collection_library_summary',{p_share_slug:'book'},ctx);
  assert.equal(summary.content_updated_at,'2026-09-10T09:00:00.000Z');
  assert.equal(summary.last_activity_at,'2026-09-14T00:00:00Z');
  const books=await readRpc('list_my_collections',{},ctx);
  assert.equal(books.find(b=>b.share_slug==='book').content_updated_at,summary.content_updated_at);
  assert.equal(db.sqlite.prepare('SELECT total_changes() n').get().n,before);
  await assert.rejects(readRpc('get_collection_library_summary',{p_share_slug:'book'},{...ctx,actor:{id:'outsider'}}),error=>error.status===403);
  assert.deepEqual(await readRpc('list_my_collections',{},{...ctx,actor:{id:'outsider'}}),[]);
  db.sqlite.exec("UPDATE questions SET updated_at='2026-09-14T01:00:00Z' WHERE id='q1'");
  assert.equal((await readRpc('get_collection_library_summary',{p_share_slug:'book'},ctx))[0].content_updated_at,'2026-09-14T01:00:00.000Z');
  db.sqlite.exec("UPDATE collections SET updated_at='2026-09-14T02:00:00Z' WHERE id='book'");
  assert.equal((await readRpc('get_collection_library_summary',{p_share_slug:'book'},ctx))[0].content_updated_at,'2026-09-14T02:00:00.000Z');
});

test('volume metadata uses each volume date rather than a sibling or personal answer',async t=>{
  const ctx=fixture(t);
  ctx.db.sqlite.exec("UPDATE collections SET series_key='series' WHERE id='other'; UPDATE collections SET series_key='series',series_parent_id='other',volume_number=1 WHERE id='book';");
  const volumes=await readRpc('get_collection_volumes',{p_share_slug:'other'},ctx);
  assert.equal(volumes.length,1);assert.equal(volumes[0].share_slug,'book');
  assert.equal(volumes[0].content_updated_at,'2026-09-10T09:00:00.000Z');
  assert.deepEqual(await readRpc('get_collection_volumes',{p_share_slug:'other'},{...ctx,actor:{id:'outsider'}}),[]);
});

test('question index and full detail preserve the same original creation date; imports keep it',async t=>{
  const ctx=fixture(t);
  const [index]=await readRpc('get_shared_question_index_page',{p_share_slug:'book'},ctx);
  const [detail]=await readRpc('get_shared_question_detail',{p_share_slug:'book',p_question_id:'q1'},ctx);
  assert.equal(index.generated_at,detail.payload.createdAt);
  assert.equal(index.created_at,'2026-08-02T00:00:00Z');assert.equal('payload' in index,false);
  ctx.db.sqlite.prepare('UPDATE questions SET payload=? WHERE id=?').run(JSON.stringify({...detail.payload,generatedAt:'x'.repeat(10000)}),'q1');
  assert.equal((await readRpc('get_shared_question_index_page',{p_share_slug:'book'},ctx))[0].generated_at,'2026-07-20T00:00:00Z');
  const imported=await builderRpc('import_shared_question',{p_source_question_id:'q1',p_target_share_slug:'other'},ctx);
  const payload=JSON.parse(ctx.db.sqlite.prepare('SELECT payload FROM questions WHERE id=?').get(imported.question_id).payload);
  assert.equal(payload.createdAt,'2026-07-20T00:00:00Z');
  ctx.db.sqlite.exec("UPDATE questions SET payload='{\"id\":\"q1\",\"number\":1}' WHERE id='q1'; INSERT INTO collections(id,owner_id,title,share_slug) VALUES('target','owner','Target','target');");
  const copy=await builderRpc('import_shared_question',{p_source_question_id:'q1',p_target_share_slug:'target'},ctx);
  assert.equal(JSON.parse(ctx.db.sqlite.prepare('SELECT payload FROM questions WHERE id=?').get(copy.question_id).payload).createdAt,'2026-08-02T00:00:00Z');
});

test('bookshelf displays recent content badges, exact dates and unknown values without changing order',()=>{
  const ctx=datesContext();vm.runInContext(read('public/library-v214.js'),ctx);
  const library=ctx.window.MinkiruLibraryV214.create();
  const collections=[{title:'新しい本',share_slug:'new',can_view:true,content_updated_at:new Date(Date.now()-60000).toISOString()},
    {title:'以前の本',share_slug:'old',can_view:true,content_updated_at:'2020-01-01T00:00:00Z',last_activity_at:new Date().toISOString()},
    {title:'不明の本',share_slug:'unknown',can_view:true},
    {title:'非公開の本',share_slug:'private',can_view:false,content_updated_at:new Date().toISOString()}];
  const render=current=>library.render({collections,userId:'owner',current:{share_slug:current}});
  const recent=render('new');
  assert.equal((recent.match(/class="library-update-marker-v246"/g)||[]).length,1);
  assert.doesNotMatch(recent,/class="library-current-marker"/,'one marker above the current spine, without overlapping labels');
  assert.match(recent,/最終更新日/);assert.match(recent,/7日以内に更新/);
  assert.ok(recent.indexOf('data-library-book="new"')<recent.indexOf('data-library-book="old"'));
  assert.match(render('old'),/2020\/01\/01 09:00<\/time>/);
  assert.doesNotMatch(render('old'),/JST/);
  assert.match(render('unknown'),/最終更新日<\/span><span>不明<\/span>/);
  assert.equal(ctx.window.MinkiruLibraryV214.normaliseBook(collections[3]).contentUpdated,null);
});

test('app wiring renders dates in lists and questions without polls or guessed timestamps',()=>{
  assert.match(html,/content-dates-v246\.js\?v=303/);assert.match(html,/content-dates-v246\.css\?v=303/);
  assert.match(html,/id="questionCreatedDateV246"/);
  assert.match(html,/class="question-created-v246">\$\{questionCreatedMarkupV246\(question, \{ label: false \}\)\}/);
  const normalize=html.match(/      function normalizeSharedQuestionV66\([^]*?\n      \}/)[0];
  assert.doesNotMatch(normalize,/new Date\(\)/);
  const ctx=datesContext();Object.assign(ctx,{sharedCollectionV46:null,finiteQuestionNumberV154:value=>Number(value)||null,
    normalizeNimaKanQuestionV112:x=>x,normalizePierreImmediatePonQuestionV146:x=>x,stripLegacyGeneratedQuestionCommentsV220:x=>x,
    isNimaCollectionV105:()=>false,normalizeQuestionTitleV79:x=>x});
  vm.runInContext(normalize,ctx);
  const full=ctx.normalizeSharedQuestionV66({id:'q',created_at:'2026-09-14T00:00:00Z',payload:{createdAt:'2026-08-02T00:00:00Z'}});
  const index=ctx.normalizeSharedQuestionV66({id:'q',created_at:'2026-09-14T00:00:00Z',generated_at:'2026-08-02T00:00:00Z'});
  assert.equal(full.question.createdAt,index.question.createdAt);
  assert.equal(ctx.normalizeSharedQuestionV66({id:'unknown'}).question.createdAt,null);
  assert.doesNotMatch(dateSource,/fetch\(|setInterval\(|localStorage|sessionStorage/);
});

test('V257 opening acknowledges only that book revision, persists across reload and shows later updates again',async()=>{
  const ctx=datesContext();vm.runInContext(read('public/library-v214.js'),ctx);
  const stored=new Map();const now=Date.now();
  const collections=['a','b'].map(share_slug=>({share_slug,title:share_slug,can_view:true,content_updated_at:new Date(now-60000).toISOString()}));
  const options={onOpen:async()=>true,loadSeenUpdates:user=>stored.get(user)||[],saveSeenUpdates:(user,entries)=>stored.set(user,JSON.parse(JSON.stringify(entries)))};
  let library=ctx.window.MinkiruLibraryV214.create(options);
  const render=(user='owner')=>library.render({collections,userId:user});
  const badges=markup=>(markup.match(/class="library-update-marker-v246"/g)||[]).length;
  assert.equal(badges(render()),2);assert.equal(stored.size,0,'render/selection does not acknowledge');
  assert.equal(await library.openBook('a'),true);assert.equal(badges(render()),1);
  assert.doesNotMatch(render().match(/<section class="library-detail"[^]*?<\/section>/)[0],/7日以内に更新/);
  library=ctx.window.MinkiruLibraryV214.create(options);assert.equal(badges(render()),1);
  assert.equal(badges(render('other-user')),2);assert.equal(badges(render()),1);
  collections[0].content_updated_at=new Date(now-1000).toISOString();assert.equal(badges(render()),2);
  assert.equal(stored.get('owner')[0][1],now-60000,'record observed content timestamp, not wall-clock time');
});

test('V257 failed or forbidden opens and account changes do not clear an update marker',async()=>{
  const ctx=datesContext();vm.runInContext(read('public/library-v214.js'),ctx);
  const row={share_slug:'a',title:'a',can_view:true,content_updated_at:new Date(Date.now()-60000).toISOString()};
  for(const onOpen of [()=>false,()=>{throw Error('failed');}]){
    let writes=0;const library=ctx.window.MinkiruLibraryV214.create({onOpen,saveSeenUpdates:()=>writes++});
    library.render({collections:[row],userId:'owner'});assert.equal(await library.openBook('a'),false);
    assert.match(library.render({collections:[row],userId:'owner'}),/library-update-marker-v246/);assert.equal(writes,0);
  }
  let finish,writes=0;const library=ctx.window.MinkiruLibraryV214.create({onOpen:()=>new Promise(resolve=>finish=resolve),saveSeenUpdates:()=>writes++});
  library.render({collections:[row],userId:'owner'});const opening=library.openBook('a');
  library.render({collections:[row],userId:'other'});finish(true);await opening;assert.equal(writes,0);
  assert.match(library.render({collections:[row],userId:'other'}),/library-update-marker-v246/);
});

test('V257 update marker sits above the spine without moving its title, and storage is account-scoped',()=>{
  const css=read('public/content-dates-v246.css');
  assert.match(css,/bottom:calc\(100% \+ 7px\)/);
  assert.doesNotMatch(css,/\.library-book:has\(.library-update-marker/);
  assert.match(html,/library-seen-updates-v257:\$\{userId\}/);
  assert.match(html,/saveSeenUpdates: \(userId, entries\) => \{\s*if \(!userId \|\| String\(supabaseSessionV46\?\.user\?\.id \|\| ""\) !== userId\) return;/);
});
