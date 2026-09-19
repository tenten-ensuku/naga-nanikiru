import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../public/theme-quick-v295.js',import.meta.url),'utf8');
function control(saved=true){
  let current='dark',listener,observer;const writes=[];
  const button={setAttribute(k,v){this[k]=v},addEventListener:(_,f)=>listener=f};
  const status={textContent:''};
  const api={current:()=>current,set(value){current=value;writes.push(value);return saved}};
  vm.runInNewContext(code,{window:{MinkiruThemeV259:api},document:{readyState:'complete',documentElement:{},getElementById:id=>id==='themeQuickV295'?button:status},MutationObserver:class{constructor(f){observer=f}observe(){}}});
  return {button,status,writes,click:()=>listener(),external(value){current=value;observer()},current:()=>current};
}
test('the icon button toggles the saved preference and describes its next action',()=>{
  const c=control();assert.equal(c.button['aria-label'],'ライトモードに切り替える');
  c.click();assert.equal(c.current(),'light');assert.equal(c.button['aria-label'],'ダークモードに切り替える');
  c.click();assert.equal(c.current(),'dark');assert.deepEqual(c.writes,['light','dark']);
  c.external('light');assert.equal(c.button.title,'ダークモードに切り替える');assert.deepEqual(c.writes,['light','dark']);
});
test('a blocked preference store still changes the theme and announces the persistence limitation',()=>{
  const c=control(false);c.click();assert.equal(c.current(),'light');assert.match(c.status.textContent,/保存できません/);
});
