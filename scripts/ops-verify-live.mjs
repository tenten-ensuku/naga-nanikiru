// Operator-only aggregate checks. No user records, images, or credentials are exported.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {root,cli} from './ops-admin.mjs';
import {snapshot} from '../ops/worker.mjs';
const target=path.join(root,'outputs/ops-v1');
if(process.argv[2]==='public'){
 const probes=[];
 for(const path of ['/','/dashboard.js','/api/latest','/api/history']){
   const response=await fetch('https://ensuku-ops.naga-study.workers.dev'+path,{redirect:'manual'});
   probes.push({path,status:response.status});await response.arrayBuffer();
   if(![302,403].includes(response.status))throw new Error('Owner-only boundary not confirmed');
 }
 for(const project of ['akabzpfknwsdmabavcqz','kclkzevcgpfbavegwbnf']){
  const response=await fetch('https://'+project+'.supabase.co/functions/v1/ops-capacity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'snapshot'})});
  probes.push({project,status:response.status});await response.arrayBuffer();if(response.status!==403)throw new Error('Aggregate API must deny missing custom authentication');
 }
 console.log(JSON.stringify({unauthenticatedProbes:probes}));
}
if(process.argv[2]==='snapshot'){
 const raw=await cli(['r2','object','get','ensuku-ops-data/state.json','--remote','--pipe']);
 const state=JSON.parse(raw.trim());const latest=snapshot(state,Date.now());
 await fs.mkdir(target,{recursive:true});
 await fs.writeFile(path.join(target,'latest.json'),JSON.stringify(latest,null,2));
 const context={console,URL,Intl};context.globalThis=context;
 vm.runInNewContext(await fs.readFile(path.join(root,'ops/public/dashboard.js'),'utf8'),context);
 await fs.writeFile(path.join(target,'capacity-current.html'),context.OpsDashboard.createExportHtml(latest,{daily:[],recent:[]}));
 console.log(JSON.stringify({generatedAt:latest.generatedAt,mode:latest.control.mode,successfulTicks:state.successfulTicks,sources:latest.sources,totals:latest.metrics.filter(x=>['supabase-storage','supabase-database','r2-storage'].includes(x.id)).map(x=>({id:x.id,used:x.used})),r2Reconciliation:state.raw.r2?.value,setup:state.events.filter(x=>x.message.includes('接続確認')).map(x=>({at:x.at,delivery:x.delivery})),html:path.join(target,'capacity-current.html')},null,2));
}
