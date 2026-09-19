import {ApiError,requireActor} from './access.mjs';
import {startDiscord,finishDiscord,sessionFor,sessionResponse,endSession,requireCsrf} from './auth.mjs';
import {READ_RPCS,readRpc,readTable} from './read-api.mjs';
import {WRITE_RPCS,writeRpc,writeTable} from './student-write-api.mjs';
import {mediaRead} from './media-read.mjs';
import {BUILDER_RPCS,builderRpc,collectionCapacity} from './collection-builder-v235.mjs';
import {previewCollectionDeletion,deleteCollection} from './collection-deletion-v244.mjs';
import {MANAGER_READ_RPCS,MANAGER_WRITE_RPCS,managerRpc} from './collection-managers-v290.mjs';
import {QUESTION_MANAGEMENT_RPCS,questionManagementRpc} from './question-management-v290.mjs';
import {imageUpload} from './media-write-v241.mjs';
import {createGenerationApi} from './generation-api-v241.mjs';
import {guideVideo} from './guide-video-v296.mjs';
import {reconcileMediaBudget} from './generation-capacity-v241.mjs';
import {authenticateDiscordBot,createDiscordSyncApi} from './discord-sync-v242.mjs';
const discordSyncApi=createDiscordSyncApi();
const generationApi=createGenerationApi({cache:globalThis.caches?.default??null});
const generationEnabled=env=>env.GENERATION_ENABLED==='true'&&env.UPLOADS_ENABLED==='true';

// Generation, image uploads and the two scoped Discord sources have separate
// switches. New accounts use ordinary student permissions; legacy bulk imports remain paused.
export const MIGRATION_IMPLEMENTATION_COMPLETE=false;
export const STUDENT_FLOW_IMPLEMENTATION_COMPLETE=true;
const readNames=new Set(READ_RPCS),writeNames=new Set(WRITE_RPCS);
const builderNames=new Set(BUILDER_RPCS);
const common={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'};
const ready=env=>env?.CUTOVER_READY==='true'&&!!env.DB&&/^\d{15,22}$/.test(env.DISCORD_CLIENT_ID||'')&&!!env.DISCORD_CLIENT_SECRET;
const json=(data,status=200)=>Response.json(data,{status,headers:common});
async function limited(binding,key){if(binding&&!((await binding.limit({key})).success))throw new ApiError('rate_limited',429);}
export async function jsonBody(request,maximum=131072){
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new ApiError('json_required',415);
  if(Number(request.headers.get('Content-Length'))>maximum)throw new ApiError('request_too_large',413);
  const reader=request.body?.getReader();let bytes=0,parts=[];
  if(reader){while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>maximum){await reader.cancel();throw new ApiError('request_too_large',413);}parts.push(value);}}
  const buffer=new Uint8Array(bytes);let offset=0;for(const part of parts){buffer.set(part,offset);offset+=part.length;}
  try {const result=JSON.parse(new TextDecoder().decode(buffer));if(!result||typeof result!=='object'||Array.isArray(result))throw Error();return result;}
  catch {throw new ApiError('invalid_json',400);}
}
function failure(error,request){
  const code=error instanceof ApiError?error.code:'service_unavailable';
  const status=error instanceof ApiError?error.status:503;
  const messages={login_required:'Discordログインが必要です。',csrf_denied:'認証状態が変わりました。ページを再読み込みしてください。',origin_denied:'この画面からは操作できません。',rate_limited:'短時間に操作が集中しています。少し待ってからお試しください。',heavy_operations_paused:'この追加処理は確認中です。学習と回答保存はご利用いただけます。',signup_temporarily_closed:'現在は登録済みの生徒さんから順次再開しています。管理者にお問い合わせください。',media_capacity_unavailable:'画像容量の最新確認ができないため、新しい画像の保存を停止しています。学習は利用できます。',media_storage_limit:'画像保存の安全上限に達しました。学習は利用できます。',generation_daily_limit:'本日の追加処理の安全上限に達しました。翌朝9時以降にお試しください。学習は利用できます。',capture_daily_limit:'自動撮影の無料枠または短時間の撮影上限に達しました。自動再試行は行いません。手動画像を指定するか、時間をおいてお試しください。',capture_failed:'局面画像の自動撮影に失敗しました。手動画像を指定するか、時間をおいてお試しください。',naga_report_missing:'指定のNAGAレポートが見つかりません。',naga_report_unavailable:'NAGAレポートを取得できませんでした。URLと接続を確認してください。',collection_capacity_reached:'この巻は200問に達しています。次の巻を選択してください。'};
  Object.assign(messages,{
    media_upload_pending:'画像の処理を確認中です。しばらく待っても続く場合は管理者に連絡してください。',
    question_image_retired:'この画像は使用を終了しました。ページを再読み込みして、最新の問題を開き直してください。',
    collection_confirmation_required:'削除する前に確認画面で対象を確認してください。',
    collection_deletion_changed:'確認後に問題集の内容が変わりました。確認画面を閉じて、もう一度削除対象を確認してください。',
    collection_not_manageable:'この問題集の管理権限が必要です。',
    collection_owner_required:'この操作は問題集の作成者またはアプリ管理者だけが行えます。',
    invalid_manager_selection:'管理メンバーを20人以内で選択してください。',
    manager_account_unavailable:'選択したアカウントを確認できません。ユーザーを検索し直してください。',
    collection_owner_unchanged:'作成者の権限はここでは変更できません。',
    question_not_editable:'この問題の編集・整理権限がありません。',
    invalid_question_input:'問題名と参照URLを確認してください。',
    question_changed:'問題が更新されています。開き直してからお試しください。',
    invalid_collection_input:'問題集名は1〜120文字、説明は3000文字以内で入力してください。',
    collection_deletion_mixed_owners:'このシリーズには別の所有者の巻が含まれるため、まとめて削除できません。',
    collection_already_deleted:'この問題集はすでに削除されています。本棚へ戻って確認してください。',
    collection_deletion_too_large:'削除対象が多いため、一冊ずつ確認するか、管理者へご相談ください。'
  });
  const message=messages[code]||(status>=500?'接続を確認できませんでした。入力内容は消さずに、少し待ってから再度お試しください。':'操作を受け付けられませんでした。内容とアクセス権を確認してください。');
  if(request?.headers.get('Accept')?.includes('text/html')&&new URL(request.url).pathname.startsWith('/auth/')){
    const explanation=code==='oauth_state_invalid'?'ログインの有効時間が過ぎたか、認証が中断されました。入口からもう一度お試しください。':message;
    return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ログインの確認｜みん切る</title><link rel="icon" href="/icons/favicon-32.png"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#06131e;color:#f6ebcb;font-family:system-ui,sans-serif}main{max-width:34rem;margin:1rem;padding:2rem;background:#0c2a3a;border:1px solid #ad904e;border-radius:1rem}p{line-height:1.9}a{display:inline-block;padding:1rem;background:#f1c457;color:#06131e;border-radius:.5rem;font-weight:bold;text-decoration:none}</style><main><h1>ログインを確認してください</h1><p>${explanation}</p><a href="/">みん切るの入口へ</a></main></html>`,{status,headers:{...common,'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'no-referrer'}});
  }
  return json({error:code,message},status);
}
export default {
  async fetch(request,env={},ctx={}){
    try{
      const url=new URL(request.url);
      if(url.pathname==='/guide/video/minkiru-promo.mp4')return new Response(request.method==='HEAD'?null:'This video has been withdrawn.',{status:410,headers:common});
      if(url.pathname==='/health'&&request.method==='GET')return json({version:308,backend:'cloudflare',ready:ready(env),studentFlow:ready(env),signups:ready(env)&&env.SIGNUPS_ENABLED==='true',heavyOperations:generationEnabled(env),generation:generationEnabled(env),uploads:env.UPLOADS_ENABLED==='true',bulkImport:false,bot:env.DISCORD_SYNC_ENABLED==='true'&&!!env.DISCORD_SYNC_TOKEN});
      if(!ready(env))return json({error:'migration_not_ready',message:'移行確認中です。公開切替はまだ完了していません。'},503);
      if(url.origin!==env.APP_ORIGIN)throw new ApiError('origin_denied',403);
      if(url.pathname==='/naga-nanikiru'||url.pathname==='/naga-nanikiru/')return Response.redirect(url.origin+'/'+url.search,302);
      if(url.pathname.startsWith('/naga-nanikiru/')){url.pathname=url.pathname.slice('/naga-nanikiru'.length);return this.fetch(new Request(url,request),env,ctx);}
      if(url.pathname==='/runtime-config.js'&&request.method==='GET')return new Response('window.NAGA_RUNTIME_CONFIG=Object.freeze('+JSON.stringify({backend:'cloudflare',supabaseUrl:'https://akabzpfknwsdmabavcqz.supabase.co',mediaApiUrl:env.APP_ORIGIN,legacyMediaApiUrl:'https://minkiru-media.naga-study.workers.dev',mediaReadyBuckets:['naga-question-assets','comment-assets','reaction-assets'],heavyOperationsEnabled:generationEnabled(env),imageUploadsEnabled:env.UPLOADS_ENABLED==='true',bulkImportEnabled:false})+');',{headers:{...common,'Content-Type':'text/javascript; charset=utf-8'}});
      if(url.pathname==='/manifest.webmanifest'&&request.method==='GET'){
        const response=await env.ASSETS.fetch(new Request(url,request));const manifest=await response.json();manifest.id='/';manifest.start_url='/';manifest.scope='/';for(const icon of manifest.icons||[])icon.src=icon.src.replace('/naga-nanikiru/','/');return json(manifest);
      }
      if(url.pathname==='/auth/discord'&&request.method==='GET'){
        if(request.headers.get('Sec-Fetch-Site')==='cross-site'&&request.headers.get('Sec-Fetch-Mode')!=='navigate')throw new ApiError('origin_denied',403);
        await limited(env.AUTH_LIMIT,request.headers.get('CF-Connecting-IP')||'unknown');return await startDiscord(request,env);
      }
      if(url.pathname==='/auth/discord/callback'&&request.method==='GET')return await finishDiscord(request,env);
      if(url.pathname.startsWith('/v1/public/')&&['GET','HEAD'].includes(request.method))return await mediaRead(request,env,{actor:null})||json({error:'not_found'},404);
      if(url.pathname.startsWith('/api/bot/')){
        await authenticateDiscordBot(request,env);await limited(env.BOT_LIMIT,'discord-sync');
        const input=url.pathname==='/api/bot/assets'?{}:await jsonBody(request);
        const result=await discordSyncApi(request,env,input);
        return result instanceof Response?result:json(result);
      }
      if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/v1/')){
        const session=await sessionFor(request,env);
        if(url.pathname==='/api/session'&&request.method==='GET')return sessionResponse(session);
        const actor=requireActor(session?.actor);
        if(url.pathname==='/api/logout'&&request.method==='POST')return await endSession(request,env,session);
        if(url.pathname.startsWith('/v1/')){
          if(url.pathname==='/v1/assets'&&request.method==='POST'){
            await requireCsrf(request,env,session);await limited(env.WRITE_LIMIT,actor.id);
            return json(await imageUpload(request,env,actor));
          }
          if(request.method==='POST'&&['/v1/resolve-public','/v1/resolve'].includes(url.pathname)){
            await requireCsrf(request,env,session);return await mediaRead(request,env,{actor,body:await jsonBody(request,32768)});
          }
          if(['GET','HEAD'].includes(request.method))return await mediaRead(request,env,{actor})||json({error:'not_found'},404);
          throw new ApiError('heavy_operations_paused',503);
        }
        if(request.method!=='POST')throw new ApiError('method_not_allowed',405);
        await requireCsrf(request,env,session);
        const args=await jsonBody(request),context={db:env.DB,actor,origin:env.APP_ORIGIN};
        if(['/api/functions/naga-report','/api/functions/naga-capture'].includes(url.pathname)){
          await limited(env.GENERATION_LIMIT,actor.id);
          const response=await generationApi(url.pathname.split('/').at(-1),args,env,actor);
          const headers=new Headers(response.headers);for(const [key,value] of Object.entries(common))headers.set(key,value);
          return new Response(response.body,{status:response.status,headers});
        }
        const rpc=url.pathname.match(/^\/api\/rpc\/([a-z_]+)$/);
        if(rpc){
          const name=rpc[1];
          if(MANAGER_READ_RPCS.has(name)||MANAGER_WRITE_RPCS.has(name)){
            await limited(env.WRITE_LIMIT,actor.id);
            return json({data:await managerRpc(name,args,context)});
          }
          if(QUESTION_MANAGEMENT_RPCS.has(name)){
            await limited(env.WRITE_LIMIT,actor.id);
            return json({data:await questionManagementRpc(name,args,context)});
          }
          if(name==='preview_collection_deletion')return json({data:await previewCollectionDeletion(args,context)});
          if(name==='delete_collection'){await limited(env.WRITE_LIMIT,actor.id);return json({data:await deleteCollection(args,context)});}
          if(name==='get_collection_capacity')return json({data:await collectionCapacity(args,context)});
          if(builderNames.has(name)&&env.COLLECTION_BUILDER_ENABLED==='true'){await limited(env.WRITE_LIMIT,actor.id);return json({data:await builderRpc(name,args,context)});}
          if(readNames.has(name))return json({data:await readRpc(name,args,context)});
          if(writeNames.has(name)){await limited(env.WRITE_LIMIT,actor.id);return json({data:await writeRpc(name,args,context)});}
          throw new ApiError('heavy_operations_paused',503);
        }
        const table=url.pathname.match(/^\/api\/table\/([a-z_]+)$/);
        if(table){
          if(args.operation==='upsert'&&table[1]==='answer_attempts')throw new ApiError('heavy_operations_paused',503);
          if(args.operation==='upsert'&&['profiles','answer_attempts'].includes(table[1])){await limited(env.WRITE_LIMIT,actor.id);return json({data:await writeTable(table[1],args.rows,context)});}
          if(args.operation)throw new ApiError('operation_not_allowed',403);
          if(!['questions','answer_attempts','student_learning_summary','workspace_members'].includes(table[1]))throw new ApiError('table_not_allowed',403);
          return json({data:await readTable(table[1],args,context)});
        }
        return json({error:'not_found'},404);
      }
      if(['GET','HEAD'].includes(request.method)&&env.ASSETS){
        const response=/^\/guide\/video\/[^/]+\.mp4$/.test(url.pathname)?await guideVideo(request,env.ASSETS):await env.ASSETS.fetch(request);const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');headers.set('X-Frame-Options','DENY');
        if(headers.get('Content-Type')?.includes('text/html'))headers.set('Cache-Control','no-cache');
        return new Response(response.body,{status:response.status,headers});
      }
      return json({error:'not_found'},404);
    }catch(error){return failure(error,request);}
  },
  async scheduled(event,env,ctx){ctx.waitUntil(reconcileMediaBudget(env));},
};
