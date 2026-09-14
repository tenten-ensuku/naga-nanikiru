import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {readRpc} from '../cloudflare/read-api.mjs';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ux=fs.readFileSync(new URL('../public/drill-ux-v44.js',import.meta.url),'utf8');
const navigation=fs.readFileSync(new URL('../public/navigation-v234.js',import.meta.url),'utf8');
const readFunction=name=>{const match=html.match(new RegExp(`      function ${name}\\([^]*?\\n      \\}`));assert.ok(match,name);return match[0];};

test('all app script blocks compile and removed UI has no dangling DOM references',()=>{
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
 assert.doesNotMatch(html,/menuSidebarProgress|id="archiveQuestionButton"|id="menuArchiveViewButton"|data-menu-(?:jump|action)="(?:unarchive|archive)"|archiveCurrentQuestionV110|menuArchiveIconV109/);
 assert.match(html,/class="learning-header-progress"/);
 assert.match(html,/data-menu-action="favorite"/);
 assert.match(html,/MinkiruCollectionDeletionV244\.bind/);
 const sidebar=html.match(/<aside[^>]*class="menu-sidebar"[^]*?<\/aside>/)?.[0]||'';
 assert.doesNotMatch(sidebar,/学習の進捗|回答率|習熟度/);
});

test('retained archive markers never hide questions or inflate actual answer/mastery statistics',()=>{
 const questions=[{id:'old'},{id:'answered'},{id:'hidden'},{id:'trashed'}];
 const state={hidden:['hidden'],trashed:['trashed'],archived:['old'],favorites:['old'],collectionPersonal:{'owner::book':{archived:['old'],favorites:['old'],initialized:true}},answerHistory:[{questionKey:'answered',scoreMark:'〇',answeredAt:'2026-09-14T00:00:00Z'}]};
 const before=JSON.stringify(state);const context=vm.createContext({userStateV16:state,questionsV16:questions,Date,Boolean,String,personalCollectionStateV131:()=>state.collectionPersonal['owner::book'],latestAnswerV44:q=>state.answerHistory.find(a=>a.questionKey===q.id)});
 vm.runInContext(ux,context);context.window={DrillUxV44:context.DrillUxV44};
 vm.runInContext(['questionKeyV16','isHiddenV16','isTrashedV16','isFavoriteV16','isPlayableV16','isLearningScopeQuestionV184','isMasteredForLearningV184','isAnsweredForLearningV184'].map(readFunction).join('\n'),context);
 assert.equal(context.isPlayableV16(questions[0]),true);assert.equal(context.isFavoriteV16(questions[0]),true);
 assert.equal(context.isAnsweredForLearningV184(questions[0]),false);assert.equal(context.isMasteredForLearningV184(questions[0]),false);
 assert.equal(context.isAnsweredForLearningV184(questions[1]),true);assert.equal(context.isMasteredForLearningV184(questions[1]),true);
 assert.equal(context.isPlayableV16(questions[2]),false);assert.equal(context.isPlayableV16(questions[3]),false);
 const queue=context.DrillUxV44.buildQueue({questions,state,mode:'all',archivedKeys:['old']});
 assert.deepEqual(Array.from(queue,q=>q.id),['old','answered']);assert.equal(JSON.stringify(state),before);
 assert.doesNotMatch(html,/(?:masteredKeys|archivedKeys): personalCollectionStateV131\(\)\.archived/);
});

test('library server summary ignores legacy archive overrides and reads only actual owner answers',async t=>{
 const db=testD1();t.after(()=>db.close());
 db.sqlite.exec("INSERT INTO profiles(id) VALUES('owner'); INSERT INTO collections(id,owner_id,title,share_slug) VALUES('book','owner','Fixture','book'); INSERT INTO questions(id,collection_id,created_by,title) VALUES('old','book','owner','Old archive');");
 const ctx={db,actor:{id:'owner'}};
 const before=db.sqlite.prepare('SELECT COUNT(*) n FROM questions').get().n;
 const [summary]=await readRpc('get_collection_library_summary',{p_share_slug:'book',p_archived_keys:['old']},ctx);
 assert.equal(summary.question_count,1);assert.equal(summary.answered_count,0);assert.equal(summary.mastered_count,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM questions').get().n,before);
});

test('legacy archive URLs and remembered routes become the normal question list',()=>{
 const context=vm.createContext({URL,structuredClone});vm.runInContext(navigation,context);const api=context.MinkiruNavigationV234;
 assert.equal(api.normalizeView('archive'),'my');
 assert.equal(new URL(api.routeUrl('https://example.invalid/?view=archive',{slug:'book',view:'archive'})).searchParams.get('view'),'my');
 const memory=api.createMemory();memory.setOwner('owner');memory.remember({version:234,owner:'owner',slug:'book',view:'archive',originView:'archive'});
 assert.equal(memory.route('book','archive').view,'my');assert.equal(memory.lastStudy('book').originView,'my');
});

test('list layout has exactly three columns and keeps a 44px favorite target',()=>{
 const css=fs.readFileSync(new URL('../public/menu-simplify-v245.css',import.meta.url),'utf8');
 assert.match(css,/grid-template-columns: minmax\(0, 1fr\) minmax\(120px, 190px\) 64px/);
 assert.match(css,/grid-template-columns: minmax\(0, 1fr\) max-content 44px/);
 assert.match(css,/min-height: 44px/);
 const listHeader=html.match(/<div[^>]*id="menuListHeader"[^]*?<\/div>/)?.[0]||'';
 assert.equal((listHeader.match(/<span\b/g)||[]).length,3);
});
