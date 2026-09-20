import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {boardRenderer} from '../scripts/naga-board-runtime.mjs';

const scene={hand:{tiles:['man5',null,'man5','aka1'],draw:'man5'}};
const models=[{name:'ニシキ',index:0,recommendation:'man5'},{name:'ヒバカリ',index:1,recommendation:'aka1'},{name:'カガシ',index:2,recommendation:'aka1'}];
const probabilities={man5:[50,20,80],aka1:[10,40,60]};
const attributes=markup=>[...markup.matchAll(/<rect ([^>]+)>/g)].map(m=>Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]+)"/g)].map(a=>[a[1],a[2]])));
const close=(actual,expected)=>assert.ok(Math.abs(Number(actual)-expected)<1e-9,`${actual} != ${expected}`);

test('original NAGA geometry: 20px group, 0.5px gaps, selected width 1.7x and height 40 at 100%',()=>{
  const markup=boardRenderer.recommendationsMarkup(scene,{models,probabilities,selectedModel:1});
  const bars=attributes(markup).filter(a=>a['data-recommendation-bar']!==undefined&&a['data-hand-index']==='0');
  const thin=19/3.7;
  assert.equal(bars.length,3);close(bars[0].width,thin);close(bars[1].width,thin*1.7);close(bars[2].width,thin);
  close(bars[0].x,124+4.65);close(bars[1].x,Number(bars[0].x)+thin+.5);close(bars[2].x,Number(bars[1].x)+thin*1.7+.5);
  close(bars[0].height,20);close(Number(bars[0].y)+Number(bars[0].height),boardRenderer.geometry.handY);
  assert.deepEqual(bars.map(b=>b.fill),['#5a5c4e','#7c3be6','#5a5c4e']);assert.equal(bars[1].stroke,'#c992d3');
  const single=attributes(boardRenderer.recommendationsMarkup(scene,{models:[models[0]],probabilities:{man5:[100]},selectedModel:0})).find(a=>a['data-recommendation-bar']==='0');
  close(single.width,10);close(single.height,40);close(single.x,124+9.65);
});

test('duplicate tiles get one player frame; tsumogiri and NAGA draw preference use the correct slot',()=>{
  const render=actualTsumogiri=>attributes(boardRenderer.recommendationsMarkup(scene,{models,probabilities,selectedModel:0,actualDiscard:'man5',actualTsumogiri}));
  for(const [tsumogiri,index] of [[false,'0'],[true,'4']]){
    const attrs=render(tsumogiri),player=attrs.filter(a=>a['data-recommendation-frame']==='player'),naga=attrs.filter(a=>a['data-recommendation-frame']==='naga');
    assert.equal(player.length,1);assert.equal(naga.length,1);assert.equal(player[0]['data-hand-index'],index);assert.equal(naga[0]['data-hand-index'],'4');
    assert.equal(player[0].stroke,'#ff0000');assert.equal(player[0]['stroke-width'],'2');assert.equal(naga[0]['stroke-width'],'3');
    const position=boardRenderer.handPositions(scene).find(p=>String(p.index)===index);close(player[0].x,position.x+1);close(player[0].width,27.3);
  }
});

test('red five is distinct, zero bars do not shift model slots, and selected zero matches the original suppression',()=>{
  const attrs=attributes(boardRenderer.recommendationsMarkup(scene,{models,probabilities:{man5:[0,0,80],aka1:[10,0,60]},selectedModel:2,actualDiscard:'aka1'}));
  assert.equal(attrs.find(a=>a['data-recommendation-frame']==='player')['data-hand-index'],'3');
  assert.equal(attrs.find(a=>a['data-recommendation-frame']==='naga')['data-hand-index'],'3');
  const selected=attrs.find(a=>a['data-recommendation-bar']==='2'&&a['data-hand-index']==='0');
  close(selected.x,124+4.65+2*(19/3.7+.5));
  const suppressed=attributes(boardRenderer.recommendationsMarkup(scene,{models,probabilities:{man5:[0,100,100]},selectedModel:0}));
  assert.equal(suppressed.filter(a=>a['data-recommendation-bar']!==undefined).length,0);
});

test('real post-call scenes preserve empty consumed slots and source data while adding frames',()=>{
  for(const number of [47,50,38,97]){
    const {scene,question}=JSON.parse(fs.readFileSync(new URL(`fixtures/json-board-v248/${number}.json`,import.meta.url)));
    const before=JSON.stringify({scene,question}),positions=boardRenderer.handPositions(scene);
    const model={name:'表示検証',index:0,recommendation:positions.at(-1).tile};
    const probabilities=Object.fromEntries(positions.map(p=>[p.tile,[60]]));
    const attrs=attributes(boardRenderer.recommendationsMarkup(scene,{models:[model],probabilities,actualDiscard:positions[0].tile}));
    for(const bar of attrs.filter(a=>a['data-recommendation-bar']!==undefined)){
      const position=positions.find(p=>String(p.index)===bar['data-hand-index']);assert.ok(position);close(bar.x,position.x+9.65);
    }
    assert.equal(JSON.stringify({scene,question}),before);
  }
});

test('preview model defaults to extraction choice, switches per candidate and leaves comments and selection mounted',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const names=['preferredGeneratorModelV300','generatorCandidateModelIndexV311','generatorCandidateOverlayV311','changeGeneratorPreviewModelV311'];
  const source=names.map(name=>html.match(new RegExp(`      function ${name}\\([^]*?\\n      \\}`))[0]).join('\n');
  const candidate={id:'a',models,probabilities,boardScene:scene,actualDiscard:'man5',ts:0,tv:0};
  const h={generatorReportedModelNamesV46:()=>models.map(m=>m.name),selectedGeneratorModelNamesV46:()=>['カガシ'],generatorPreviewModelsV311:new Map(),generatorCandidatesV44:[candidate,{...candidate,id:'b'}],
    generatorReportV44:{pred:[[{info:{msg:{next_tsumogiri:true}}}]]},window:{NagaBoardV248:boardRenderer}};
  vm.runInNewContext(source,h);assert.equal(h.generatorCandidateModelIndexV311(candidate),2);
  const overlay={innerHTML:''},draft={value:'入力中'},checkbox={checked:true},article={querySelector:()=>overlay,draft,checkbox};
  h.changeGeneratorPreviewModelV311({dataset:{generatorPreviewModelV311:'0'},value:'ヒバカリ',closest:()=>article});
  assert.equal(h.generatorCandidateModelIndexV311(candidate),1);assert.equal(h.generatorCandidateModelIndexV311(h.generatorCandidatesV44[1]),2);
  assert.match(overlay.innerHTML,/表示モデル：ヒバカリ/);assert.equal(article.draft,draft);assert.equal(draft.value,'入力中');assert.equal(checkbox.checked,true);
  const frames=attributes(overlay.innerHTML).filter(a=>a['data-recommendation-frame']==='player');assert.equal(frames[0]['data-hand-index'],'4');
  h.changeGeneratorPreviewModelV311({dataset:{generatorPreviewModelV311:'0'},value:'unknown',closest:()=>article});assert.equal(h.generatorCandidateModelIndexV311(candidate),1);
});
