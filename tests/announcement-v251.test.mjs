import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const html=read('public/index.html'),js=read('public/menu-sections-v239.js'),css=read('public/menu-sections-v239.css');

const announcementSource=html.match(/const APP_ANNOUNCEMENTS_V66 = (\[[\s\S]*?\n\s*\]);/)[1];
const announcements=vm.runInNewContext(announcementSource);
const appVersion=Number(html.match(/const APP_VERSION = (\d+)/)[1]);

test('release announcements include the current version and every release since V300 without duplicates',()=>{
 const versions=announcements.map(item=>item.version);
 assert.equal(Math.max(...versions),appVersion,'Update the announcements when releasing a new app version');
 assert.equal(new Set(versions).size,versions.length,'Each version must have exactly one announcement');
 for(let version=300;version<=appVersion;version++){
  const item=announcements.find(item=>item.version===version);
  assert.ok(item,`Missing announcement for V${version}`);
  assert.ok(item.title.trim().length>=5 && item.body.trim().length>=20,`Describe the user-facing change for V${version}`);
  assert.match(item.date,/^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isFinite(Date.parse(item.publishedAt || item.date)));
 }
});

test('opening announcements renders newest first, keeps V300, and acknowledges the latest version',()=>{
 const list={innerHTML:''};let seen='300',shown=false;
 const document={getElementById:id=>id==='announcementList'?list:{showModal(){shown=true;}}};
 const ctx=vm.createContext({document,window:{localStorage:{setItem(key,value){assert.equal(key,'seen');seen=value;}}},
  ANNOUNCEMENT_SEEN_STORAGE_KEY_V65:'seen',APP_ANNOUNCEMENTS_V66:announcements,
  escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;'),formatAnnouncementDateV111:item=>item.date,renderNotificationBadgesV65(){}});
 for(const name of ['renderAnnouncementListV65','openAnnouncementDialogV65']){
  vm.runInContext(html.match(new RegExp(`      function ${name}\\([^]*?\\n      \\}`))[0],ctx);
 }
 ctx.openAnnouncementDialogV65();
 const rendered=[...list.innerHTML.matchAll(/notice-item-question">V(\d+)/g)].map(match=>Number(match[1]));
 assert.deepEqual(rendered,[...rendered].sort((a,b)=>b-a));
 assert.equal(rendered[0],appVersion);assert.ok(rendered.includes(300));
 assert.equal(seen,String(appVersion));assert.equal(shown,true);
});

test('announcement uses explicit visible copy and a self-contained matching line icon',()=>{
 const button=html.match(/<button[^>]*id="announcementButton"[^]*?<\/button>/)?.[0];
 assert.match(button,/aria-label="アナウンスを開く"/);
 assert.match(button,/title="運営からのアナウンスを見る"/);
 assert.match(button,/>アナウンス<\/span>/);
 assert.doesNotMatch(button,/>更新<|📣|🔄|arrow-path|<img|<image|<use|https?:\/\/(?!www.w3.org)/);
 assert.match(button,/announcement-icon-v251/);
 assert.match(button,/stroke="currentColor" stroke-width="1.5"/);
 assert.match(button,/aria-hidden="true" focusable="false"/);
 const ctx=vm.createContext({window:{}});vm.runInContext(js,ctx);
 assert.match(ctx.window.MinkiruMenuV239.icon('bell'),/stroke-width="1.5"/);
 assert.doesNotMatch(js,/\['#announcementButton .menu-notice-icon'/,'menu binding must not restore the refresh icon');
});

test('announcement retains its unread state and existing modal action, without reload behavior',()=>{
 assert.match(html,/id="announcementBadge" hidden/);
 assert.match(html,/getElementById\("announcementButton"\).addEventListener\("click", openAnnouncementDialogV65\)/);
 const handler=html.match(/      function openAnnouncementDialogV65\([^]*?\n      \}/)?.[0];
 assert.match(handler,/getElementById\("announcementDialog"\)\?\.showModal\(\)/);
 assert.match(handler,/ANNOUNCEMENT_SEEN_STORAGE_KEY_V65/);
 assert.doesNotMatch(handler,/location.reload|fetch\(/);
 assert.match(css,/#announcementButton .menu-notice-label \{\s*display: inline;/);
 assert.match(css,/#announcementButton \{[^]*?min-height: 44px;/);
 assert.match(css,/#announcementButton .menu-notice-icon \{\s*color: var\(--menu-gold-v239/);
});
