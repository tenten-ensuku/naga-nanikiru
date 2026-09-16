import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {builderRpc} from '../cloudflare/collection-builder-v235.mjs';

const migration=fs.readFileSync(new URL('../cloudflare/migrations/0005_retired_question_images_v260.sql',import.meta.url),'utf8');
const oldKey='naga-question-assets/book/report/question.webp';
const privateKey='question-assets/owner/book/question.png';
const publicUrl='https://fixture.test/v1/public/'+oldKey;
const privateUrl='https://fixture.test/v1/private/'+privateKey;
const unrelated='https://fixture.test/v1/public/naga-question-assets/another-book/report/question.webp';
function setupD1(t){
  const db=testD1({generation:true,discord:true});t.after(()=>db.close());
  db.sqlite.exec(`INSERT INTO profiles(id) VALUES('owner');
    INSERT INTO collections(id,owner_id,title,share_slug) VALUES('book','owner','Fixture','fixture');
    INSERT INTO generation_jobs(id,requested_by,collection_id,source_kind,source_url,source_report_id)
      VALUES('job','owner','book','naga_scene','https://fixture.test/naga','report');`);
  db.sqlite.prepare('INSERT INTO private_media_budget(singleton,inventory_checked_at) VALUES(1,?)').run(new Date().toISOString());
  db.sqlite.exec(migration);
  return db;
}
function setup(t){return setupD1(t).sqlite;}
function retire(db,...keys){for(const key of keys)db.prepare('INSERT INTO private_retired_question_images(object_key) VALUES(?)').run(key);}
function question(db,id,payload={}){return db.prepare("INSERT INTO questions(id,collection_id,created_by,payload) VALUES(?,'book','owner',?)").run(id,typeof payload==='string'?payload:JSON.stringify(payload));}
function comment(db,id,body='Fixture',attachments=[]){return db.prepare("INSERT INTO comments(id,collection_id,user_id,body,attachments) VALUES(?,'book','owner',?,?)").run(id,body,JSON.stringify(attachments));}
function candidate(db,id,tv,payload={}){return db.prepare("INSERT INTO generation_candidates(id,job_id,scene_tw,scene_ts,scene_tv,decision_type,candidate_payload) VALUES(?,'job',0,0,?,'discard',?)").run(id,tv,JSON.stringify(payload));}
function media(db,key){const bucket=key.slice(0,key.indexOf('/')),path=key.slice(key.indexOf('/')+1);db.prepare("INSERT INTO media_assets(object_key,bucket,path,owner_id,collection_id,size_bytes,sha256,content_type,state) VALUES(?,?,?,'owner','book',100,?,'image/webp','ready')").run(key,bucket,path,'a'.repeat(64));}

function guardSelectForReadOnly(){
  const start=migration.indexOf('WITH RECURSIVE');
  // RAISE is legal only inside a trigger. These read-only checks stay under
  // the input budget; actual oversized writes exercise the original RAISE.
  return migration.slice(start,migration.indexOf('\n  );',start)).replace('NEW.payload','?')
    .replace("RAISE(ABORT,'question_image_reference_too_complex')",'NULL');
}

function runPythonSqlite(t,python){
  const files=['0001_minkiru.sql','0002_collection_builder_v235.sql','0003_generation_v241.sql','0004_discord_sync_v242.sql','0005_retired_question_images_v260.sql']
    .map(name=>fileURLToPath(new URL('../cloudflare/migrations/'+name,import.meta.url)));
  const interpreters=[process.env.MINKIRU_SQLITE_LIMIT_PYTHON,'python3','python'].filter(Boolean);
  for(const interpreter of [...new Set(interpreters)]){
    const result=spawnSync(interpreter,['-c',python,...files],{encoding:'utf8',windowsHide:true,timeout:30_000});
    if(result.error?.code==='ENOENT'||result.status===77)continue;
    assert.equal(result.error,undefined,result.error?.message);
    assert.equal(result.status,0,result.stderr||result.stdout);
    return JSON.parse(result.stdout.trim());
  }
  t.skip('Python with sqlite3 is required; set MINKIRU_SQLITE_LIMIT_PYTHON to its executable.');
}

test('migration is additive and activates only operator-selected image keys',t=>{
  const db=setup(t);
  question(db,'old',{image:publicUrl});comment(db,'old-comment',publicUrl);
  assert.equal(db.prepare('SELECT count(*) AS n FROM private_retired_question_images').get().n,0);
  retire(db,oldKey);
  assert.equal(JSON.parse(db.prepare("SELECT payload FROM questions WHERE id='old'").get().payload).image,publicUrl);
  assert.equal(db.prepare("SELECT body FROM comments WHERE id='old-comment'").get().body,publicUrl);
  assert.doesNotThrow(()=>question(db,'unrelated',{image:unrelated}));
  assert.doesNotThrow(()=>question(db,'suffix',{image:publicUrl+'-copy'}));
  assert.throws(()=>question(db,'blocked',{image:publicUrl}),/question_image_retired/);
  assert.throws(()=>retire(db,'comment-assets/book/attachment.png'),/CHECK constraint failed/);
  assert.throws(()=>retire(db,'naga-question-assets/../question.png'),/CHECK constraint failed/);
});

test('both retired buckets block stale imports, legacy URLs, and encoded JSON strings',t=>{
  const db=setup(t);retire(db,oldKey,privateKey);
  const references=[publicUrl,privateUrl,oldKey,'book/report/question.webp',
    'https://old.example/storage/v1/object/public/'+oldKey,
    'https://old.example/storage/v1/object/sign/'+oldKey+'?token=fixture',
    'https://fixture.test/v1/public/'+oldKey.replaceAll('/','%2F')];
  for(const [i,image] of references.entries())assert.throws(()=>question(db,'blocked-'+i,{image}),/question_image_retired/);
  const escaped=JSON.stringify({comments:[{attachments:[{path:'book/report/question.webp'}]}]}).replaceAll('/',String.raw`\/`).replace('question',String.raw`\u0071uestion`);
  assert.throws(()=>question(db,'escaped',escaped),/question_image_retired/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM questions').get().n,0);
});

test('a late stale editor cannot overwrite a JSON board but unrelated edits succeed',t=>{
  const db=setup(t);question(db,'converted',{boardScene:{schema:1},image:null});question(db,'other',{image:unrelated});
  retire(db,oldKey);
  assert.throws(()=>db.prepare("UPDATE questions SET payload=? WHERE id='converted'").run(JSON.stringify({image:publicUrl})),/question_image_retired/);
  assert.doesNotThrow(()=>db.prepare("UPDATE questions SET title='renamed',payload=? WHERE id='other'").run(JSON.stringify({title:'renamed',image:unrelated})));
  assert.doesNotThrow(()=>db.prepare("UPDATE questions SET payload=? WHERE id='converted'").run(JSON.stringify({boardScene:{schema:1},image:null,comments:[{body:'updated'}]})));
  assert.equal(JSON.parse(db.prepare("SELECT payload FROM questions WHERE id='converted'").get().payload).image,null);
});

test('comment text and path-only attachments are guarded on insert and update',t=>{
  const db=setup(t);comment(db,'clean');retire(db,oldKey,privateKey);
  assert.throws(()=>comment(db,'body','See '+publicUrl),/question_image_retired/);
  assert.throws(()=>comment(db,'attachment','',[{path:'owner/book/question.png'}]),/question_image_retired/);
  assert.throws(()=>db.prepare("UPDATE comments SET body=? WHERE id='clean'").run(publicUrl),/question_image_retired/);
  assert.throws(()=>db.prepare("UPDATE comments SET attachments=? WHERE id='clean'").run(JSON.stringify([{bucket:'naga-question-assets',path:'book/report/question.webp'}])),/question_image_retired/);
  assert.doesNotThrow(()=>comment(db,'safe','Another image',[{path:'another-book/report/question.webp'}]));
  assert.doesNotThrow(()=>db.prepare("UPDATE comments SET body='edited' WHERE id='safe'").run());
});

test('old shared references can be unregistered after the final reference check',t=>{
  const db=setup(t);question(db,'shared',{image:publicUrl});comment(db,'shared-comment',publicUrl);retire(db,oldKey);
  // Registration never alters these rows. Unchanged metadata remains editable.
  assert.doesNotThrow(()=>db.prepare("UPDATE questions SET title='metadata only',payload=payload WHERE id='shared'").run());
  assert.doesNotThrow(()=>db.prepare("UPDATE comments SET updated_at='fixture',body=body WHERE id='shared-comment'").run());
  assert.throws(()=>db.prepare("UPDATE comments SET body=? WHERE id='shared-comment'").run('Changed '+publicUrl),/question_image_retired/);
  db.prepare('DELETE FROM private_retired_question_images WHERE object_key=?').run(oldKey);
  assert.doesNotThrow(()=>question(db,'allowed-copy',{image:publicUrl}));
  assert.doesNotThrow(()=>db.prepare("UPDATE comments SET body=? WHERE id='shared-comment'").run('Changed '+publicUrl));
});

test('candidates, avatars, and custom image reactions cannot add retired references',t=>{
  const db=setup(t);candidate(db,'candidate',0);retire(db,oldKey,privateKey,'question-assets/owner/reactions/retired.webp');
  assert.throws(()=>candidate(db,'blocked-candidate',1,{image:publicUrl}),/question_image_retired/);
  assert.throws(()=>db.prepare("UPDATE generation_candidates SET candidate_payload=? WHERE id='candidate'").run(JSON.stringify({image:privateUrl})),/question_image_retired/);
  assert.throws(()=>db.prepare("INSERT INTO profiles(id,avatar_url) VALUES('blocked-user',?)").run(publicUrl),/question_image_retired/);
  assert.throws(()=>db.prepare("UPDATE profiles SET avatar_url=? WHERE id='owner'").run(privateUrl),/question_image_retired/);
  const insertReaction=db.prepare("INSERT INTO custom_reactions(reaction_key,label,icon,creator_user_id,image_path,icon_type) VALUES(?,'Fixture','','owner',?,'image')");
  assert.throws(()=>insertReaction.run('custom_'+'1'.repeat(32),'owner/reactions/retired.webp'),/question_image_retired/);
  insertReaction.run('custom_'+'2'.repeat(32),'owner/reactions/allowed.webp');
  assert.throws(()=>db.prepare('UPDATE custom_reactions SET image_path=?').run('owner/reactions/retired.webp'),/question_image_retired/);
  assert.doesNotThrow(()=>db.prepare("UPDATE profiles SET display_name='Renamed' WHERE id='owner'").run());
});

test('new media links are blocked while old links and byte-ledger transitions are preserved',t=>{
  const db=setup(t);media(db,oldKey);question(db,'original');question(db,'copy');
  db.prepare("INSERT INTO media_question_links(object_key,question_id) VALUES(?,'original')").run(oldKey);
  retire(db,oldKey);
  assert.throws(()=>db.prepare("INSERT INTO media_question_links(object_key,question_id) VALUES(?,'copy')").run(oldKey),/question_image_retired/);
  assert.throws(()=>db.prepare("UPDATE media_question_links SET question_id='copy'").run(),/question_image_retired/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM media_question_links').get().n,1);
  assert.equal(db.prepare('SELECT used_bytes FROM private_media_budget').get().used_bytes,100);
  db.prepare("UPDATE media_assets SET state='deleting' WHERE object_key=?").run(oldKey);
  assert.equal(db.prepare('SELECT used_bytes FROM private_media_budget').get().used_bytes,100);
  db.prepare("UPDATE media_assets SET state='deleted' WHERE object_key=?").run(oldKey);
  assert.equal(db.prepare('SELECT used_bytes FROM private_media_budget').get().used_bytes,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM private_retired_question_images').get().n,1);
});

test('answer and immutable audit history remain intact and new audit snapshots are allowed',t=>{
  const db=setup(t);question(db,'q');
  const snapshot=JSON.stringify({image:publicUrl});
  db.prepare("INSERT INTO answer_attempts(id,client_attempt_id,user_id,question_id,answer,grade) VALUES('answer','attempt','owner','q',?,'◎')").run(snapshot);
  db.prepare("INSERT INTO question_audit_events(id,question_id,collection_id,actor_id,event_type,snapshot) VALUES(1,'q','book','owner','updated',?)").run(snapshot);
  const before=db.prepare('SELECT * FROM question_audit_events').all();
  const beforeAnswer=db.prepare('SELECT * FROM answer_attempts').all();
  retire(db,oldKey);
  db.prepare("INSERT INTO question_audit_events(id,question_id,collection_id,actor_id,event_type,snapshot) VALUES(2,'q','book','owner','updated',?)").run(snapshot);
  assert.deepEqual(db.prepare('SELECT * FROM question_audit_events WHERE id=1').all(),before);
  assert.deepEqual(db.prepare('SELECT * FROM answer_attempts').all(),beforeAnswer);
  assert.doesNotThrow(()=>db.prepare("INSERT INTO answer_attempts(id,client_attempt_id,user_id,question_id,answer,grade) VALUES('new-answer','new-attempt','owner','q',?,'◎')").run(snapshot));
  assert.equal(db.prepare('SELECT snapshot FROM question_audit_events WHERE id=2').get().snapshot,snapshot);
  // Stale soft-deleted question copies are still guarded because they can later
  // be restored; the migration itself never changes or deletes such questions.
  assert.throws(()=>db.prepare("INSERT INTO questions(id,collection_id,created_by,payload,deleted_at) VALUES('trashed','book','owner',?,'fixture')").run(snapshot),/question_image_retired/);
});

test('path punctuation is literal and references inside Markdown are detected',t=>{
  const db=setup(t),key='naga-question-assets/book/scene[1]*.webp';retire(db,key);
  assert.throws(()=>question(db,'literal',{image:'https://fixture.test/v1/public/'+key}),/question_image_retired/);
  assert.throws(()=>comment(db,'markdown','[source](https://fixture.test/v1/public/'+key+')'),/question_image_retired/);
  assert.doesNotThrow(()=>question(db,'different',{image:'https://fixture.test/v1/public/naga-question-assets/book/scene1-a.webp'}));
});

test('the real book-import RPC cannot race a registered retirement',async t=>{
  const db=setupD1(t),d=db.sqlite,ctx={db,actor:{id:'owner'},origin:'https://fixture.test'};
  d.exec("INSERT INTO collections(id,owner_id,title,share_slug) VALUES('target','owner','Target fixture','target');");
  question(d,'source',{kind:'standard',image:publicUrl});
  const before=d.prepare("SELECT * FROM questions WHERE id='source'").get();
  retire(d,oldKey);
  const args={p_source_question_id:'source',p_target_share_slug:'target'};
  await assert.rejects(builderRpc('import_shared_question',args,ctx),/question_image_retired/);
  assert.equal(d.prepare("SELECT count(*) AS n FROM questions WHERE collection_id='target'").get().n,0);
  assert.deepEqual(d.prepare("SELECT * FROM questions WHERE id='source'").get(),before);
  d.prepare('DELETE FROM private_retired_question_images WHERE object_key=?').run(oldKey);
  const result=await builderRpc('import_shared_question',args,ctx);
  assert.equal(JSON.parse(d.prepare('SELECT payload FROM questions WHERE id=?').get(result.question_id).payload).image,publicUrl);
});

test('a non-reference prefix occurrence cannot hide a later genuine image reference',t=>{
  const db=setup(t);retire(db,oldKey);
  const falsePrefix=publicUrl.replace('/book/','/other-book/');
  assert.doesNotThrow(()=>comment(db,'prefix-only',falsePrefix+' '+publicUrl+'-copy'));
  assert.throws(()=>comment(db,'later-reference',falsePrefix+' '+publicUrl+'-copy '+publicUrl),/question_image_retired/);
  assert.throws(()=>question(db,'nested-reference',{comments:[{body:falsePrefix+' then ['+publicUrl+']'}]}),/question_image_retired/);
});

test('realistic long keys work with the actual SQLite LIKE/GLOB pattern limit set to 50 bytes',t=>{
  // node:sqlite has no sqlite3_limit binding. Python 3.11+ exposes the actual
  // engine limit, so this also reproduces the failure the old GLOB guard caused.
  // GitHub's Ubuntu runner provides python3. Other hosts may name an interpreter
  // explicitly; absence is reported as a skip, never mistaken for verification.
  const python=String.raw`
import json, pathlib, sqlite3, sys
if not hasattr(sqlite3.Connection, "setlimit"):
    sys.exit(77)
d = sqlite3.connect(":memory:")
d.setlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 50)
assert d.getlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH) == 50
for operator in ("GLOB", "LIKE"):
    try:
        d.execute("SELECT ? " + operator + " ?", ("fixture", "x" * 80)).fetchone()
        raise AssertionError("engine pattern limit was not active")
    except sqlite3.OperationalError as e:
        assert "pattern too complex" in str(e)
for name in sys.argv[1:]:
    d.executescript(pathlib.Path(name).read_text(encoding="utf-8"))
d.execute("INSERT INTO profiles(id) VALUES('owner')")
d.execute("INSERT INTO collections(id,owner_id,title,share_slug) VALUES('book','owner','Fixture','fixture')")
key = "naga-question-assets/88c9cb70-6958-42b6-a433-5518388bc158/" + "a" * 96 + "/question.webp"
private_key = "question-assets/6f8426e1-f0ae-40bd-93da-40a9f981edba/" + "b" * 96 + ".png"
for k in (key, private_key):
    d.execute("INSERT INTO private_retired_question_images(object_key) VALUES(?)", (k,))
src = "https://fixture.test/v1/public/" + key
private_path = private_key.split("/", 1)[1]
def blocked(sql, params):
    try:
        d.execute(sql, params)
        raise AssertionError("retired reference was accepted")
    except sqlite3.IntegrityError as e:
        assert "question_image_retired" in str(e), str(e)
insert_q = "INSERT INTO questions(id,collection_id,created_by,payload) VALUES(?,'book','owner',?)"
# Long keys in the allowlist must not prevent unrelated questions from saving.
board = {"boardScene": {"tiles": [{"tile": "5m", "face": "back"}] * 500}, "image": None}
d.execute(insert_q, ("clean", json.dumps(board)))
d.execute(insert_q, ("other", json.dumps({"image": src + "-copy"})))
blocked(insert_q, ("blocked", json.dumps({"image": src})))
blocked("UPDATE questions SET payload=? WHERE id='clean'", (json.dumps({"image": src}),))
insert_c = "INSERT INTO comments(id,collection_id,user_id,body,attachments) VALUES(?,'book','owner',?,?)"
blocked(insert_c, ("comment", "See " + src, "[]"))
blocked(insert_c, ("attachment", "", json.dumps([{"path": private_path}])))
blocked(insert_c, ("later", src + "-copy then [" + src + "]", "[]"))
blocked("UPDATE profiles SET avatar_url=? WHERE id='owner'", (src,))
assert json.loads(d.execute("SELECT payload FROM questions WHERE id='clean'").fetchone()[0]) == board
assert d.execute("SELECT count(*) FROM questions").fetchone()[0] == 2
print(json.dumps({"limit": 50, "keyBytes": len(key.encode()), "longGlobRejected": True, "longReferencesBlocked": True}))
`;
  const checked=runPythonSqlite(t,python);if(!checked)return;
  assert.equal(checked.limit,50);assert.ok(checked.keyBytes>150);
  assert.equal(checked.longGlobRejected,true);assert.equal(checked.longReferencesBlocked,true);
});

test('spaces and boundary punctuation inside a path retain literal matching',t=>{
  const db=setup(t),key='naga-question-assets/owner name/book/scene [1]*, final.webp';
  const url='https://fixture.test/v1/public/'+key;
  retire(db,key);
  assert.throws(()=>question(db,'spaces',{image:url}),/question_image_retired/);
  assert.throws(()=>comment(db,'spaces-in-prose','prefix ['+url+'] suffix'),/question_image_retired/);
  assert.throws(()=>comment(db,'later-space-reference',url+'-copy then '+url),/question_image_retired/);
  assert.doesNotThrow(()=>comment(db,'space-copy',url+'-copy'));
  assert.doesNotThrow(()=>question(db,'other-space',{image:url.replace('final','another')}));
});

test('the full 1024-character path is guarded without truncating a valid reference',t=>{
  const db=setup(t),path='book/'+('x'.repeat(1015))+'.png';
  assert.equal(path.length,1024);
  const key='naga-question-assets/'+path;retire(db,key);
  assert.throws(()=>question(db,'max-path',{image:'https://fixture.test/v1/public/'+key}),/question_image_retired/);
  assert.throws(()=>comment(db,'max-path-in-prose','See '+path+'!'),/question_image_retired/);
  assert.doesNotThrow(()=>question(db,'longer-copy',{image:key+'-copy'}));
  assert.throws(()=>retire(db,key+'x'),/CHECK constraint failed/);
});

test('actual guard VM work stays bounded with 208 versus 5000 same-book retired keys',t=>{
  // Count SQLite VM instructions for actual guarded writes, including the
  // triggers. This detects a scan of the retirement group even if wall-clock
  // timings happen to look fast. It does not claim to measure D1 billing rows.
  const python=String.raw`
import json, pathlib, sqlite3, sys
d = sqlite3.connect(":memory:")
for name in sys.argv[1:]:
    d.executescript(pathlib.Path(name).read_text(encoding="utf-8"))
d.execute("INSERT INTO profiles(id) VALUES('owner')")
d.execute("INSERT INTO collections(id,owner_id,title,share_slug) VALUES('book','owner','Fixture','fixture')")
d.execute("INSERT INTO private_media_budget(singleton,inventory_checked_at) VALUES(1,'fixture')")
d.execute("INSERT INTO private_retired_question_images(object_key) VALUES('naga-question-assets/book/report/question.webp')")
insert_q = "INSERT INTO questions(id,collection_id,created_by,payload) VALUES('bench','book','owner',?)"
insert_c = "INSERT INTO comments(id,collection_id,user_id,body,attachments) VALUES('bench','book','owner',?,'[]')"
url = "https://fixture.test/v1/public/naga-question-assets/book/report/question.webp"
clean_payload = json.dumps({"image": url + "-copy", "images": {"off": url + "-other", "open": url + "-third"},
    "boardScene": {"tiles": [{"tile": "5m", "face": "back"}] * 100}})
cases = {
    "questionSameBook": (insert_q, (clean_payload,), False),
    "commentSameBook": (insert_c, ("ordinary words " * 30 + url + "-copy then [" + url + "-copy] end",), False),
    "commentOtherBook": (insert_c, ("See " + url.replace("/book/", "/another-book/") + " and another/book/image.webp",), False),
    "lateRetiredQuestion": (insert_q, (json.dumps({"image": url + "-copy", "body": url + "-copy then [" + url + "]"}),), True),
}
def measure(sql, params, should_block):
    d.execute("SAVEPOINT cost")
    steps = [0]
    def progress():
        steps[0] += 1
        return 0
    d.set_progress_handler(progress, 1)
    blocked = False
    try:
        d.execute(sql, params)
    except sqlite3.IntegrityError as e:
        assert "question_image_retired" in str(e), str(e)
        blocked = True
    finally:
        d.set_progress_handler(None, 0)
        d.execute("ROLLBACK TO cost")
        d.execute("RELEASE cost")
    assert blocked == should_block
    return steps[0]
costs = {}
previous = 1
for size in (208, 5000):
    # Deliberately one owner/book: an owner-prefix-only scan must fail this test.
    d.executemany("INSERT INTO private_retired_question_images(object_key) VALUES(?)",
        (("naga-question-assets/book/report/retired-%05d.webp" % i,) for i in range(previous, size)))
    previous = size
    assert d.execute("SELECT count(*) FROM private_retired_question_images").fetchone()[0] == size
    costs[str(size)] = {name: measure(*args) for name, args in cases.items()}
for name in cases:
    small, large = costs["208"][name], costs["5000"][name]
    assert large <= small * 1.10 + 100, (name, small, large)
# Inspect the real trigger SELECT, rather than an unrelated example lookup.
migration = pathlib.Path(sys.argv[-1]).read_text(encoding="utf-8")
start = migration.index("WITH RECURSIVE")
guard = migration[start:migration.index("\n  );", start)].replace("NEW.payload", "?")
guard = guard.replace("RAISE(ABORT,'question_image_reference_too_complex')", "NULL")
plan = [r[3] for r in d.execute("EXPLAIN QUERY PLAN " + guard, (clean_payload,))]
retired_plan = [line for line in plan if "private_retired_question_image" in line]
assert retired_plan and all("SEARCH" in line for line in retired_plan), retired_plan
assert any("owner_idx" in line and "owner_prefix=?" in line for line in retired_plan), retired_plan
assert any("owner_idx" in line and "owner_prefix>?" in line for line in retired_plan), retired_plan
assert any("sqlite_autoindex_private_retired_question_images" in line and "object_key=?" in line for line in retired_plan), retired_plan
# Keep SQLite allocations bounded while checking slash-heavy embedded images.
# The text also contains a normal URL and ends in a dot, so excluding simple
# base64-looking strings cannot accidentally make this test pass.
d.execute("PRAGMA hard_heap_limit=33554432")
large_input_vm = {}
for repeats in (1000, 4000):
    body = "Source " + url + "-copy then data:image/png;base64," + ("a" * 60 + "/") * repeats + "."
    large_input_vm[str(repeats)] = {
        "clean": measure(insert_q, (json.dumps({"image": body}),), False),
        "lateReference": measure(insert_q, (json.dumps({"image": body + " [" + url + "]"}),), True),
    }
for case in ("clean", "lateReference"):
    assert large_input_vm["4000"][case] <= large_input_vm["1000"][case] * 5 + 10000, large_input_vm
# Exercise distinct-prefix discovery with three actual prefixes, while the
# 5000-key same-prefix group remains in the table. Unrelated strings must be
# discarded before windows/slashes even when another JSON atom has a prefix.
d.executemany("INSERT INTO private_retired_question_images(object_key) VALUES(?)", [
    ("question-assets/second-owner/book/question.png",),
    ("naga-question-assets/third-book/report/question.webp",),
])
prefilter_vm = {}
for repeats in (1000, 4000):
    data_uri = "data:image/png;base64," + ("a" * 60 + "/") * repeats + "."
    unrelated_url = "https://unrelated.example/assets/portrait.png"
    prefilter_vm[str(repeats)] = {
        "dataOnly": measure(insert_q, (json.dumps({"image": data_uri}),), False),
        "unrelatedUrlAndData": measure(insert_q, (json.dumps({"image": unrelated_url + " " + data_uri}),), False),
        "separateKnownPrefix": measure(insert_q, (json.dumps({"image": data_uri, "notes": url + "-copy"}),), False),
    }
for case in prefilter_vm["1000"]:
    small, large = prefilter_vm["1000"][case], prefilter_vm["4000"][case]
    assert large <= small * 1.10 + 100, (case, small, large)
    assert large < 20000, (case, large)
print(json.dumps({"vmSteps": costs, "retiredPlan": retired_plan, "largeInputVm": large_input_vm, "prefilterVm": prefilter_vm, "sqliteHeapLimitBytes": 33554432}))
`;
  const checked=runPythonSqlite(t,python);if(!checked)return;
  t.diagnostic(JSON.stringify(checked));
});


test('indexed candidate extraction agrees with literal matching at every boundary',t=>{
  const db=setup(t),keys=[oldKey,
    'question-assets/owner name/book/scene [1]*, final.webp',
    'naga-question-assets/本 の名前/場面(1).png'];
  retire(db,...keys);
  const select=db.prepare(guardSelectForReadOnly());
  const prefixes=['','/',' ','"', "'",'(','[','=','{','\t','\n','\r','x','-','@',':'];
  const suffixes=['',']',' ','?','#','"', "'",')',',',';','!','>','}','\t','\n','\r','/','-','_','x'];
  const allowedPrefix='/ "\'([={\t\n\r',allowedSuffix='] ?#"\' ),;!>}\t\n\r';
  // Reference definition: literal occurrence with the original adjacent-character
  // rules. It does not use slash walking, prefix indexes, or candidate extraction.
  function literalReference(text){
    text=text.replace(/%2f/gi,'/');
    return keys.some(key=>{
      const path=key.slice(key.indexOf('/')+1);
      for(let at=text.indexOf(path);at>=0;at=text.indexOf(path,at+1)){
        const end=at+path.length;
        if((at===0||allowedPrefix.includes(text[at-1]))&&
          (end===text.length||allowedSuffix.includes(text[end])))return true;
      }
      return false;
    });
  }
  for(const key of keys){
    const path=key.slice(key.indexOf('/')+1);
    for(const prefix of prefixes)for(const suffix of suffixes){
      const text=prefix+path+suffix;
      assert.equal(Boolean(select.get(JSON.stringify({image:text}))),literalReference(text),JSON.stringify(text));
    }
    const text='x'+path+'-copy then ['+path.replaceAll('/','%2f')+']';
    assert.equal(Boolean(select.get(JSON.stringify({body:text}))),literalReference(text));
  }
});


test('overlapping input windows preserve start and end context for crossing paths',t=>{
  const db=setup(t),paths=['book/report/question.webp','book/'+('x'.repeat(1015))+'.png'];
  retire(db,...paths.map(path=>'naga-question-assets/'+path));
  const select=db.prepare(guardSelectForReadOnly());
  for(const path of paths)for(const at of [1,2,1023,1024,1025,1026,2048,2049,3072]){
    const prefix=at===1?'':'x'.repeat(at-2)+' ';
    const label='start='+at+', length='+path.length;
    assert.ok(select.get(JSON.stringify({body:prefix+path+']'})),label);
    assert.equal(select.get(JSON.stringify({body:prefix+path+'-copy'})),undefined,label+' suffix');
    if(at>1)assert.equal(select.get(JSON.stringify({body:'x'.repeat(at-1)+path+']'})),undefined,label+' prefix');
  }
});


test('excessive slash input fails closed before changing any question',t=>{
  const db=setup(t);retire(db,oldKey);
  const clean={boardScene:{schema:1},image:null};question(db,'kept',clean);
  // Each value is individually below the limit; their combined expansion is not.
  const oversized={image:'data:image/png;base64,'+'/'.repeat(32768),
    notes:'/'.repeat(32769)};
  assert.throws(()=>question(db,'too-complex',oversized),/question_image_reference_too_complex/);
  assert.throws(()=>db.prepare("UPDATE questions SET payload=? WHERE id='kept'")
    .run(JSON.stringify(oversized)),/question_image_reference_too_complex/);
  assert.deepEqual(JSON.parse(db.prepare("SELECT payload FROM questions WHERE id='kept'").get().payload),clean);
  assert.equal(db.prepare('SELECT count(*) AS n FROM questions').get().n,1);
});
