import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareJsonQuestion,assertDistinctSources} from '../scripts/json-board-migration-v260.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/json-board-v248/55.json',import.meta.url)));
function original() {
 const p={...fixture.question,id:'legacy-id',number:55,title:'Protected title',comments:[{id:'comment-1',content:'Keep this',attachments:[{url:'https://example.com/shared.png'}]}],image:'https://example.com/old.png',images:{off:'https://example.com/old.png'},imageOpen:'https://example.com/open.png',_imageData:'data:image/png;base64,AA==',needsScreenshot:true};
 return {id:'server-id',collection_id:'book',payload:JSON.stringify(p),decision_type:p.decisionType||'discard',updated_at:'2026-09-15T00:00:00Z'};
}
test('migration keeps stable identity, scoring, comments and attachments while removing screenshots',()=>{
 const row=original(),p=JSON.parse(row.payload),result=prepareJsonQuestion(row,fixture.scene),after=JSON.parse(result.payload);
 assert.equal(result.id,row.id); assert.equal(after.id,p.id); assert.equal(after.number,55);
 for(const field of ['models','probabilities','reach','actualDiscard','actualReach','hasRiichiJudgment','comments']) assert.deepEqual(after[field],p[field]);
 for(const field of ['image','images','imageOff','imageOpen']) assert.equal(after[field],null);
 assert.equal('_imageData' in after,false); assert.equal(after.needsScreenshot,false);
 assert.deepEqual(JSON.parse(row.payload),p); assert.notEqual(result.beforeHash,result.afterHash);
});
test('board mismatch and accidental effective comment replacement fail before a write',()=>{
 const row=original(),badScene=structuredClone(fixture.scene);badScene.hand.tiles[0]='ji7';
 assert.throws(()=>prepareJsonQuestion(row,badScene),/mismatch/);
 assert.throws(()=>prepareJsonQuestion(row,fixture.scene,{...JSON.parse(row.payload),comments:[]}),/Protected effective field/);
});
test('normalization may not merge two question IDs',()=>{
 const row=prepareJsonQuestion(original(),fixture.scene);
 assert.throws(()=>assertDistinctSources([row,{...row,id:'second'}]),/Duplicate canonical/);
 assert.doesNotThrow(()=>assertDistinctSources([row,{...row,id:'second',tv:row.tv+1}]));
});
