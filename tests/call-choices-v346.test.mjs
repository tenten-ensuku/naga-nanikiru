import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {boardRenderer} from '../scripts/naga-board-runtime.mjs';
import '../public/call-choices-v346.js';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {readRpc} from '../cloudflare/read-api.mjs';
import {writeRpc} from '../cloudflare/student-write-api.mjs';
const api=globalThis.MinkiruCallChoicesV346;
const question={decisionType:'call',callChoiceMode:'pattern-v346',callTile:'pin5',models:[{name:'ニシキ'},{name:'ヒバカリ'}],callPredictionAvailable:[true,true],callOptions:[{code:0,values:[0,0]},{code:1,values:[80,10]},{code:2,values:[10,80]},{code:3,values:[10,10]},{code:4,values:[0,0]}]};
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const fn=name=>html.match(new RegExp(`    (?:  )?function ${name}\\([^]*?\\n    (?:  )?\\}`))[0];
function harness(q=question){
 const c={window:{MinkiruCallChoicesV346:api},SCENE:q,state:{callDecision:null,judgeModel:0},tileLabel:x=>x,renderHandV16(){},renderAnswerV16(){},requireLoginForPlayV187:()=>true};
 vm.createContext(c);
 for(const name of ['normalizeCallActionV112','callActionOptionsV112','selectedCallActionV112','selectCallV16','choiceScoreV16','scoreForQuestionV16','callActionLabelV112'])vm.runInContext(fn(name),c);
 return c;
}
test('three chi combinations and pon remain distinct visible choices using approved tiles',()=>{
 assert.deepEqual(api.options(question).map(x=>api.action(x.code)),['pass','call:1','call:2','call:3','call:4']);
 const images=t=>`<img src="tiles/${t}-66-90-l.png">`;
 for(const [key,tiles] of [['call:1',['pin6','pin7']],['call:2',['pin4','pin6']],['call:3',['pin3','pin4']],['call:4',['pin5','pin5']]]){
  const markup=api.markup(question,key,images);for(const tile of tiles)assert.ok(markup.includes(`tiles/${tile}-66-90-l.png`));
 }
 assert.equal(api.enabled({...question,callChoiceMode:undefined}),false);
 assert.deepEqual(boardRenderer.callTiles('aka2',2),['pin4','pin6']);
 assert.deepEqual(api.tiles({...question,callTile:'sou3',handBeforeDraw:['sou4','aka3']},'call:1'),['sou4','aka3']);
 assert.deepEqual(api.tiles({...question,callTile:'pin5',handBeforeDraw:['pin5','aka2']},'call:4'),['pin5','aka2']);
});
test('selecting a call shape grades exactly, rejects generic and absent choices, and preserves saved scoring',()=>{
 const c=harness();
 c.selectCallV16('call:1');assert.equal(c.choiceScoreV16().mark,'◎');
 c.selectCallV16('call:2');assert.equal(c.choiceScoreV16().mark,'△');
 c.selectCallV16('call:3');assert.equal(c.choiceScoreV16().mark,'×');
 c.selectCallV16('call');assert.equal(c.state.callDecision,'call:3');
 c.selectCallV16('call:5');assert.equal(c.state.callDecision,'call:3');
 c.selectCallV16('pass');assert.equal(c.state.callDecision,'pass');assert.equal(c.choiceScoreV16().mark,'×');
 assert.equal(c.scoreForQuestionV16(question,{callDecision:'call:2',judgeModel:'ヒバカリ'}).mark,'◎');
 assert.equal(c.scoreForQuestionV16(question,{callDecision:'call',judgeModel:'ニシキ'}),null);
 assert.equal(api.recommendation({...question,callPredictionAvailable:[false,true]},0),null);
 assert.equal(api.recommendation({...question,callOptions:[{code:0,values:[50]},{code:1,values:[50]}]},0),'call:1');
});
test('shape answers persist and aggregate separately from pass and historical binary votes',async()=>{
 const db=testD1(),actor={id:'choice-owner'};
 try{
  db.sqlite.exec("INSERT INTO profiles(id,display_name) VALUES('choice-owner','検証用'); INSERT INTO collections(id,owner_id,title,share_slug,visibility) VALUES('choice-book','choice-owner','検証用','choice-book','public'); INSERT INTO questions(id,collection_id,created_by,title,source_kind,decision_type,payload) VALUES('choice-question','choice-book','choice-owner','検証用','manual','call','{}');");
  const choices=['call:1','call:2','call:3','call:4','call:1','pass','call'];
  for(const [i,choice] of choices.entries())await writeRpc('record_shared_attempt',{p_share_slug:'choice-book',p_question_id:'choice-question',p_client_attempt_id:'pattern-'+i,p_answer:{selected:null,callDecision:choice},p_grade:'◎'},{db,actor});
  assert.deepEqual(db.sqlite.prepare('SELECT answer FROM answer_attempts ORDER BY rowid').all().map(row=>JSON.parse(row.answer).callDecision),choices);
  const stats=(await readRpc('get_question_poll_stats',{p_share_slug:'choice-book',p_question_id:'choice-question'},{db,actor}))[0];
  assert.deepEqual(stats.choice_counts,{'call:1':2,'call:2':1,'call:3':1,'call:4':1,'call:no':1,'call:yes':1});
  const elements={answerPollPanel:{},answerPollSummary:{},answerPollContent:{}};
  const c=harness();c.document={getElementById:id=>elements[id]};c.escapeHtml=x=>String(x);c.TILE_NAMES={};c.hasReachV16=()=>false;
  for(const name of ['pollChoiceV110','renderQuestionPollStatsV110'])vm.runInContext(fn(name),c);
  c.renderQuestionPollStatsV110(stats);
  const rendered=elements.answerPollContent.innerHTML;
  for(const label of ['チー（pin6・pin7）','チー（pin4・pin6）','チー（pin3・pin4）','ポン（pin5・pin5）','スルー'])assert.ok(rendered.includes(label),label);
  assert.match(rendered,/2票・28\.6%/);
 }finally{db.close();}
});
