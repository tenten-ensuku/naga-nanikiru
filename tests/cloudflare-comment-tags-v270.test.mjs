import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TAGS, extractTags, tagsFromComments, appendTag } from '../public/comment-tags-v270.mjs';
import { testD1 } from './helpers/cloudflare-d1.mjs';
import { readRpc } from '../cloudflare/read-api.mjs';
import { writeRpc } from '../cloudflare/student-write-api.mjs';

test('five canonical hashtags accept fullwidth hashes and reject URL fragments and longer words', () => {
  assert.deepEqual(extractTags(TAGS.map(tag => '＃' + tag).join('\n')), TAGS);
  assert.deepEqual(extractTags('復習：#押し引き、#安全度比較\n#押し引き'), ['押し引き','安全度比較']);
  assert.deepEqual(extractTags('https://example.com/#基本序列 #押し引き応用 #セオリー集2 #自由'), []);
  assert.equal(appendTag('解説を残す', '押し引き'), '解説を残す\n#押し引き');
  assert.equal(appendTag('＃押し引き', '押し引き'), '＃押し引き');
  assert.equal(appendTag('a'.repeat(1999), '押し引き'), null);
  assert.deepEqual(tagsFromComments([{content:'#押し引き',showInComments:false},{body:'#安全度比較',deleted_at:'now'},'#基本序列']), ['基本序列']);
});

function fixture() {
  const db = testD1(), actor = {id:'tag-author',is_admin:false};
  db.sqlite.exec(`INSERT INTO profiles(id,display_name) VALUES ('tag-author','投稿者'),('tag-other','他人');
    INSERT INTO collections(id,owner_id,title,visibility,share_slug,published_at) VALUES
    ('tag-book','tag-author','タグ検証','public','tag-book','2026-09-17'),
    ('tag-private','tag-author','非公開','private','tag-private',NULL);`);
  const insert = db.sqlite.prepare('INSERT INTO questions(id,collection_id,created_by,title,sort_order,payload) VALUES(?,?,?,?,?,?)');
  for(let number=1;number<=101;number++) insert.run('q'+number,'tag-book',actor.id,'問題'+number,number,JSON.stringify({number,comments:number===1?[{id:'original',content:'元の解説 ＃セオリー集',attachments:[{src:'original.png'}]}]:[]}));
  insert.run('private-q','tag-private',actor.id,'問題1',1,JSON.stringify({number:1,comments:[{content:'#安全度比較'}]}));
  return {db,actor};
}
const read = (ctx,offset=0,slug='tag-book') => readRpc('get_shared_question_index_page',{p_share_slug:slug,p_limit:100,p_offset:offset},ctx);
const post = (ctx,question,body) => writeRpc('post_shared_comment',{p_share_slug:'tag-book',p_question_id:question,p_body:body,p_attachments:[]},ctx);

test('saved, edited and deleted tags follow comments, with question data and attachments preserved', async () => {
  const ctx=fixture(), {db}=ctx;
  try {
    const original=db.sqlite.prepare('SELECT payload FROM questions WHERE id=?').get('q1').payload;
    const first=await post(ctx,'q1','学びのメモ\n#基本序列 #押し引き');
    const second=await post(ctx,'q1','＃押し引き');
    assert.deepEqual((await read(ctx))[0].comment_tags,['基本序列','セオリー集','押し引き']);
    await assert.rejects(writeRpc('update_shared_comment',{p_comment_id:first,p_body:'#安全度比較',p_attachments:[]},{db,actor:{id:'tag-other'}}),e=>e.status===403);
    await writeRpc('update_shared_comment',{p_comment_id:first,p_body:'元のメモを編集\n#安全度比較',p_attachments:[]},ctx);
    assert.deepEqual((await read(ctx))[0].comment_tags,['セオリー集','押し引き','安全度比較']);
    await writeRpc('delete_shared_comment',{p_comment_id:first},ctx);
    assert.deepEqual((await read(ctx))[0].comment_tags,['セオリー集','押し引き']);
    await writeRpc('delete_shared_comment',{p_comment_id:second},ctx);
    assert.deepEqual((await read(ctx))[0].comment_tags,['セオリー集']);
    assert.equal(db.sqlite.prepare('SELECT payload FROM questions WHERE id=?').get('q1').payload,original);
    const serial=JSON.stringify(await read(ctx));
    for (const text of ['元の解説','original.png','comment_tag_bodies','embedded_tag_comments']) assert.equal(serial.includes(text),false);
  } finally { db.close(); }
});

test('tags on later pages remain searchable, private books do not leak and lookups use the comment index', async () => {
  const ctx=fixture(), {db}=ctx;
  try {
    await post(ctx,'q101','#一向聴基礎講義');
    assert.equal((await read(ctx)).length,100);
    assert.deepEqual((await read(ctx,100))[0].comment_tags,['一向聴基礎講義']);
    assert.deepEqual(await read({db,actor:{id:'tag-other'}},0,'tag-private'),[]);
    const publicTags=(await read(ctx)).flatMap(row=>row.comment_tags);
    assert.equal(publicTags.includes('安全度比較'),false);
    const plan=db.sqlite.prepare(`EXPLAIN QUERY PLAN SELECT body FROM comments INDEXED BY comments_question_time WHERE question_id=? AND collection_id=? AND deleted_at IS NULL`).all('q1','tag-book');
    assert.ok(plan.some(row=>row.detail.includes('comments_question_time')));
    assert.ok(!plan.some(row=>/SCAN comments/.test(row.detail)));
  } finally { db.close(); }
});

test('inline app parses and tag selection, paging and return-navigation are connected', () => {
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  for(const [,source] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if(source.trim()) new vm.Script(source);
  assert.match(html,/commentTag: menuCommentTagV270/);
  assert.match(html,/filters\.commentTag\) \? filters\.commentTag : ""/);
  assert.match(html,/allowedKeys\.has\(questionKeyV16\(question\)\) && matchesCommentTagV270/);
  assert.match(html,/menuViewV16 === "my" && menuRangeV60 === "all"/);
  assert.match(html,/commentTagFiltersV270[\s\S]*menuCommentTagV270 = tag;[\s\S]*showMenuV16\("my"/);
});
