import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {readRpc} from '../cloudflare/read-api.mjs';
import {writeRpc} from '../cloudflare/student-write-api.mjs';

const actor={id:'poll-viewer',is_admin:false};
function fixture(){
  const db=testD1();
  db.sqlite.exec(`INSERT INTO profiles(id,display_name) VALUES ('poll-viewer','Local viewer');
    INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES ('poll-book','poll-viewer','Local poll','poll-book','public','2026-10-01T00:00:00Z');
    INSERT INTO questions(id,collection_id,created_by,title,source_kind,decision_type,payload) VALUES ('poll-question','poll-book','poll-viewer','Local call','manual','call','{}');`);
  return db;
}
async function save(db,decision,index,extra={}){
  return writeRpc('record_shared_attempt',{p_share_slug:'poll-book',p_question_id:'poll-question',p_client_attempt_id:'poll-'+index,p_answer:{selected:null,callDecision:decision,...extra},p_grade:'◎',p_elapsed_ms:1000,p_answered_at:'2026-10-01T00:00:00Z'},{db,actor});
}
const poll=db=>readRpc('get_question_poll_stats',{p_share_slug:'poll-book',p_question_id:'poll-question'},{db,actor}).then(rows=>rows[0]);

test('call once then pass three times persists four choices and aggregates 1 call / 3 passes without rewriting history',async()=>{
  const db=fixture();
  try{
    for(const [i,decision] of ['call','pass','pass','pass'].entries())await save(db,decision,i);
    const before=db.sqlite.prepare('SELECT * FROM answer_attempts ORDER BY client_attempt_id').all();
    assert.deepEqual(before.map(row=>JSON.parse(row.answer).callDecision),['call','pass','pass','pass']);
    const stats=await poll(db);
    assert.equal(stats.sample_size,4);
    assert.deepEqual(stats.choice_counts,{'call:yes':1,'call:no':3});
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM answer_attempts ORDER BY client_attempt_id').all(),before);
  }finally{db.close();}
});

test('current and legacy call encodings coexist while kan, empty, unknown and discard votes remain distinct',async()=>{
  const db=fixture();
  try{
    const cases=[['call','call:yes'],['pass','call:no'],[true,'call:yes'],[false,'call:no'],['true','call:yes'],['false','call:no'],['call:yes','call:yes'],['call:no','call:no'],['kan','call:kan'],['call:kan','call:kan'],[null,'unknown'],['','unknown'],['unexpected','unknown']];
    const expected={};
    for(const [i,[decision,key]] of cases.entries()){await save(db,decision,i);expected[key]=(expected[key]||0)+1;}
    await save(db,null,100,{selected:'man5',riichi:true});expected['man5|reach']=1;
    await save(db,null,101,{selected:'aka3',riichi:false});expected['aka3|no-reach']=1;
    assert.deepEqual((await poll(db)).choice_counts,expected);
  }finally{db.close();}
});

test('call poll rendering never displays unknown votes as call and renders 3 passes / 1 call as 75% / 25%',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const extract=name=>{const indent=name==='normalizeCallActionV112'?'    ':'      ';const start=html.indexOf(indent+'function '+name+'('),end=html.indexOf('\n'+indent+'}',start);assert.ok(start>=0&&end>start);return html.slice(start,end+indent.length+2);};
  const elements={answerPollPanel:{},answerPollSummary:{},answerPollContent:{}};
  const c=vm.createContext({SCENE:{decisionType:'call'},document:{getElementById:id=>elements[id]},escapeHtml:x=>String(x),TILE_NAMES:{},hasReachV16:()=>false,tileImage:()=>''});
  for(const name of ['normalizeCallActionV112','pollChoiceV110','renderQuestionPollStatsV110'])vm.runInContext(extract(name),c);
  c.renderQuestionPollStatsV110({sample_size:4,choice_counts:{'call:yes':1,'call:no':3}});
  assert.match(elements.answerPollContent.innerHTML,/スルー[\s\S]*?3票・75\.0%/);
  assert.match(elements.answerPollContent.innerHTML,/鳴く[\s\S]*?1票・25\.0%/);
  c.renderQuestionPollStatsV110({sample_size:1,choice_counts:{unknown:1}});
  assert.doesNotMatch(elements.answerPollContent.innerHTML,/鳴く|スルー/);
  assert.match(elements.answerPollContent.innerHTML,/未選択/);
  c.renderQuestionPollStatsV110({sample_size:2,choice_counts:{'call:kan':1,'call:yes':1}});
  assert.match(elements.answerPollContent.innerHTML,/鳴く[\s\S]*?2票・100\.0%/,'keep the existing binary call-vs-pass display');
});
