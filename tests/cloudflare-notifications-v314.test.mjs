import test from 'node:test';
import assert from 'node:assert/strict';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {notificationRpc,DEFAULT_PREFERENCES,commentNotificationStatement,questionNotificationStatement} from '../cloudflare/notifications-v314.mjs';
import {writeRpc} from '../cloudflare/student-write-api.mjs';
import {builderRpc} from '../cloudflare/collection-builder-v235.mjs';
const users=['owner','creator','manager','participant','viewer','poster','revoked'];
function fixture(t){const db=testD1();t.after(()=>db.close());
 for(const id of users)db.sqlite.prepare('INSERT INTO profiles(id,display_name) VALUES (?,?)').run(id,id);
 db.sqlite.exec(`INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES ('book','owner','テスト問題集','book-slug','public','2026-01-01');
 INSERT INTO questions(id,collection_id,created_by,title,legacy_key,payload) VALUES ('q','book','creator','問題1','q','{"id":"q","number":1}');
 INSERT INTO collection_managers(collection_id,user_id,status,granted_by) VALUES ('book','manager','active','owner'),('book','revoked','revoked','owner');
 INSERT INTO comments(id,collection_id,question_id,user_id,body) VALUES ('prior','book','q','participant','以前のコメント');`);
 const rpc=(name,args={},user='owner')=>notificationRpc(name,args,{db,actor:user?{id:user}:null});
 const post=(user='poster',body='新しいコメント')=>writeRpc('post_shared_comment',{p_share_slug:'book-slug',p_question_id:'q',p_body:body,p_attachments:[]},{db,actor:{id:user}});
 const save=(user,patch={},subscriptions=[])=>rpc('save_notification_preferences',{p_preferences:{...DEFAULT_PREFERENCES,...patch},p_subscriptions:subscriptions},user);
 return {db,rpc,post,save};
}
test('defaults and complete recipient matrix exclude own actions, viewers and revoked managers',async t=>{
 const {db,rpc,post}=fixture(t);assert.deepEqual((await rpc('get_notification_preferences')).preferences,DEFAULT_PREFERENCES);
 const id=await post();assert.deepEqual(db.sqlite.prepare('SELECT recipient_id FROM account_notifications ORDER BY recipient_id').all().map(r=>r.recipient_id),['creator','manager','owner','participant']);
 await db.batch([commentNotificationStatement(db,id)]);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM account_notifications').get().n,4);
 const page=await rpc('list_account_notifications');assert.equal(page.unread_count,1);assert.equal(page.items[0].comment_id,id);assert.equal(page.items[0].body,'新しいコメント');
 assert.equal(page.items[0].available,true);
});
test('master and individual settings gate future events but retain previous notifications, with no backfill',async t=>{
 const {db,rpc,post,save}=fixture(t);await post();
 await save('creator',{created_comments:false});await save('owner',{enabled:false});await save('manager',{managed_comments:false});await save('participant',{conversation_comments:false});
 await post();assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM account_notifications').get().n,4);
 assert.equal((await rpc('list_account_notifications')).items.length,1);
 await save('owner');assert.equal((await rpc('list_account_notifications')).items.length,1);await post();assert.equal((await rpc('list_account_notifications')).items.length,2);
});
test('overlapping roles deliver once and comment editing does not deliver',async t=>{
 const {db,post}=fixture(t);db.sqlite.exec("UPDATE questions SET created_by='owner'; INSERT INTO comments(id,collection_id,question_id,user_id,body) VALUES('owner-prior','book','q','owner','参加')");
 const id=await post();assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM account_notifications WHERE recipient_id='owner'").get().n,1);
 await writeRpc('update_shared_comment',{p_comment_id:id,p_body:'編集後',p_attachments:[]},{db,actor:{id:'poster'}});
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM account_notifications WHERE recipient_id='owner'").get().n,1);
 await post('owner');assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM account_notifications WHERE recipient_id='owner'").get().n,1);
});
test('server prevents unauthenticated reads, preference impersonation and marking another user read',async t=>{
 const {rpc,post,save}=fixture(t);await assert.rejects(rpc('get_notification_preferences',{},null),e=>e.status===401);await post();
 const owner=await rpc('list_account_notifications'),other=await rpc('list_account_notifications',{},'creator');
 await rpc('mark_account_notifications_read',{p_ids:[owner.items[0].id,other.items[0].id]});
 assert.equal((await rpc('list_account_notifications')).unread_count,0);assert.equal((await rpc('list_account_notifications',{},'creator')).unread_count,1);
 await assert.rejects(rpc('get_notification_target',{p_id:owner.items[0].id},'viewer'),e=>e.status===404);
 await save('viewer',{enabled:false});assert.equal((await rpc('get_notification_preferences')).preferences.enabled,true);
});
test('account read state and preferences persist across clients; cursor pages remain disjoint',async t=>{
 const {db,rpc,post,save}=fixture(t);for(let i=0;i<53;i++)await post();
 const first=await rpc('list_account_notifications',{p_unread_only:true});assert.equal(first.items.length,50);assert.ok(first.next_cursor);
 const next=await rpc('list_account_notifications',{p_unread_only:true,p_cursor:first.next_cursor});assert.equal(next.items.length,3);assert.equal(new Set([...first.items,...next.items].map(r=>r.id)).size,53);
 await save('owner',{managed_comments:false});assert.equal((await notificationRpc('get_notification_preferences',{}, {db,actor:{id:'owner'}})).preferences.managed_comments,false);
 await rpc('mark_account_notifications_read',{p_ids:null});assert.equal((await notificationRpc('list_account_notifications',{p_unread_only:true},{db,actor:{id:'owner'}})).unread_count,0);
});
test('revoked access redacts content and deleted targets explain unavailability without recording an answer',async t=>{
 const {db,rpc,post}=fixture(t);const comment=await post();const row=(await rpc('list_account_notifications',{},'creator')).items[0];
 const baseline=db.sqlite.prepare('SELECT * FROM answer_attempts').all();await rpc('get_notification_target',{p_id:row.id},'creator');assert.deepEqual(db.sqlite.prepare('SELECT * FROM answer_attempts').all(),baseline);
 db.sqlite.exec("UPDATE collections SET visibility='private'");let result=await rpc('get_notification_target',{p_id:row.id},'creator');assert.equal(result.available,false);assert.equal(result.body,undefined);assert.equal(result.collection_title,undefined);
 db.sqlite.exec("UPDATE collections SET visibility='public'");db.sqlite.prepare('UPDATE comments SET deleted_at=? WHERE id=?').run('2026-01-02',comment);
 result=await rpc('get_notification_target',{p_id:row.id},'creator');assert.equal(result.available,false);assert.match(result.unavailable_reason,/コメント/);assert.equal(result.body,'');
 db.sqlite.exec("UPDATE questions SET deleted_at='2026-01-02'");assert.match((await rpc('get_notification_target',{p_id:row.id},'creator')).unavailable_reason,/問題/);
});
test('subscriptions include future series volumes and exclude inaccessible books and own additions',async t=>{
 const {db,rpc,save}=fixture(t);await save('viewer',{added_questions:true},['book']);
 db.sqlite.exec("UPDATE collections SET series_key='series'; INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at,series_parent_id,volume_number) VALUES ('v2','owner','第2巻','v2','public','2026-01-01','book',2); INSERT INTO questions(id,collection_id,created_by,title,payload) VALUES('q2','v2','owner','問題201','{}');");
 await db.batch([questionNotificationStatement(db,'q2')]);const page=await rpc('list_account_notifications',{},'viewer');assert.equal(page.items.length,1);assert.equal(page.items[0].share_slug,'v2');
 db.sqlite.exec("INSERT INTO questions(id,collection_id,created_by,title,payload) VALUES('q3','v2','viewer','問題202','{}');");await db.batch([questionNotificationStatement(db,'q3')]);assert.equal((await rpc('list_account_notifications',{},'viewer')).items.length,1);
 db.sqlite.exec("INSERT INTO collections(id,owner_id,title,share_slug) VALUES('private','owner','秘密','private')");await assert.rejects(save('viewer',{added_questions:true},['private']),e=>e.status===403);
});
test('builder notifies additions once; initial and copied comments generate no comment event',async t=>{
 const {db,rpc,save}=fixture(t);await save('viewer',{added_questions:true},['book']);
 const ctx={db,actor:{id:'owner'}},args={p_share_slug:'book-slug',p_title:'練習',p_payload:{id:'new'},p_initial_comment:'初期解説'};
 const first=await builderRpc('create_shared_question',args,ctx);await builderRpc('create_shared_question',args,ctx);
 let page=await rpc('list_account_notifications',{},'viewer');assert.equal(page.items.length,1);assert.equal(page.items[0].question_id,first.question_id);assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM account_notifications WHERE kind='comment'").get().n,0);
 const target=await builderRpc('create_collection',{p_title:'コピー先',p_request_id:crypto.randomUUID()},ctx);
 const imported=await builderRpc('import_shared_question',{p_target_share_slug:target.share_slug,p_source_question_id:'q'},ctx);
 assert.equal(imported.imported_comment_count,1);assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM account_notifications WHERE kind='comment'").get().n,0);
});
test('access requests respect preferences, recipient and retries',async t=>{
 const {db,rpc,save}=fixture(t);db.sqlite.exec("UPDATE collections SET visibility='request'");
 const args={p_share_slug:'book-slug',p_message:'参加したい'},ctx={db,actor:{id:'viewer'}};
 const id=await writeRpc('request_collection_access',args,ctx);await writeRpc('request_collection_access',args,ctx);
 const page=await rpc('list_account_notifications');assert.equal(page.items.length,1);assert.equal(page.items[0].request_id,id);assert.equal(page.items[0].body,'参加したい');
 await save('owner',{access_requests:false});await writeRpc('request_collection_access',args,{db,actor:{id:'poster'}});assert.equal((await rpc('list_account_notifications')).items.length,1);
});
test('notification failure rolls back the comment atomically',async t=>{
 const {db,post}=fixture(t);db.sqlite.exec("CREATE TRIGGER deny_notice BEFORE INSERT ON account_notifications BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 await assert.rejects(post(),/test failure/);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM comments').get().n,1);
});

test('legacy access notifications and read state survive introduction and old-client changes',async t=>{
 const {db,rpc}=fixture(t);
 db.sqlite.exec("INSERT INTO collection_access_notifications(id,recipient_id,collection_id,actor_id,kind,payload,read_at) VALUES('legacy','owner','book','viewer','access_requested','{}','2026-01-01'),('legacy-unread','owner','book','viewer','access_requested','{}',NULL)");
 let page=await rpc('list_account_notifications');assert.equal(page.items.length,2);assert.equal(page.unread_count,1);
 await rpc('mark_account_notifications_read',{p_ids:['legacy-unread']});assert.ok(db.sqlite.prepare("SELECT read_at FROM collection_access_notifications WHERE id='legacy-unread'").get().read_at);
 db.sqlite.exec("INSERT INTO collection_access_notifications(id,recipient_id,collection_id,actor_id,kind,payload) VALUES('legacy-late','owner','book','viewer','access_requested','{}');UPDATE collection_access_notifications SET read_at='2026-01-02' WHERE id='legacy-late'");
 assert.equal((await rpc('list_account_notifications')).unread_count,0);
});
