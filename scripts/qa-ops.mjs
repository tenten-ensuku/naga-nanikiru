// Ephemeral local browser and fixture API. Never opens real accounts or contacts production.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {root} from './ops-admin.mjs';
import {initialState,snapshot} from '../ops/worker.mjs';
const modules=process.env.PLAYWRIGHT_MODULES;if(!modules)throw Error('PLAYWRIGHT_MODULES required');
const {chromium}=createRequire(path.join(modules,'package.json'))('playwright');
const out=path.join(root,'outputs/ops-v1');await fs.mkdir(out,{recursive:true});
let latest=JSON.parse(await fs.readFile(path.join(out,'latest.json'),'utf8').catch(()=>JSON.stringify(snapshot(initialState(Date.now()),Date.now()))));
let posts=[],exportedHtml='';const requests=[],errors=[];
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/api/latest'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(latest));return;}
 if(url.pathname==='/api/history'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({daily:[{at:latest.generatedAt,storageBytes:latest.metrics[0].used,databaseBytes:latest.metrics[1].used,r2Bytes:latest.metrics[2].used}],recent:[]}));return;}
 if(url.pathname==='/export.html'){res.setHeader('Content-Type','text/html');res.end(exportedHtml);return;}
 if(['/api/egress','/api/resume'].includes(url.pathname)&&req.method==='POST'){let body='';for await(const part of req)body+=part;posts.push({path:url.pathname,body:JSON.parse(body)});res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;}
 const files={'/':'index.html','/style.css':'style.css','/dashboard.js':'dashboard.js'};const file=files[url.pathname];
 if(!file){res.writeHead(404).end();return;}
 const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';res.setHeader('Content-Type',type);res.end(await fs.readFile(path.join(root,'ops/public',file)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
const results=[];
try{
 for(const width of [320,390,509,1100,1440]){
  const context=await browser.newContext({viewport:{width,height:950},acceptDownloads:true});
  await context.route('**/*',route=>{
    if(new URL(route.request().url()).origin!==origin){requests.push(route.request().url());return route.abort();}
    return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.getByRole('heading',{name:'保存先の現在値'}).waitFor();
  const layout=await page.evaluate(()=>({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,charts:document.querySelectorAll('[data-resource-id]').length,overflow:[...document.querySelectorAll('button,input,.resource-card')].filter(x=>{const r=x.getBoundingClientRect();return r.right>innerWidth+1||r.left< -1;}).length}));
  await page.screenshot({path:path.join(out,'dashboard-'+width+'.png'),fullPage:width===1440});
  if(width===1440)await page.screenshot({path:path.join(out,'dashboard-1440-top.png')});
  if(layout.scrollWidth>width+1)console.log(JSON.stringify({layout,containers:await page.evaluate(()=>[...document.querySelectorAll('body,.ops-root,.ops-shell,.ops-main,.panel,.table-wrap,.trend-frame,.trend-svg')].map(x=>({tag:x.tagName,class:x.className,width:x.clientWidth,scroll:x.scrollWidth,left:x.getBoundingClientRect().left,overflow:getComputedStyle(x).overflowX})).filter(x=>x.scroll>x.width+1))}));
  if(layout.scrollWidth>width+1)console.log(JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(x=>{const r=x.getBoundingClientRect();return r.right>innerWidth+1&&getComputedStyle(x).position!=='absolute';}).slice(0,20).map(x=>({tag:x.tagName,class:x.className,right:x.getBoundingClientRect().right,text:x.textContent.slice(0,70)})))));
  assert.equal(layout.charts,3);assert.ok(layout.scrollWidth<=width+1,'horizontal page overflow at '+width);assert.equal(layout.overflow,0,'offscreen controls at '+width);
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'HTMLで保存',exact:true}).click();const download=await downloadEvent;
  const file=path.join(out,'export-'+width+'.html');await download.saveAs(file);
  const exported=await fs.readFile(file,'utf8');assert.doesNotMatch(exported,/\/api\/(?:latest|history|egress|resume)|fetch\s*\(/);assert.match(exported,/Ensuku Ops v1/);
  exportedHtml=exported;
  const exportPage=await context.newPage();await exportPage.goto(origin+'/export.html');
  assert.ok(await exportPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'export horizontal overflow at '+width);
  assert.equal(await exportPage.locator('form').count(),0);await exportPage.close();
  const critical=await page.evaluate(()=>{
    const root=document.querySelector('#dashboard-root'),before=root.innerHTML;
    const snap=window.OpsDashboard.createUnknownSnapshot();snap.control={mode:'blocked',blocked:true,reasons:['容量の確認が24時間できていません。追加処理のみ制限します。'],canResume:false};
    root.innerHTML=window.OpsDashboard.renderDashboardMarkup(snap,{daily:[],recent:[]});
    const width=document.documentElement.scrollWidth;root.innerHTML=before;return width;
  });
  assert.ok(critical<=width+1,'blocked/unknown page overflow at '+width);
  await page.reload();await page.getByRole('heading',{name:'保存先の現在値'}).waitFor();
  if(width===1440){
    await page.locator('[name=periodStart]').fill('2026-09-06');await page.locator('[name=periodEnd]').fill('2026-10-06');await page.locator('[name=confirmedAt]').fill('2026-09-07T20:00');await page.locator('[name=uncachedBytes]').fill('8000000');await page.locator('[name=cachedBytes]').fill('0');
    await page.getByRole('button',{name:'最新を再読込',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-action=refresh]').disabled);
    assert.equal(await page.locator('[name=uncachedBytes]').inputValue(),'8000000','manual refresh preserves the owner draft');
    await page.getByRole('button',{name:'確認値を保存',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#write-status')?.textContent.includes('保存'));
    assert.ok(posts.some(x=>x.path==='/api/egress'&&x.body.uncachedBytes===8000000));
  }
  results.push(layout);await context.close();
 }
 assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({viewports:results,externalRequests:0,pageErrors:0,fixtureWrites:posts.length,fixtureOnly:true}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
