// Operator-only. Credentials are loaded in memory, never printed or placed in artifacts.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
export const root=fileURLToPath(new URL('../',import.meta.url));
export const ACCOUNT='e5b748838ea561070abc576dea21577d';
export function parseEnv(text){return Object.fromEntries(text.split(/\r?\n/).filter(x=>/^[A-Z][A-Z0-9_]*=/.test(x)).map(x=>{let [k,...p]=x.split('=');let v=p.join('=').trim();if(/^(['"]).*\1$/.test(v))v=v.slice(1,-1);return[k,v];}));}
export async function loadSecrets(){
  const bot=parseEnv(await fs.readFile(path.resolve(root,'../../outputs/naga-thread-bot/.env'),'utf8'));
  const local=parseEnv(await fs.readFile(path.join(root,'.env.ops'),'utf8').catch(()=>''));
  return {...bot,...local};
}
export async function cli(args,input){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='';child.stdout.on('data',b=>out+=b);child.stderr.resume();child.once('error',()=>reject(new Error('CLI launch failed')));child.once('close',code=>code?reject(new Error('CLI failed: '+code)):resolve(out));child.stdin.end(input);
});}
async function oauth(){const file=path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml');const text=await fs.readFile(file,'utf8');return text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];}
export async function cfApi(route,{body,method='GET',token}={}){
  const bearer=token||await oauth();if(!bearer)throw new Error('Cloudflare CLI login required');
  const r=await fetch('https://api.cloudflare.com/client/v4'+route,{method,headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=await r.json().catch(()=>null);return{status:r.status,data};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='prepare-monitor'){
    const config=JSON.parse(await fs.readFile(path.join(root,'wrangler.ops.jsonc'),'utf8'));
    if(config.name!=='ensuku-ops'||config.account_id!==ACCOUNT||config.vars.COLLECTOR_ENABLED!=='false')throw new Error('Expected inactive owner-only ops Worker');
    const existing=JSON.parse((await cli(['secret','list','--config','wrangler.ops.jsonc'])).trim()).map(x=>x.name);
    if(existing.includes('OPS_MONITOR_TOKEN'))throw new Error('Monitor token already installed; refusing to rotate it');
    const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');
    await cli(['secret','bulk','--config','wrangler.ops.jsonc'],JSON.stringify({OPS_MONITOR_TOKEN:token}));
    console.log(JSON.stringify({worker:'ensuku-ops',installed:'OPS_MONITOR_TOKEN',verifierSha256:hash,secretLogged:false}));
  }
  if(process.argv[2]==='install-optional-secrets'){
    const available=await loadSecrets();
    const existing=JSON.parse((await cli(['secret','list','--config','wrangler.ops.jsonc'])).trim()).map(x=>x.name);
    const values=Object.fromEntries(['DISCORD_BOT_TOKEN','CF_ANALYTICS_TOKEN'].filter(x=>available[x]&&!existing.includes(x)).map(x=>[x,available[x]]));
    if(Object.keys(values).length)await cli(['secret','bulk','--config','wrangler.ops.jsonc'],JSON.stringify(values));
    console.log(JSON.stringify({installedNames:Object.keys(values),missingNames:['DISCORD_BOT_TOKEN','CF_ANALYTICS_TOKEN'].filter(x=>!available[x]&&!existing.includes(x)),secretLogged:false}));
  }
  if(process.argv[2]==='capabilities'){
    for(const route of ['/accounts/'+ACCOUNT+'/access/apps','/user/tokens','/accounts/'+ACCOUNT+'/r2/buckets']){
      const r=await cfApi(route);console.log(JSON.stringify({route,status:r.status,success:r.data?.success,errorCodes:r.data?.errors?.map(e=>e.code)}));
    }
    const r=await cfApi('/graphql',{method:'POST',body:{query:'query { viewer { accounts(filter: {accountTag: "'+ACCOUNT+'"}) { __typename } } }'}});
    console.log(JSON.stringify({graphqlStatus:r.status,graphqlErrors:r.data?.errors?.map(x=>x.message),graphqlData:!!r.data?.data}));
  }
}
