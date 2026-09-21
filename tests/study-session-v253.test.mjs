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
function historySetup(){
  const c=setup(3);
  Object.assign(c,{importedQuestionsReadyV81:true,remoteHistorySyncScopeV135:'',remoteHistorySyncPromiseV81:null,
    ANSWER_HISTORY_LIMIT_V135:5000,isSeriesParentCollectionV180:()=>false,normalizeScoreMarkV159:mark=>mark,
    renderMenuCardsV16(){},console:{warn(){}}});
  c.questionsV16.forEach(q=>q.serverQuestionId=q.id);
  c.window.NagaSupabase={configured:true,loadMyAttempts:async()=>[],loadMyAttemptsForCollection:async()=>[]};
  vm.runInContext(['answerHistorySignatureV81','remoteAttemptToLocalV81','hydrateRemoteAnswerHistoryV81'].map(source).join('\n'),c);
  return c;
}

test('forced history refresh merges remote answers and preserves existing answers and session association',async()=>{
  const c=historySetup();let reads=0;
  c.remoteHistorySyncScopeV135='user-a::a';
  c.userStateV16.answerHistory=[{questionKey:'q-2',attemptId:'local',scoreMark:'△',answeredAt:'2026-09-20T00:00:00Z',sessionId:'saved-run'},
    {questionKey:'q-0',attemptId:'remote-0',scoreMark:'◎',answeredAt:'2026-09-19T00:00:00Z',sessionId:'old-run'}];
  c.window.NagaSupabase.loadMyAttemptsForCollection=async()=>{reads++;return [0,1].map(i=>({question_id:'q-'+i,client_attempt_id:'remote-'+i,grade:'◎',answered_at:'2026-09-21T00:00:00Z',answer:{selected:'白'}}));};
  assert.equal(await c.hydrateRemoteAnswerHistoryV81(),0);assert.equal(reads,0);
  assert.equal(await c.hydrateRemoteAnswerHistoryV81({force:true,strict:true}),2);
  assert.equal(reads,1);assert.equal(c.userStateV16.answerHistory.length,3);
  assert.equal(c.userStateV16.answerHistory.find(h=>h.questionKey==='q-0').sessionId,'old-run');
  assert.equal(c.userStateV16.answerHistory.find(h=>h.questionKey==='q-2').sessionId,'saved-run');
  await c.hydrateRemoteAnswerHistoryV81({force:true,strict:true});assert.equal(c.userStateV16.answerHistory.length,3);
});

test('starting unanswered waits for an in-flight history read and does not reuse another account response',async()=>{
  for(const changedAccount of [false,true]){
    const c=historySetup();let finish,reads=0;
    c.window.NagaSupabase.loadMyAttemptsForCollection=()=>{reads++;return new Promise(resolve=>finish=resolve);};
    const background=c.hydrateRemoteAnswerHistoryV81();const start=c.startSessionV44('unanswered',c.questionsV16);
    assert.equal(c.opened.length,0);assert.equal(reads,1);
    if(changedAccount)c.supabaseSessionV46={user:{id:'new-user'}};
    finish([{question_id:'q-0',client_attempt_id:'remote-0',grade:'◎',answered_at:'2026-09-21T00:00:00Z',answer:{}}]);
    await Promise.all([background,start]);
    assert.equal(c.opened.length,changedAccount?0:1);
    assert.equal(c.userStateV16.answerHistory.length,changedAccount?0:1);
    if(!changedAccount)assert.equal(c.currentQuestionIndexV16,1);
  }
});

test('history read failure or unavailable history cannot start unanswered and can be retried',async()=>{
  const c=historySetup();let alerts=0;c.window.alert=()=>alerts++;
  c.window.NagaSupabase.loadMyAttemptsForCollection=async()=>{throw Error('offline');};
  await c.startSessionV44('unanswered',c.questionsV16);assert.equal(c.opened.length,0);assert.equal(alerts,1);
  assert.equal(c.remoteHistorySyncPromiseV81,null);assert.equal(c.unansweredStartPendingV320,null);
  c.importedQuestionsReadyV81=false;
  await c.startSessionV44('unanswered',c.questionsV16);assert.equal(c.opened.length,0);assert.equal(alerts,2);
  c.importedQuestionsReadyV81=true;c.window.NagaSupabase.loadMyAttemptsForCollection=async()=>[];
  await c.startSessionV44('unanswered',c.questionsV16);assert.equal(c.opened.length,1);
});
function setup(count=24){
  const context=vm.createContext({console,Date,crypto:webcrypto,window:{alert(){}},
    questionsV16:Array.from({length:count},(_,i)=>({id:'q-'+i,number:i+1})),
    userStateV16:{sessions:{},activeSessionId:null,answerHistory:[]},scope:'a',opened:[],shown:[],saved:null,
    requireLoginForPlayV187:()=>true,sharedQuestionPagingIsCurrentV177:()=>false,
    isPlayableV16:q=>!q.disabled,questionKeyV16:q=>q.id,
    menuRangeV60:'all',state:{},menuFilterActiveV80:()=>false,captureNavigationV234(){},
    unansweredStartPendingV320:null,menuViewV16:'today',supabaseSessionV46:{user:{id:'user-a'}},sharedCollectionV46:{share_slug:'a'},sharedQuestionPagingV177:{generation:1},
    escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    document:{getElementById:()=>({setAttribute(){},removeAttribute(){}}),querySelector:()=>({classList:{contains:()=>true}})}});
  vm.runInContext(ux,context);
  context.currentCollectionScopeKeyV167=()=>context.scope;
  context.questionIndexByKeyV44=key=>context.questionsV16.findIndex(q=>q.id===key);
  context.learningCandidatesV189=mode=>context.questionsV16.filter(q=>!q.disabled&&(mode!=='unanswered'||!context.latestAnswerV44(q)));
  context.openQuestionV16=(index,options)=>{context.currentQuestionIndexV16=index;context.opened.push({index,options});return true;};
  context.showMenuV16=view=>context.shown.push(view);
  context.saveUserStateV16=()=>{context.saved=copy(context.userStateV16);return true;};
  vm.runInContext(['sessionQuestionIndexV167','sessionBelongsToCurrentCollectionV167','activeSessionV44',
    'resumableSessionV253','sessionResumeCursorV253','extendLegacySessionV253','pauseSessionV253','returnFromQuestionV256','latestAnswerV44','learningLatestAnswersV189','prepareUnansweredStartV320',
    'normalizedQueueKeysV44','startSessionV44','completeSessionV44','advanceQuestionV44','nextButtonLabelV44',
    'learningCardSessionV254','learningResumeLabelV254','sessionModeLabelV44','startLearningSessionV189',
    'renderLearningActionButtonV194','syncLearningActionCountsV189'].map(source).join('\n'),context);
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
  assert.equal(c.shown.at(-1),'today');
});

test('storage failure does not claim that progress was saved or navigate away',()=>{
  const c=setup();c.startSessionV44('all',c.questionsV16);const session=c.activeSessionV44();
  session.results=[{questionKey:'q-0',scoreMark:'〇'}];c.saveUserStateV16=()=>false;
  const alerts=[];c.window.alert=message=>alerts.push(message);c.pauseSessionV253();
  assert.equal(session.cursor,0);assert.equal(session.status,'active');assert.equal(c.activeSessionV44().id,session.id);
  assert.deepEqual(c.shown,[]);assert.match(alerts[0],/保存できませんでした/);
});

test('V256 removes the progress strip and uses the existing back action to pause without a new control',()=>{
  assert.doesNotMatch(html,/sessionStrip|sessionProgressLabel|sessionProgressFill|sessionExitButton|renderSessionProgressV44|class="session-strip"/);
  assert.match(html,/menuButton"\)\.addEventListener\("click", returnFromQuestionV256\)/);
  assert.match(html,/この端末に保存・日付が変わっても再開できます/);
  assert.match(source('startSessionV44'),/ensureSharedQuestionIndexAllV177/);
  assert.doesNotMatch(source('startSessionV44'),/ensureSharedQuestionDetail/);
  assert.match(source('openQuestionV16'),/await ensureSharedQuestionDetailV170\(requestedQuestion, index\)/);
});

test('V256 back saves an active run and resumes the next unanswered question, or preserves the non-session origin',()=>{
  const c=setup();c.startSessionV44('unanswered',c.questionsV16);const session=c.activeSessionV44();
  session.cursor=3;session.results=[{questionKey:'q-3',scoreMark:'〇'}];
  c.returnFromQuestionV256();assert.equal(session.status,'paused');assert.equal(session.cursor,4);
  assert.deepEqual(c.shown,['today']);assert.equal(c.saved.sessions[session.id].cursor,4);
  c.startLearningSessionV189('unanswered');assert.equal(c.activeSessionV44().id,session.id);assert.equal(c.opened.at(-1).index,4);
  c.userStateV16.activeSessionId=null;c.questionOriginViewV234='my';c.returnFromQuestionV256();assert.equal(c.shown.at(-1),'my');
});

test('V254 annotates only the previous card without adding a resume control',()=>{
  const c=setup();c.startSessionV44('weak',c.questionsV16);c.activeSessionV44().cursor=11;c.pauseSessionV253();
  const cards=['unanswered','weak','all'].map(mode=>c.renderLearningActionButtonV194({mode,title:mode,count:24,description:mode==='weak'?'直近の回答が△または×の問題':'説明',tone:mode}));
  assert.equal((cards.join('').match(/<button /g)||[]).length,3);
  assert.equal((cards.join('').match(/data-resume-v254=/g)||[]).length,1);
  assert.match(cards[1],/前回の続き・12問目から/);
  assert.match(cards[1],/aria-label="weak 前回の続き・12問目から"/);
  assert.doesNotMatch(cards[0]+cards[2],/前回の続き/);
  assert.match(cards[0],/title="説明"/);
  assert.match(cards[1],/title="直近の回答が△または×の問題"/);
  assert.doesNotMatch(cards.join(""),/class="learning-action-description"/);
  assert.doesNotMatch(source('renderRecentHistoryViewV180'),/learning-resume|data-today-session="resume"|resumeMarkup/);
});

test('V254 clicking the previous card resumes its saved queue, not a newly filtered list',()=>{
  for(const [savedMode,cardMode] of [['all','all'],['weak','weak'],['unanswered','unanswered'],['range','all'],['range-unanswered','unanswered'],['favorites','all']]){
    const c=setup();c.startSessionV44(savedMode,[...c.questionsV16].reverse());
    const session=c.activeSessionV44();session.cursor=5;c.pauseSessionV253();
    c.learningCandidatesV189=()=>[];
    c.startLearningSessionV189(cardMode);
    assert.equal(c.activeSessionV44().id,session.id,savedMode);
    assert.equal(c.opened.at(-1).index,18,savedMode);
    assert.equal(c.activeSessionV44().mode,savedMode);
    assert.equal(c.activeSessionV44().questionKeys.length,24);
  }
});

test('finished saved runs no longer turn the study card into an unexpected results link',()=>{
  const c=setup(2);c.startSessionV44('unanswered',c.questionsV16);const session=c.activeSessionV44();
  session.results=[{questionKey:'q-0'}];
  assert.equal(c.learningResumeLabelV254(session),'前回の続き・2問目から');
  session.results.push({questionKey:'q-1'});
  c.userStateV16.answerHistory=[{questionKey:'q-0'},{questionKey:'q-1'}];
  assert.equal(c.learningResumeLabelV254(session),'');
  assert.equal(c.learningCardSessionV254('unanswered'),null);
  c.startLearningSessionV189('unanswered');assert.equal(session.status,'completed');
  assert.equal(c.learningCardSessionV254('unanswered'),null);
  assert.ok(c.shown.every(view=>view==='today'));
});

test('only explicit results activation opens results, including a keyboard activation of that button',async()=>{
  for(const keyboard of [false,true]){
    const c=setup(1);c.startSessionV44('unanswered',c.questionsV16);
    c.document.getElementById=()=>({textContent:'結果を見る'});
    await c.advanceQuestionV44(keyboard?undefined:{currentTarget:{textContent:'結果を見る'}});
    assert.equal(c.shown.at(-1),'session');
  }
  const c=setup(2);c.startSessionV44('unanswered',c.questionsV16);c.questionsV16[1].disabled=true;
  await c.advanceQuestionV44({currentTarget:{textContent:'次の問題へ'}});
  assert.equal(c.shown.at(-1),'today','a missing next question must not silently turn Next into Results');
});

test('unanswered resume skips answers from other sessions and devices without treating comments as answers',()=>{
  for(const mode of ['unanswered','range-unanswered']){
    const c=setup(4);c.startSessionV44(mode,c.questionsV16);const session=c.activeSessionV44();
    session.cursor=0;session.status='paused';c.userStateV16.activeSessionId=null;
    const history=[{questionKey:'q-0',sessionId:'other',scoreMark:'×'},{questionKey:'q-1',attemptId:'remote-answer',scoreMark:'◎'}];
    c.userStateV16.answerHistory=copy(history);c.questionsV16[2].comments=[{authorId:'user-a',content:'comment only'}];
    c.startSessionV44('resume');assert.equal(c.currentQuestionIndexV16,2);assert.equal(c.activeSessionV44().id,session.id);
    assert.deepEqual(copy(c.userStateV16.answerHistory),history);
  }
});

test('unanswered Next also skips globally answered questions, while all and weak keep repeat practice',async()=>{
  for(const mode of ['unanswered','range-unanswered','all','weak']){
    const c=setup(4);c.startSessionV44(mode,c.questionsV16);
    c.userStateV16.answerHistory=[{questionKey:'q-1',scoreMark:'×'},{questionKey:'q-2',scoreMark:'◎'}];
    await c.advanceQuestionV44({currentTarget:{textContent:'次の問題へ'}});
    assert.equal(c.currentQuestionIndexV16,['all','weak'].includes(mode)?1:3,mode);
  }
});

test('unanswered start waits for history, coalesces taps and filters the queued candidates after sync',async()=>{
  const c=setup(3);c.window.NagaSupabase={configured:true};let finish,reads=0;
  c.hydrateRemoteAnswerHistoryV81=options=>{assert.equal(options.force,true);assert.equal(options.strict,true);reads++;return new Promise(resolve=>finish=resolve);};
  const first=c.startSessionV44('unanswered',c.questionsV16),second=c.startSessionV44('unanswered',c.questionsV16);
  assert.equal(reads,1);assert.equal(first,second);assert.equal(c.opened.length,0);
  c.userStateV16.answerHistory=[{questionKey:'q-0',scoreMark:'〇'}];finish();await first;
  assert.equal(c.currentQuestionIndexV16,1);assert.deepEqual([...c.activeSessionV44().questionKeys],['q-1','q-2']);
});

test('history failure or navigation/account change cannot open an unverified unanswered question',async()=>{
  for(const change of ['failure','book','account','view']){
    const c=setup(3);c.window.NagaSupabase={configured:true};let finish;const alerts=[];
    c.window.alert=text=>alerts.push(text);
    c.hydrateRemoteAnswerHistoryV81=()=>change==='failure'?Promise.reject(Error('offline')):new Promise(resolve=>finish=resolve);
    const task=c.startSessionV44('unanswered',c.questionsV16);
    if(change==='book')c.scope='b';if(change==='account')c.supabaseSessionV46={user:{id:'user-b'}};if(change==='view')c.menuViewV16='collections';
    finish?.();await task;assert.equal(c.opened.length,0);assert.equal(c.userStateV16.activeSessionId,null);
    assert.equal(alerts.length,change==='failure'?1:0);
  }
});

test('V254 zero current candidates do not disable the card holding a saved run or its results',()=>{
  const c=setup();c.startSessionV44('weak',c.questionsV16);c.pauseSessionV253();
  const card=c.renderLearningActionButtonV194({mode:'weak',title:'苦手',count:0,description:'説明',tone:'weak',disabled:' disabled aria-disabled="true"'});
  assert.doesNotMatch(card,/ disabled|aria-disabled="true"/);
  c.sharedQuestionKnownTotalV177=()=>null;c.learningLatestAnswersV189=()=>new Map();c.learningCandidatesV189=()=>[];
  const buttons=['weak','all'].map(mode=>({dataset:{learningAction:mode},attrs:{},querySelector:selector=>selector==='.learning-action-title'?{textContent:mode}:{innerHTML:''},setAttribute(name,value){this.attrs[name]=value;}}));
  c.document.querySelectorAll=()=>buttons;c.syncLearningActionCountsV189();
  assert.equal(buttons[0].disabled,false);assert.equal(buttons[1].disabled,true);
  assert.match(buttons[0].attrs['aria-label'],/前回の続き/);
  assert.equal(buttons[1].attrs['aria-label'],'all 0問の学習を開始');
});

test('V254 other cards still start their own mode and finished runs have no resume annotation',()=>{
  const c=setup();c.startSessionV44('weak',c.questionsV16);const previous=c.activeSessionV44();c.pauseSessionV253();
  c.startLearningSessionV189('all');assert.equal(c.activeSessionV44().mode,'all');assert.equal(previous.status,'replaced');
  c.completeSessionV44(c.activeSessionV44());
  assert.equal(c.learningCardSessionV254('all'),null);
  assert.doesNotMatch(c.renderLearningActionButtonV194({mode:'all',title:'全問',count:24,description:'説明',tone:'all'}),/data-resume-v254/);
});
