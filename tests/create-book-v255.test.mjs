import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const source=name=>html.match(new RegExp(`^      (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^      \\}`,'m'))?.[0];
test('the optional creation control sits beside the destination, with one native dialog and no nested forms',()=>{
  const destination=source('renderGeneratorDestinationV130');
  assert.match(destination,/generator-destination-choice-v255[^]*generatorDestinationSelect[^]*bookCreateOpenV255/);
  assert.match(destination,/\$\{renderCreateHubV235\(\)\}/);
  assert.doesNotMatch(html,/renderGeneratorViewV44\(\) \+ renderCreateHubV235/);
  assert.match(source('renderCreateHubV235'),/<dialog[^]*aria-labelledby="bookCreateHeadingV255"/);
  assert.match(source('renderCreateHubV235'),/collectionCreateFormMarkupV106\("bookCreateV235"\)/);
  assert.match(source('renderGeneratorViewV44'),/destinationMarkup\}<form class="generator-form/);
  assert.match(source('collectionCreateFormMarkupV106'),/value="private" selected/);
});
test('the native modal opens, restores focus on close and can retain its draft on re-render',()=>{
  const listeners={};let focused='',remembers=0;
  const dialog={open:false,addEventListener:(type,fn)=>listeners[type]=fn,showModal(){this.open=true;},close(){this.open=false;listeners.close();}};
  const opener={isConnected:true,addEventListener:(_,fn)=>listeners.open=fn,focus(){focused='opener';}};
  const ids={bookCreateDetailsV235:dialog,bookCreateOpenV255:opener,bookCreateCloseV255:{addEventListener:(_,fn)=>listeners.dismiss=fn},bookCreateV235Title:{focus(){focused='title';}}};
  const c=vm.createContext({bookCreateDraftV235:null,document:{getElementById:id=>ids[id]}});vm.runInContext(source('bindBookCreateDialogV255'),c);
  c.bindBookCreateDialogV255(()=>remembers++);assert.equal(dialog.open,false);
  listeners.open();assert.equal(dialog.open,true);assert.equal(focused,'title');
  listeners.dismiss();assert.equal(dialog.open,false);assert.equal(focused,'opener');assert.equal(remembers,2);
  c.bookCreateDraftV235={open:true};c.bindBookCreateDialogV255(()=>remembers++);assert.equal(dialog.open,true);
});
test('new destination is set in the actual select before generator draft is persisted',()=>{
  const bind=source('bindCollectionCreateFormV106');
  const start=bind.indexOf('generatorDestinationV130 = shareSlug');
  assert.ok(start>0);
  const created=bind.slice(start);
  assert.ok(created.indexOf('destinationSelect.value = shareSlug')<created.indexOf('persistGeneratorFormDraftV157()'));
  assert.match(created,/destinationSelect.innerHTML = generatorDestinationOptionsV130\(\)/);
  assert.match(bind,/bookTone, requestId:form.dataset.requestId/);
  assert.match(bind,/visibility !== "private" && !window.confirm/);
  assert.doesNotMatch(created,/generatorCandidatesV44\s*=\s*\[\]|generatorSelectedV46.*clear/);
});
