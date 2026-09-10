import {ApiError} from './access.mjs';

const SESSION='__Host-minkiru_session',CSRF='__Host-minkiru_csrf',STATE='__Host-minkiru_oauth';
const TEN_MINUTES=600,SESSION_SECONDS=7*24*3600;
export const authCookieNames=Object.freeze({session:SESSION,csrf:CSRF,state:STATE});
export function randomToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');}
export async function sha256(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function cookie(request,name){
  const matches=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
  // Duplicate security cookies are ambiguous; fail closed.
  return matches.length===1?matches[0].slice(name.length+1):'';
}
const validToken=t=>/^[a-f0-9]{64}$/.test(t);
function setCookie(headers,name,value,maxAge,httpOnly=true){headers.append('Set-Cookie',`${name}=${value}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAge}${httpOnly?'; HttpOnly':''}`);}
function privateHeaders(){return new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});}
export function safeReturnPath(value){
  if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value.startsWith('//')||/[\\\r\n\u0000]/.test(value))return '/';
  try{
    const parsed=new URL(value,'https://return.invalid');
    if(parsed.origin!=='https://return.invalid'||parsed.pathname.startsWith('/auth/'))return '/';
    for(const key of ['code','state','error','error_description','access_token','refresh_token'])parsed.searchParams.delete(key);
    return parsed.pathname+parsed.search;
  }catch{return '/';}
}
function originOf(env){
  const url=new URL(env.APP_ORIGIN||'https://unconfigured.invalid');
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.hostname==='unconfigured.invalid')throw new ApiError('auth_not_configured',503);
  return url.origin;
}
function requireOrigin(request,env){if(request.headers.get('Origin')!==originOf(env))throw new ApiError('origin_denied',403);}
function requireOAuth(env){
  originOf(env);
  if(!/^\d{15,22}$/.test(env.DISCORD_CLIENT_ID||'')||!env.DISCORD_CLIENT_SECRET)throw new ApiError('auth_not_configured',503);
}
export async function sessionFor(request,env,{now=Date.now()}={}){
  const token=cookie(request,SESSION);if(!validToken(token))return null;
  const tokenHash=await sha256(token);
  const row=await env.DB.prepare(`SELECT s.token_hash,s.csrf_hash,s.expires_at,i.user_id,i.discord_user_id,i.is_admin,p.display_name,p.avatar_url
    FROM auth_sessions s JOIN auth_identities i ON i.user_id=s.user_id JOIN profiles p ON p.id=i.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND i.disabled=0`).bind(tokenHash,Math.floor(now/1000)).first();
  if(!row)return null;
  return {tokenHash,csrfHash:row.csrf_hash,expiresAt:row.expires_at,
    actor:{id:row.user_id,is_admin:row.is_admin===1,discord_user_id:row.discord_user_id,display_name:row.display_name,avatar_url:row.avatar_url}};
}
export async function requireCsrf(request,env,session){
  requireOrigin(request,env);
  if(!session)throw new ApiError('login_required',401);
  const token=request.headers.get('X-Minkiru-CSRF')||'';
  if(!validToken(token)||await sha256(token)!==session.csrfHash)throw new ApiError('csrf_denied',403);
}
export function sessionResponse(session){
  return Response.json({session:session?{expires_at:session.expiresAt,user:{id:session.actor.id,
    app_metadata:{is_admin:session.actor.is_admin,provider:'discord'},
    user_metadata:{full_name:session.actor.display_name,avatar_url:session.actor.avatar_url}}}:null},{headers:privateHeaders()});
}
export async function startDiscord(request,env,{now=Date.now()}={}){
  requireOAuth(env);
  const state=randomToken(),binding=randomToken(),expires=Math.floor(now/1000)+TEN_MINUTES;
  const redirect=safeReturnPath(new URL(request.url).searchParams.get('returnTo'));
  await env.DB.prepare('INSERT INTO oauth_states(state_hash,verifier,redirect_path,expires_at) VALUES (?,?,?,?)')
    .bind(await sha256(state),await sha256(binding),redirect,expires).run();
  const auth=new URL('https://discord.com/oauth2/authorize');
  auth.search=new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,response_type:'code',scope:'identify',state,redirect_uri:originOf(env)+'/auth/discord/callback'}).toString();
  const headers=privateHeaders();headers.set('Location',auth.toString());setCookie(headers,STATE,binding,TEN_MINUTES);
  return new Response(null,{status:302,headers});
}
async function discordIdentity(code,env,fetchImpl){
  const response=await fetchImpl('https://discord.com/api/oauth2/token',{method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:AbortSignal.timeout(15000),
    body:new URLSearchParams({grant_type:'authorization_code',code,client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,redirect_uri:originOf(env)+'/auth/discord/callback'})});
  if(!response.ok)throw new ApiError('discord_login_failed',502);
  const token=await response.json();if(typeof token.access_token!=='string'||token.token_type?.toLowerCase()!=='bearer')throw new ApiError('discord_login_failed',502);
  const userResponse=await fetchImpl('https://discord.com/api/users/@me',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
  if(!userResponse.ok)throw new ApiError('discord_login_failed',502);
  const user=await userResponse.json();if(!/^\d{15,22}$/.test(user.id||''))throw new ApiError('discord_identity_invalid',502);
  // Access/refresh tokens and email are deliberately not stored.
  return {id:user.id,name:Array.from(String(user.global_name||user.username||'プレイヤー')).slice(0,80).join(''),
    avatar:/^(a_)?[a-f0-9]{32}$/.test(user.avatar||'')?`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`:null};
}
export async function finishDiscord(request,env,{now=Date.now(),fetchImpl=fetch}={}){
  requireOAuth(env);
  const url=new URL(request.url),state=url.searchParams.get('state')||'',binding=cookie(request,STATE),code=url.searchParams.get('code')||'';
  if(!validToken(state)||!validToken(binding)||!code||code.length>2048||url.searchParams.has('error'))throw new ApiError('oauth_state_invalid',400);
  // Atomic consumption, bound to the initiating browser. Failed validation does not consume another browser's state.
  const stored=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND verifier=? AND expires_at>? RETURNING redirect_path')
    .bind(await sha256(state),await sha256(binding),Math.floor(now/1000)).first();
  if(!stored)throw new ApiError('oauth_state_invalid',400);
  const discord=await discordIdentity(code,env,fetchImpl);
  let identity=await env.DB.prepare('SELECT user_id,disabled FROM auth_identities WHERE discord_user_id=?').bind(discord.id).first();
  if(!identity){
    if(env.SIGNUPS_ENABLED!=='true')throw new ApiError('signup_temporarily_closed',403);
    const id=crypto.randomUUID();
    try{
      await env.DB.batch([
        env.DB.prepare('INSERT INTO profiles(id,display_name,discord_user_id,avatar_url) VALUES (?,?,?,?)').bind(id,discord.name,discord.id,discord.avatar),
        env.DB.prepare('INSERT INTO auth_identities(user_id,discord_user_id) VALUES (?,?)').bind(id,discord.id),
        env.DB.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,status) SELECT id,?,'student','active' FROM workspaces WHERE name='NAGA問題集' AND owner_id<>?").bind(id,id),
      ]);
      identity={user_id:id,disabled:0};
    }catch(error){
      // A second callback may have created this same verified Discord identity concurrently.
      identity=await env.DB.prepare('SELECT user_id,disabled FROM auth_identities WHERE discord_user_id=?').bind(discord.id).first();
      if(!identity)throw error;
    }
  }
  if(identity.disabled)throw new ApiError('account_disabled',403);
  const token=randomToken(),csrf=randomToken(),seconds=Math.floor(now/1000);
  await env.DB.prepare('INSERT INTO auth_sessions(token_hash,user_id,csrf_hash,expires_at,created_at) VALUES (?,?,?,?,?)')
    .bind(await sha256(token),identity.user_id,await sha256(csrf),seconds+SESSION_SECONDS,seconds).run();
  const headers=privateHeaders();headers.set('Location',originOf(env)+safeReturnPath(stored.redirect_path));
  setCookie(headers,STATE,'',0);setCookie(headers,SESSION,token,SESSION_SECONDS);setCookie(headers,CSRF,csrf,SESSION_SECONDS,false);
  return new Response(null,{status:303,headers});
}
export async function endSession(request,env,session){
  await requireCsrf(request,env,session);
  await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(session.tokenHash).run();
  const headers=privateHeaders();setCookie(headers,SESSION,'',0);setCookie(headers,CSRF,'',0,false);
  return Response.json({ok:true},{headers});
}
