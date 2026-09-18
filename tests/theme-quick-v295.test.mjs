import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../public/theme-quick-v295.js',import.meta.url),'utf8');
function controls(){
  let current='dark',listener,observer;const writes=[];
  const buttons=['dark','light'].map(value=>({dataset:{themeChoice:value},setAttribute(k,v){this[k]=v},closest(){return this}}));
  const group={querySelectorAll:()=>buttons,contains:b=>buttons.includes(b),addEventListener:(_,f)=>listener=f};
  const api={current:()=>current,set(value){current=value;writes.push(value);return true}};
  vm.runInNewContext(code,{window:{MinkiruThemeV259:api},document:{readyState:'complete',documentElement:{},getElementById:id=>id==='themeQuickV295'?group:null},MutationObserver:class{constructor(f){observer=f}observe(){}}});
  return {buttons,writes,click:b=>listener({target:b}),external(value){current=value;observer()},current:()=>current};
}
test('the quick switch applies the existing preference and reflects external settings changes',()=>{
  const c=controls();assert.equal(c.buttons[0]['aria-pressed'],'true');c.click(c.buttons[1]);assert.deepEqual(c.writes,['light']);assert.equal(c.current(),'light');assert.equal(c.buttons[1]['aria-pressed'],'true');assert.equal(c.buttons[0]['aria-pressed'],'false');
  c.external('dark');assert.equal(c.buttons[0]['aria-pressed'],'true');assert.deepEqual(c.writes,['light']);
});
test('clicks outside either choice cannot change the preference',()=>{const c=controls();c.click({closest:()=>null});assert.deepEqual(c.writes,[])});
