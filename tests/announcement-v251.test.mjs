import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const html=read('public/index.html'),js=read('public/menu-sections-v239.js'),css=read('public/menu-sections-v239.css');

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
