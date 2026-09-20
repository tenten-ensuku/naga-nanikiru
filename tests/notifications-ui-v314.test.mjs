import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../public/notifications-v314.js',import.meta.url),'utf8');
function setup({available=true,opened=true,failRead=false}={}){
 const nodes=new Map(),read=[],visits=[];let who='user-a',href='https://fixture.test/?notification=notice-a';
 const node=()=>({hidden:false,textContent:'',innerHTML:'',setAttribute(){},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;}});
 const context=vm.createContext({window:{},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);}},location:{get href(){return href;}},history:{state:{},replaceState(_state,_title,url){href=String(url);}},URL,Set,Date,console});
 vm.runInContext(source,context);
 const api={async getNotificationTarget(id){return {id,available,unavailable_reason:'削除済み',kind:'comment',comment_id:'comment-a'};},async markAccountNotificationsRead(ids){if(failRead)throw Error('保存失敗');read.push(ids);},async loadAccountNotifications(){return {items:[],unread_count:0,next_cursor:null};}};
 const app=context.window.MinkiruNotificationsV314.create({api:()=>api,userId:()=>who,isReady:()=>true,async openTarget(row){visits.push(row);return opened;}});
 return {app,nodes,read,visits,api,setUser:id=>who=id,url:()=>href};
}
test('comment navigation marks read only after the destination is displayed and clears the pending route',async()=>{
 const f=setup();await f.app.resume();assert.equal(f.visits[0].comment_id,'comment-a');assert.equal(f.read[0][0],'notice-a');assert.equal(new URL(f.url()).searchParams.has('notification'),false);
});
test('failed navigation, unavailable destination and read failures retain unread and pending route',async()=>{
 for(const options of [{opened:false},{available:false},{failRead:true}]){const f=setup(options);await f.app.resume();assert.equal(f.read.length,0);assert.equal(new URL(f.url()).searchParams.get('notification'),'notice-a');}
});
test('account changes discard old in-flight notification responses',async()=>{
 const f=setup();let resolve;f.api.loadAccountNotifications=()=>new Promise(r=>resolve=r);
 const first=f.app.refresh();f.setUser('user-b');f.app.badge();resolve({items:[{id:'secret',actor_name:'別アカウント',available:true,body:'秘密',created_at:new Date().toISOString()}],unread_count:1,next_cursor:null});await first;
 assert.equal(f.nodes.get('commentNotificationList').innerHTML.includes('秘密'),false);assert.equal(f.nodes.get('commentNotificationBadge').hidden,true);
});
test('direct comment entry is separate from answering and uses stable IDs',()=>{
 const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const start=html.indexOf('      async function openNotificationTargetV314');const fn=html.slice(start,html.indexOf('      async function openRequestedQuestionAfterAuthV187',start));
 assert.match(fn,/loadSharedQuestionDetail\(row.share_slug,row.question_id\)/);assert.match(fn,/hydrateSharedCommentsV46/);assert.match(fn,/data-comment-id/);
 assert.doesNotMatch(fn,/state\.revealed\s*=|recordSharedAttempt|confirmAnswerV41|submitAnswer|answerHistory\.push/);
});

test('access-request entry keeps the loaded request while showing book management',()=>{
 const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(html,/showMenuV16\("book-settings", \{ loadManagement: false \}\)/);
 assert.match(html,/menuViewV16 === "book-settings" && loadManagement/);
 assert.match(html,/data-notification-request=/);
});
