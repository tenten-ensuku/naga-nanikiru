import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../public/guide/video-format-v295.js',import.meta.url),'utf8');
function player(wide){
  const events={},media={matches:wide,addEventListener:(_,f)=>events.change=f},link={};
  const video={paused:true,currentTime:0,ended:false,dataset:{landscapeSrc:'wide.mp4',portraitSrc:'tall.mp4',landscapePoster:'wide.jpg',portraitPoster:'tall.jpg'},addEventListener:(n,f)=>events[n]=f};
  vm.runInNewContext(code,{window:{matchMedia:()=>media},document:{querySelector:s=>s==='.promo-video'?video:link}});
  return {video,media,link,events};
}
test('a desktop loads the landscape movie; a narrow screen loads portrait',()=>{
  for(const wide of [true,false]){const p=player(wide);assert.equal(p.video.src,wide?'wide.mp4':'tall.mp4');assert.equal(p.link.href,p.video.src);assert.equal(p.video.poster,wide?'wide.jpg':'tall.jpg');assert.equal(p.video.paused,true);}
});
test('resizing chooses the new format before playback, but preserves playback and paused position',()=>{
  const p=player(false);p.media.matches=true;p.events.change();assert.equal(p.video.src,'wide.mp4');
  p.video.paused=false;p.video.currentTime=30;p.media.matches=false;p.events.change();assert.equal(p.video.src,'wide.mp4');
  p.video.paused=true;p.events.change();assert.equal(p.video.src,'wide.mp4');
  p.video.ended=true;p.events.ended();assert.equal(p.video.src,'tall.mp4');
});
