import test from 'node:test';
import assert from 'node:assert/strict';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {readRpc} from '../cloudflare/read-api.mjs';

function fixture() {
  const db=testD1(),actor={id:'owner',is_admin:false};
  db.sqlite.exec(`INSERT INTO profiles(id,display_name) VALUES('owner','Owner'),('other','Other');
    INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES
    ('book','owner','Book','book','public','2026-10-18'),('private','owner','Private','private','private',NULL);`);
  const insert=db.sqlite.prepare('INSERT INTO questions(id,collection_id,created_by,title,sort_order,payload) VALUES(?,?,?,?,?,?)');
  for(let i=1;i<=101;i++)insert.run('q'+i,'book','owner','問題'+i,i,JSON.stringify({number:i,comments:i===101?[{messageId:'embedded',content:'keep'},'plain comment',null,42]:[]}));
  insert.run('private-q','private','owner','問題1',1,'{"number":1}');
  db.sqlite.exec(`INSERT INTO comments(id,collection_id,question_id,user_id,body,deleted_at) VALUES
    ('visible','book','q1','owner','keep',NULL),('deleted','book','q1','owner','secret','2026-10-18');
    INSERT INTO question_reactions(question_id,user_id,reaction_key) VALUES
    ('q1','owner','like'),('q1','other','like'),('q101','other','important'),('private-q','owner','mistake');
    INSERT INTO comment_reactions(question_id,comment_id,user_id,reaction_key) VALUES
    ('q1','visible','other','difficult'),('q1','deleted','other','mistake'),('q1','missing','other','hmm'),
    ('q101','embedded','other','custom_11111111111111111111111111111111');`);
  return {db,actor};
}

test('reaction search metadata spans pages and includes visible question/comment/custom reactions without participants',async()=>{
  const ctx=fixture(),before=ctx.db.sqlite.prepare('SELECT payload FROM questions WHERE id=?').get('q1').payload;
  const first=await readRpc('get_shared_question_index_page',{p_share_slug:'book',p_limit:100,p_offset:0},ctx);
  const last=await readRpc('get_shared_question_index_page',{p_share_slug:'book',p_limit:100,p_offset:100},ctx);
  assert.equal(first.length,100);assert.equal(last.length,1);
  assert.deepEqual(first[0].reaction_keys.sort(),['difficult','like']);
  assert.deepEqual(last[0].reaction_keys.sort(),['custom_11111111111111111111111111111111','important']);
  assert.deepEqual(first[1].reaction_keys,[]);
  assert.ok(!('payload' in first[0]));assert.ok(!('reactors' in first[0]));
  const detail=await readRpc('get_shared_question_detail',{p_share_slug:'book',p_question_id:'q1'},ctx);
  assert.deepEqual(detail[0].reaction_keys.sort(),['difficult','like']);
  assert.equal(ctx.db.sqlite.prepare('SELECT payload FROM questions WHERE id=?').get('q1').payload,before);
});

test('search metadata respects book access and reaction removal, including deleted comments',async()=>{
  const ctx=fixture();
  assert.deepEqual(await readRpc('get_shared_question_index_page',{p_share_slug:'private'},{db:ctx.db,actor:{id:'other'}}),[]);
  ctx.db.sqlite.exec("DELETE FROM question_reactions WHERE question_id='q1'; UPDATE comments SET deleted_at='2026-10-18' WHERE id='visible';");
  const result=await readRpc('get_shared_question_index_page',{p_share_slug:'book'},ctx);
  assert.deepEqual(result[0].reaction_keys,[]);
});
