import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {generator} from '../scripts/naga-generator-runtime.mjs';
import {prepareKanRepair, KAN_REPAIR_FIELDS, KAN_REPAIR_CAS_SQL} from '../scripts/repair-kan-recommendations-v279.mjs';
const msg=(type,fields={})=>({info:{msg:{type,...fields}}});
function fixture(kind='kakan') {
  const hand=kind==='kakan'?['1m','2m','3m','4m','5m','6m','7m','8m','9m','5p','5p','P','P']:['W','W','W','W','1m','2m','3m','4m','5m','6m','7m','8m','9m'];
  const entries=[msg('start_kyoku',{tehais:[hand],dora_marker:'3m'})];
  let tv;
  if(kind==='kakan') {
    entries.push(msg('dahai',{actor:1,pai:'5p'}),msg('pon',{actor:0,target:1,pai:'5p',consumed:['5p','5p']}),msg('dahai',{actor:0,pai:'P'}));
    tv=entries.length;
    entries.push({...msg('tsumo',{actor:0,pai:'5pr',real_dahai:'?'}),kan:[{0:1500,2:8500},{0:9973,2:26}]},msg('kakan',{actor:0,pai:'5pr',consumed:['5p','5p','5p']}));
  } else if(kind==='ankan') {
    tv=1;entries.push({...msg('tsumo',{actor:0,pai:'4s',real_dahai:'?'}),kan:[{0:88,1:9911},{0:2735,1:7264}]},msg('ankan',{actor:0,pai:'W',consumed:['W','W','W','W']}));
  } else {
    entries[0].info.msg.tehais[0]=['W','W','W','1p','1m','2m','3m','4m','5m','6m','7m','8m','9m'];
    tv=1;entries.push({...msg('dahai',{actor:1,pai:'W'}),huro:{0:[{0:4000,4:500,5:5500},{0:8000,4:500,5:1500}]}},msg('tsumo',{actor:2,pai:'1s'}));
  }
  const report={reportId:'repair-fixture',naga_types:{0:'ニシキ',1:'カガシ'},pred:[entries]};
  const spec={reportId:report.reportId,tw:0,ts:0,tv};
  const candidate=structuredClone(generator.sceneCandidate(report,spec));
  const payload={...candidate,number:17,title:'保存済み問題',comments:[{content:'元の解説'}],image:'preserve-original',boardScene:{keep:'unchanged'}};
  payload.models[0].note='preserve-model-note';
  return {report,row:{id:'question-original',collection_id:'book-original',source_report_id:spec.reportId,source_url:candidate.nagaUrl,scene_tw:0,scene_ts:0,scene_tv:tv,decision_type:'call',updated_at:'before',deleted_at:null,payload:JSON.stringify(payload)}};
}
test('existing kakan restores code 2 rates and model choices while preserving all unrelated fields',()=>{
  const {report,row}=fixture(),p=JSON.parse(row.payload);
  p.callActionProbabilities.kan=[];p.callProbabilities.call=[];p.callActionOptions=p.callActionOptions.filter(x=>x.action!=='kan');p.callOptions=p.callOptions.filter(x=>x.code!==7);
  p.callRecommended=[false,false];p.callRecommendedActions=['pass','pass'];p.actualCallProbability=[0,0];p.actualCallProbabilityRaw=[0,0];p.models=p.models.map(m=>({...m,recommendation:null,callAction:'pass',label:'スルー',recommendationCode:0}));
  row.payload=JSON.stringify(p);const original=structuredClone(row);
  const repaired=prepareKanRepair(row,report),after=JSON.parse(repaired.payload);
  assert.equal(repaired.status,'repair');assert.deepEqual(after.callActionProbabilities.kan,[85,.26]);assert.deepEqual(after.callRecommendedActions,['kan','pass']);
  assert.equal(after.models[0].recommendationCode,7);assert.equal(after.models[0].note,'preserve-model-note');
  for(const key of Object.keys(p))if(!KAN_REPAIR_FIELDS.includes(key))assert.deepEqual(after[key],p[key],key);
  assert.deepEqual(row,original);assert.equal(prepareKanRepair({...row,payload:repaired.payload},report).status,'correct');
});
test('ankan restores raw pass rates without changing its already correct kan rates',()=>{
  const {row,report}=fixture('ankan'),p=JSON.parse(row.payload);p.callOptions.find(x=>x.code===0).values=[0,0];row.payload=JSON.stringify(p);
  const after=JSON.parse(prepareKanRepair(row,report).payload);
  assert.deepEqual(after.callOptions.find(x=>x.code===0).values,[.88,27.35]);assert.deepEqual(after.callActionProbabilities.kan,p.callActionProbabilities.kan);
});
test('daiminkan remains separate from pon, including the historical pass',()=>{
  const {row,report}=fixture('daiminkan'),p=JSON.parse(row.payload);delete p.callActionOptions;delete p.callActionProbabilities;delete p.callRecommendedActions;delete p.actualCallAction;p.callProbabilities.call=[60,20];row.payload=JSON.stringify(p);
  const after=JSON.parse(prepareKanRepair(row,report).payload);
  assert.deepEqual(after.callActionProbabilities,{pass:[40,80],call:[5,5],kan:[55,15]});assert.deepEqual(after.callRecommendedActions,['kan','pass']);
  assert.equal(after.actualCall,false);assert.equal(after.actualCallAction,undefined);
});
test('saved discard at a kan scene is never converted',()=>{
  const {row,report}=fixture();const p=JSON.parse(row.payload);p.decisionType='discard';row.decision_type='discard';row.payload=JSON.stringify(p);
  assert.equal(prepareKanRepair(row,report).status,'not-kan');
});
test('conflicting source, hand, model order and deleted rows are rejected',()=>{
  for(const mutate of [r=>r.scene_tv++,r=>{const p=JSON.parse(r.payload);p.handBeforeDraw[0]='ji1';r.payload=JSON.stringify(p);},r=>{const p=JSON.parse(r.payload);p.models.reverse();r.payload=JSON.stringify(p);},r=>r.deleted_at='deleted']) {
    const {row,report}=fixture();mutate(row);assert.throws(()=>prepareKanRepair(row,report));
  }
});
test('compare-and-swap refuses concurrent changes and deleted questions',()=>{
  const db=new DatabaseSync(':memory:');try{
    db.exec("CREATE TABLE questions(id TEXT PRIMARY KEY,payload TEXT,updated_at TEXT,deleted_at TEXT);INSERT INTO questions VALUES('a','before','t0',NULL),('b','edited','t0',NULL),('c','before','t1',NULL),('d','before','t0','deleted')");
    const query=db.prepare(KAN_REPAIR_CAS_SQL);
    for(const id of ['b','c','d'])assert.deepEqual(query.all('after','t2',id,'t0','before'),[]);
    assert.equal(query.all('after','t2','a','t0','before').length,1);assert.deepEqual(query.all('after','t2','a','t0','before'),[]);
  }finally{db.close();}
});
test('legacy Nima display fallback retains the original nonzero pass rates',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const source=html.match(/      function normalizeNimaKanQuestionV112\([^]*?\n      }/)?.[0];assert.ok(source);
  const context={isNimaCollectionV105:()=>true};vm.createContext(context);vm.runInContext(source,context);
  const p=context.normalizeNimaKanQuestionV112({nagaUrl:'cfa1b6c5a93e9abd18f73b6c2cc0df6c26c6354e06d60f69854e6b3140f264e8v2_2'},17,'nima');
  assert.deepEqual(Array.from(p.callOptions.find(x=>x.code===0).values),[.88,27.35]);
});
