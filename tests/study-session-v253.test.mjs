import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ux=fs.readFileSync(new URL('../public/drill-ux-v44.js',import.meta.url),'utf8');
function source(name){
  const match=html.match(new RegExp(`^      (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^      \\}`,'m'));
  assert.ok(match,name);return match[0];
}
const copy=value=>JSON.parse(JSON.stringify(value));
function setup(count=24){
  const context=vm.createContext({console,Date,crypto:webcrypto,window:{alert(){}},
    questionsV16:Array.from({length:count},(_,i)=>({id:'q-'+i,number:i+1})),
    userStateV16:{sessions:{},activeSessionId:null,answerHistory:[]},scope:'a',opened:[],shown:[],saved:null,
    requireLoginForPlayV187:()=>true,sharedQuestionPagingIsCurrentV177:()=>false,
    isPlayableV16:q=>!q.disabled,questionKeyV16:q=>q.id,latestAnswerV44:()=>null,
    menuRangeV60:'all',state:{},menuFilterActiveV80:()=>false,captureNavigationV234(){},
    document:{getElementById:()=>({setAttribute(){},removeAttribute(){}})}});
  vm.runInContext(ux,context);
  context.currentCollectionScopeKeyV167=()=>context.scope;
  context.questionIndexByKeyV44=key=>context.questionsV16.findIndex(q=>q.id===key);
  context.learningCandidatesV189=()=>context.questionsV16.filter(q=>!q.disabled);
  context.openQuestionV16=(index,options)=>{context.currentQuestionIndexV16=index;context.opened.push({index,options});return true;};
  context.showMenuV16=view=>context.shown.push(view);
  context.saveUserStateV16=()=>{context.saved=copy(context.userStateV16);return true;};
  vm.runInContext(['sessionQuestionIndexV167','sessionBelongsToCurrentCollectionV167','activeSessionV44',
    'resumableSessionV253','sessionResumeCursorV253','extendLegacySessionV253','pauseSessionV253',
    'normalizedQueueKeysV44','startSessionV44','completeSessionV44','advanceQuestionV44','nextButtonLabelV44'].map(source).join('\n'),context);
  return context;
}

test('every study entry uses all matching questions, including question 11 and explicit ranges',async()=>{
  for(const mode of ['all','unanswered','weak','range','range-unanswered','today','recommended','call','riichi']){
    const c=setup(137);c.startSessionV44(mode,c.questionsV16);
    const session=c.activeSessionV44();assert.equal(session.questionKeys.length,137,mode);
    assert.ok(session.id.length<60,'session ID must not duplicate the entire queue');
    for(let i=0;i<10;i++)await c.advanceQuestionV44();
    assert.equal(session.cursor,10);assert.equal(c.opened.at(-1).index,10);
    assert.equal(c.nextButtonLabelV44(),'次の問題へ');assert.deepEqual(c.shown,[]);
  }
  const c=setup(24);c.startSessionV44('unanswered');assert.equal(c.activeSessionV44().questionKeys.length,24);
  assert.doesNotMatch(source('startSessionV44'),/limit:\s*10|slice\(0,\s*10\)/);
  assert.doesNotMatch(source('todayQueueCandidatesV172'),/limit:\s*10|slice\(0,\s*10\)/);
});

test('pause before answering resumes the same question after reload and a later day',()=>{
  const c=setup();c.startSessionV44('all',c.questionsV16);const id=c.activeSessionV44().id;
  c.pauseSessionV253();assert.deepEqual(c.shown,['today']);assert.equal(c.userStateV16.activeSessionId,null);
  assert.equal(c.saved.sessions[id].status,'paused');
  const next=setup();next.userStateV16=copy(c.saved);next.userStateV16.sessions[id].updatedAt='2020-01-01';
  next.startSessionV44('resume');assert.equal(next.activeSessionV44().id,id);assert.equal(next.opened.at(-1).index,0);
  assert.equal(next.activeSessionV44().status,'active');assert.equal(next.userStateV16.answerHistory.length,0);
});

test('pause after answering resumes at the next question without rewriting an answer',()=>{
  const c=setup();c.startSessionV44('all',c.questionsV16);
  const session=c.activeSessionV44();session.results=[{questionKey:'q-0',scoreMark:'〇'}];
  c.userStateV16.answerHistory=[{questionKey:'q-0',attemptId:'retained'}];
  c.pauseSessionV253();assert.equal(session.cursor,1);
  const next=setup();next.userStateV16=copy(c.saved);next.startSessionV44('resume');
  assert.equal(next.opened.at(-1).index,1);
  assert.deepEqual(copy(next.userStateV16.answerHistory),[{questionKey:'q-0',attemptId:'retained'}]);
  assert.equal(next.opened.at(-1).options.resume,undefined,'do not resurrect an old revealed draft for the next question');
});

test('each book retains its own pause, unrelated questions do not erase it, and accounts remain separate',()=>{
  const c=setup();c.startSessionV44('all',c.questionsV16);const a=c.activeSessionV44();a.cursor=4;c.pauseSessionV253();
  c.scope='b';assert.equal(c.resumableSessionV253(),null);
  c.startSessionV44('all',c.questionsV16);const b=c.activeSessionV44();b.cursor=7;c.pauseSessionV253();
  c.scope='a';assert.equal(c.resumableSessionV253().id,a.id);c.startSessionV44('resume');assert.equal(c.opened.at(-1).index,4);
  c.scope='b';assert.equal(c.resumableSessionV253().id,b.id);
  c.userStateV16={sessions:{},activeSessionId:null};assert.equal(c.resumableSessionV253(),null);
  assert.match(source('userStateStorageKeyV232'),/cloudflare:\$\{supabaseSessionV46\?\.user\?\.id/);
  assert.doesNotMatch(source('openQuestionV16'),/delete userStateV16.sessions/);
});

test('starting another mode in the same book replaces only that unfinished run, not its answers',()=>{
  const c=setup();c.startSessionV44('all',c.questionsV16);const first=c.activeSessionV44();
  first.results=[{questionKey:'q-0',scoreMark:'〇'}];c.startSessionV44('weak',c.questionsV16.slice(2));
  assert.equal(first.status,'replaced');assert.equal(first.results.length,1);
  assert.notEqual(c.resumableSessionV253().id,first.id);
});

test('legacy ten-question sessions keep their order and answers while gaining the remaining eligible questions',()=>{
  const c=setup(32);
  c.userStateV16.sessions.old={id:'old',mode:'unanswered',collectionSlug:'a',status:'paused',cursor:9,
    questionKeys:c.questionsV16.slice(0,10).map(q=>q.id),results:[{questionKey:'q-9',scoreMark:'〇'}]};
  c.startSessionV44('resume');const session=c.activeSessionV44();assert.equal(session.id,'old');
  assert.equal(session.questionKeys.length,32);assert.equal(c.opened.at(-1).index,10);assert.equal(session.results.length,1);
});

test('unavailable questions are skipped, and the actual end finishes normally rather than looping',()=>{
  const c=setup(12);c.startSessionV44('all',c.questionsV16);const session=c.activeSessionV44();
  c.questionsV16[0].disabled=true;session.results=[{questionKey:'q-1',scoreMark:'〇'}];
  c.pauseSessionV253();assert.equal(session.cursor,2);c.startSessionV44('resume');assert.equal(c.opened.at(-1).index,2);
  session.cursor=11;session.results.push({questionKey:'q-11',scoreMark:'〇'});c.pauseSessionV253();
  assert.equal(session.status,'completed');assert.equal(c.userStateV16.activeSessionId,null);assert.equal(c.resumableSessionV253(),null);
  assert.equal(c.shown.at(-1),'session');
});

test('storage failure does not claim that progress was saved or navigate away',()=>{
  const c=setup();c.startSessionV44('all',c.questionsV16);const session=c.activeSessionV44();
  session.results=[{questionKey:'q-0',scoreMark:'〇'}];c.saveUserStateV16=()=>false;
  const alerts=[];c.window.alert=message=>alerts.push(message);c.pauseSessionV253();
  assert.equal(session.cursor,0);assert.equal(session.status,'active');assert.equal(c.activeSessionV44().id,session.id);
  assert.deepEqual(c.shown,[]);assert.match(alerts[0],/保存できませんでした/);
});

test('the pause action is touch-sized, returns to study home, and does not fetch a whole book',()=>{
  assert.match(html,/sessionExitButton"\)\.addEventListener\("click", pauseSessionV253\)/);
  assert.match(html,/\.session-exit \{ min-height: 44px/);
  assert.match(html,/この端末に保存・日付が変わっても再開できます/);
  assert.match(source('startSessionV44'),/ensureSharedQuestionIndexAllV177/);
  assert.doesNotMatch(source('startSessionV44'),/ensureSharedQuestionDetail/);
  assert.match(source('openQuestionV16'),/await ensureSharedQuestionDetailV170\(requestedQuestion, index\)/);
});
