import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {boardState,boardRenderer} from '../scripts/naga-board-runtime.mjs';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {builderRpc} from '../cloudflare/collection-builder-v235.mjs';
const fixture=async n=>JSON.parse(await readFile(new URL(`fixtures/json-board-v248/${n}.json`,import.meta.url)));
for(const number of [1603,47,50,16,55,38,97])test(`JSON board ${number}: source projection, rendering and serialization`,async()=>{
  const {report,question,scene}=await fixture(number),projected=boardState.project(report,question);
  assert.deepEqual(projected,scene);assert.equal(boardState.validate(scene,question).valid,true);
  assert.deepEqual(JSON.parse(JSON.stringify(projected)),scene);
  const svg=boardRenderer.markup(scene);assert.match(svg,/naga-json-board-svg/);assert.doesNotMatch(svg,/<script|data:image|reference-|https?:/);
  assert.equal((svg.match(/data-river-tile/g)||[]).length,scene.players.reduce((sum,p)=>sum+p.river.length,0));
  const positions=boardRenderer.handPositions(scene);
  assert.equal(positions.length,number===38||number===97?5:8);
  positions.forEach(p=>assert.equal(scene.hand.tiles.concat(scene.hand.draw)[p.index],p.tile));
  scene.players.slice(1).forEach(p=>{assert.ok(!('hand' in p));assert.ok(p.hiddenSlots.every(x=>typeof x==='boolean'));});
});
test('1603 has a four-tile kan, two dora indicators and no concealed white dragons',async()=>{
 const {scene}=await fixture(1603);assert.deepEqual(scene.doraIndicators,['man6','ji6']);assert.ok(!scene.hand.tiles.includes('ji5'));assert.equal(scene.players[0].melds[1].type,'daiminkan');
});
test('riichi keeps sideways discard, accepted score debit, and kyotaku',async()=>{
 const {scene}=await fixture(55);assert.equal(scene.players[2].reached,true);assert.equal(scene.players[2].score,25300);assert.equal(scene.round.kyotaku,1);assert.equal(scene.players[2].river.filter(x=>x.riichi).length,1);
});
test('malformed, mismatched and private hidden-hand extensions fail closed',async()=>{
 const {scene,question}=await fixture(38);
 for(const mutate of [s=>s.hand.tiles[0]='javascript:alert(1)',s=>s.source.tv++,s=>s.players[1].hand=['ji1'],s=>s.players[0].melds[0].from=0,s=>s.players[1].hiddenSlots=['ji1'],s=>s.hand.tiles.reverse(),s=>s.doraIndicators=[],s=>s.round.remaining=71,s=>s.players[0].score=NaN]){const copy=structuredClone(scene);mutate(copy);assert.equal(boardState.validate(copy,question).valid,false);}
 const copy=structuredClone(scene);copy.players[0].name='<img src=x onerror=alert(1)>';assert.doesNotMatch(boardRenderer.markup(copy),/<img src=x/);assert.match(boardRenderer.markup(copy),/&lt;img/);
});
test('server saves JSON-only question, reloads exactly and deduplicates without images',async t=>{
 const db=testD1();t.after(()=>db.close());db.sqlite.exec("INSERT INTO profiles(id,display_name) VALUES('owner','試験所有者'),('viewer','試験閲覧者'); INSERT INTO collections(id,owner_id,title,share_slug) VALUES('c','owner','試験問題集','test-json-board');");
 const {question,scene}=await fixture(1603),payload={...question,boardScene:scene,image:null,needsScreenshot:false};
 const args={p_share_slug:'test-json-board',p_title:'生成候補',p_payload:payload,p_source_kind:'naga_scene',p_decision_type:question.decisionType,p_source_report_id:question.sourceReportId,p_scene_tw:question.tw,p_scene_ts:question.ts,p_scene_tv:question.tv},ctx={db,actor:{id:'owner'}};
 const saved=await builderRpc('create_shared_question',args,ctx);
 const stored=JSON.parse(db.sqlite.prepare('SELECT payload FROM questions WHERE id=?').get(saved.question_id).payload);
 assert.deepEqual(stored.boardScene,scene);assert.equal(stored.image,null);assert.equal(boardState.validate(stored.boardScene,stored).valid,true);assert.match(boardRenderer.markup(stored.boardScene),/<svg/);
 assert.equal((await builderRpc('create_shared_question',args,ctx)).already_exists,true);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM media_assets').get().n,0);
 await assert.rejects(builderRpc('create_shared_question',args,{db,actor:{id:'viewer'}}));
 const broken=structuredClone(args);broken.p_payload.boardScene.hand.draw='ji1';await assert.rejects(builderRpc('create_shared_question',broken,ctx),e=>e.code==='question_board_invalid');
});
test('browser code is syntactically valid and generation does not call capture/upload',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
 const start=html.indexOf('async function captureGeneratorCandidateV51('),end=html.indexOf('function setGeneratorStatusV44(',start),flow=html.slice(start,end);
 assert.doesNotMatch(flow,/captureNagaScene|compressImageFile|upload|fetch\(/);assert.match(flow,/prepareJsonBoardV248/);
 assert.match(html,/needsScreenshot: false/);assert.match(html,/if \(!SCENE.boardScene\) setHandMaskV17/);
 assert.match(html,/question\.id = String\(question\.serverQuestionId\)/);
 assert.match(html,/question\.__sharedDetailLoaded = true/);
 assert.match(html,/question\?\.image \|\| hasJsonBoardV248\(question\)/);
});
