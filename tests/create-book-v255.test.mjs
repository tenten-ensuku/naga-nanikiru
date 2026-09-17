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
  const dialog={open:false,closest:()=>null,addEventListener:(type,fn)=>listeners[type]=fn,showModal(){this.open=true;},close(){this.open=false;listeners.close();}};
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
test('both bookshelf layouts open creation instead of navigating to personal settings',()=>{
  const library=fs.readFileSync(new URL('../public/library-v214.js',import.meta.url),'utf8');
  for(const markup of [library,source('renderCollectionChooserLegacyV165')]) {
    assert.match(markup,/<button[^>]*collection-chooser-create[^>]*data-open-book-create[^>]*aria-haspopup="dialog"/);
    assert.doesNotMatch(markup,/<button[^>]*collection-chooser-create[^>]*data-menu-jump="settings"/);
  }
  assert.match(html,/event\.target\.closest\("\[data-open-book-create\]"\)[^]*?openBookCreateV269\(\);\s*return;/);
});
test('bookshelf creation opens the existing modal with its draft and leaves generation candidates intact',()=>{
  const listeners={};let focused='',route;
  const draft={Title:'途中の問題集',Tone:'teal',Visibility:'private',requestId:'same-request',open:false};
  const candidates=[{id:'keep-candidate'}];
  const disclosure={open:false};
  const dialog={open:false,closest:()=>disclosure,showModal(){assert.equal(disclosure.open,true);this.open=true;},addEventListener(type,fn){listeners[type]=fn;}};
  const opener={isConnected:true,addEventListener(type,fn){listeners.open=fn;}};
  const ids={bookCreateDetailsV235:dialog,bookCreateOpenV255:opener,bookCreateCloseV255:{addEventListener(){}},bookCreateV235Title:{focus(){focused='title';}}};
  const c=vm.createContext({bookCreateDraftV235:draft,generatorCandidatesV44:candidates,requireLoginForPlayV187:()=>true,document:{getElementById:id=>ids[id]}});
  c.showMenuV16=(view,options)=>{route={view,...options};c.bindBookCreateDialogV255(()=>{});};
  vm.runInContext(source('bindBookCreateDialogV255')+'\n'+source('openBookCreateV269'),c);
  assert.equal(c.openBookCreateV269(),true);
  assert.deepEqual(route,{view:'generator',restorePosition:false});
  assert.equal(dialog.open,true);assert.equal(focused,'title');
  for(const field of ['Title','Tone','Visibility','requestId'])assert.equal(c.bookCreateDraftV235[field],draft[field]);
  assert.equal(c.generatorCandidatesV44,candidates);
});
test('bookshelf creation requires login before opening or altering a saved draft',()=>{
  const draft={Title:'保持',open:false};let navigated=false;
  const c=vm.createContext({bookCreateDraftV235:draft,requireLoginForPlayV187:()=>false,showMenuV16(){navigated=true;}});
  vm.runInContext(source('openBookCreateV269'),c);
  assert.equal(c.openBookCreateV269(),false);assert.equal(navigated,false);assert.equal(c.bookCreateDraftV235,draft);
});
