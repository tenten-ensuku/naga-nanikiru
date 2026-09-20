(function(root) {
  'use strict';
  const W=700,H=650,TW=29.3,TH=40,LINE=5*TW+TH,top=H-50/3-TW-4*TH;
  const rivers=[[W/2-LINE/2,H-top+LINE],[top+25-LINE,H+25-(W/2-LINE/2)],[W/2-LINE/2,top],[25-top+H,H+25-(W/2-LINE/2)]];
  const hands=[[124,H-2*TH-TW/4],[124,H+25-TH-50/3],[124,H-TH-50/3],[110,H+25-TH-50/3]];
  const panelY=hands[0][1]-TH-TW/4,colors=['#9C27B0','#4CAF50','#FFEB3B','#2196F3'];
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const back=(x,y,w=TW,h=TH)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx=".7" fill="#e3b33b" stroke="#b5933b" stroke-width=".55"/>`;
  const face=(t,x,y,w=TW,h=TH)=>`<image href="tiles/${t}-66-90-l.png" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
  const sideways=(t,x,y)=>`<g transform="translate(${x} ${y+TW}) rotate(-90)">${face(t,0,0)}</g>`;
  const text=(x,y,size,value,extra='')=>`<text x="${x}" y="${y}" font-size="${size}" ${extra}>${esc(value)}</text>`;
  function meldMarkup(m,x,y) {
    if(m.type==='ankan') return m.consumed.map((t,i)=>i===0||i===3?back(x+i*TW,y):face(t,x+i*TW,y)).join('');
    const index=m.type==='chi'?0:(m.type==='daiminkan'&&m.from===1?3:3-m.from);
    const tiles=m.consumed.slice();tiles.splice(index,0,m.pai);
    let cursor=x;
    return tiles.map((t,i)=>{
      const result=i===index?sideways(t,cursor,y+TH-TW)+(m.added?sideways(m.added,cursor,y+TH-2*TW):''):face(t,cursor,y);
      cursor+=i===index?TH:TW;return result;
    }).join('');
  }
  function playerMarkup(p) {
    const r=p.relative,[hx,hy]=hands[r],[rx,ry]=rivers[r],py=r===0?panelY-TH-TW/4-TW/3-20:hy-70-TW/3;
    let out=`<g transform="rotate(${-90*r} 350 325)" data-board-player="${p.seat}"><rect x="${hx}" y="${py}" width="120" height="70" fill="#000" opacity=".4"/>`;
    out+=text(hx+10,py+18,10,p.rating>=1800?`R${p.rating}`:'')+text(hx+10,py+48,24,p.rank)+text(hx+10,py+65,12,p.name);
    if(r) {
      const cx=hx+95,cy=py+25,prob=p.tenpaiProbability;
      out+=`<circle cx="${cx}" cy="${cy}" r="25" fill="${prob===null?'#677d89':'#fff'}"><title>${prob===null?'テンパイ推定なし':`NAGAテンパイ推定 ${(prob*100).toFixed(1)}%`}</title></circle>`;
      if(prob>0&&prob<1){const start=(r-1)*Math.PI/2,end=start+2*Math.PI*prob;out+=`<path d="M${cx},${cy} L${cx+25*Math.cos(start)},${cy+25*Math.sin(start)} A25,25 0 ${prob>.5?1:0},1 ${cx+25*Math.cos(end)},${cy+25*Math.sin(end)} Z" fill="${colors[r]}"/>`;}
      if(prob===1)out+=`<circle cx="${cx}" cy="${cy}" r="25" fill="${colors[r]}"/>`;
      out+=p.hiddenSlots.map((visible,i)=>visible?back(hx+i*TW,hy):'').join('');
      if(p.hiddenDraw)out+=back(hx+p.hiddenSlots.length*TW+Math.floor(TW/2),hy);
    }
    out+=`<rect x="${rx}" y="${ry-3}" width="${LINE}" height="3" fill="${colors[r]}"/>`;
    out+=`<text x="${rx+LINE/2-49}" y="${ry-9}" font-size="23">${p.wind} ${p.score/100}<tspan font-size="13" opacity=".5">00</tspan></text>`;
    let x=rx,y=ry;
    p.river.forEach((v,i)=>{
      const w=v.riichi?TH:TW,h=v.riichi?TW:TH;
      out+=`<g data-river-tile="${v.tile}">${v.riichi?sideways(v.tile,x,y):face(v.tile,x,y)}`;
      if(v.tsumogiri)out+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000" opacity=".3"/>`;
      if(v.called)out+=`<rect x="${x+1}" y="${y+1}" width="${w-2}" height="${h-2}" fill="none" stroke="red" stroke-width="2"/>`;
      out+='</g>';x+=w;if(i===5||i===11){x=rx;y+=TH;}
    });
    let right=r%2?675:700;const bottom=r%2?675:650;
    p.melds.forEach(m=>{const width=m.type==='ankan'?4*TW:TH+(m.type==='daiminkan'?3:2)*TW;right-=width;out+=`<g data-board-meld="${m.type}">${meldMarkup(m,right,bottom-TH)}</g>`;right-=Math.floor(TW/5);});
    return out+'</g>';
  }
  function markup(scene,{showHand=true}={}) {
    if(!root.NagaBoardStateV248.validate(scene).valid) return '<div class="naga-board-error" role="alert">盤面データを確認できません。</div>';
    const width=475-3*TW*scene.players[0].melds.length+(scene.immediateCall?2*TW:0);
    let out=`<svg class="naga-json-board-svg" viewBox="0 0 700 650" role="img" aria-label="${scene.round.wind}${scene.round.number}局・JSON再現盤面"><rect width="700" height="650" fill="transparent"/><rect x="80" y="${panelY}" width="${width}" height="${3*TH+TW/2}" fill="#000" opacity=".4"/>`;
    out+=scene.players.map(playerMarkup).join('');
    out+=text(350,279,32,`${scene.round.wind}${['一','二','三','四'][scene.round.number-1]}局`,'text-anchor="middle"')+text(307,300,16,scene.round.remaining)+text(370,298,13,`× ${scene.round.kyotaku}`)+text(370,310,13,`× ${scene.round.honba}`);
    out+='<rect x="340" y="290" width="20" height="7" fill="white"/><circle cx="350" cy="293.5" r="1.25" fill="#d34e4e"/><rect x="340" y="302" width="20" height="7" fill="white"/>';
    out+=[346,350,354].map(x=>`<circle cx="${x}" cy="305.5" r=".75" fill="#193e64"/>`).join('');
    out+=Array.from({length:5},(_,i)=>scene.doraIndicators[i]?face(scene.doraIndicators[i],302.5+i*19,320,19,27):back(302.5+i*19,320,19,27)).join('');
    if(scene.immediateCall)out+=text(350,500,46,({chi:'チー',pon:'ポン',daiminkan:'カン',ankan:'カン'})[scene.players[0].melds.at(-1)?.type]||'', 'text-anchor="middle" stroke="#173041" stroke-width="1" paint-order="stroke"');
    if(showHand)out+=handPositions(scene).map(p=>face(p.tile,p.x,p.y)).join('');
    return out+'</svg>';
  }
  function handPositions(scene) {
    const values=scene.hand.tiles.map((tile,i)=>tile?{tile,index:i,x:hands[0][0]+i*TW,y:hands[0][1],draw:false}:null).filter(Boolean);
    if(scene.hand.draw)values.push({tile:scene.hand.draw,index:scene.hand.tiles.length,x:hands[0][0]+scene.hand.tiles.length*TW+Math.floor(TW/2),y:hands[0][1],draw:true});
    return values;
  }
  function discardBars(position,{models=[],probabilities={},selectedModel=0}={}) {
    const selectedColumn=models.findIndex((model,column)=>(model.index??column)===selectedModel);
    if(selectedColumn<0)return '';
    // NAGA report viewer 1.1.3: renderDahaiGraph / _renderTehaiRect.
    // A 100% bar is one tile high; the selected bar is 1.7 times wider.
    const count=models.length,gap=.5,ratio=1.7;
    const thin=Math.min((20-(count-1)*gap)/(count+ratio-1),10/ratio),thick=thin*ratio;
    const inset=(TW-(count-1)*gap-(count+ratio-1)*thin)/2;
    const values=probabilities[position.tile]||[],finite=value=>value!=null&&value!==''&&Number.isFinite(Number(value));
    if(!finite(values[selectedModel])||Number(values[selectedModel])<=0)return '';
    let out='',x=position.x+inset;
    models.forEach((model,column)=>{
      const selected=column===selectedColumn,width=selected?thick:thin,raw=values[model.index??column];
      const value=finite(raw)?Math.max(0,Math.min(100,Number(raw))):0,height=TH*value/100;
      if(height>0)out+=`<rect data-recommendation-bar="${model.index??column}" data-hand-index="${position.index}" x="${x}" y="${position.y-height}" width="${width}" height="${height}" fill="${selected?'#7c3be6':'#5a5c4e'}"${selected?' stroke="#c992d3" stroke-width=".5"':''}><title>${esc(model.name)}：${value.toFixed(1)}%</title></rect>`;
      x+=width+gap;
    });
    return out;
  }
  function recommendationFrame(position,kind,width,color) {
    return `<rect data-recommendation-frame="${kind}" data-hand-index="${position.index}" x="${position.x+width/2}" y="${position.y+width/2}" width="${TW-width}" height="${TH-width}" fill="none" stroke="${color}" stroke-width="${width}"><title>${kind==='player'?'プレイヤーの選択':'NAGAの推奨'}</title></rect>`;
  }
  function tileRecommendationsMarkup(tile,{index=0,player=false,recommended=false,...options}={}) {
    const position={tile,index,x:0,y:TH};
    return `<svg class="naga-tile-recommendations-v312" viewBox="0 0 ${TW} ${2*TH}" preserveAspectRatio="none" aria-hidden="true">${discardBars(position,options)}${recommended?recommendationFrame(position,'naga',3,'#7c3be6'):''}${player?recommendationFrame(position,'player',2,'#ff0000'):''}</svg>`;
  }
  function recommendationsMarkup(scene,{models=[],probabilities={},selectedModel=0,actualDiscard=null,actualTsumogiri=false}={}) {
    const selectedColumn=models.findIndex((model,column)=>(model.index??column)===selectedModel);
    if(selectedColumn<0)return '';
    const positions=handPositions(scene),draw=positions.find(position=>position.draw);
    const recommended=models[selectedColumn].recommendation;
    const recommendationPosition=draw?.tile===recommended?draw:positions.find(position=>!position.draw&&position.tile===recommended);
    const playerPosition=actualTsumogiri?draw?.tile===actualDiscard?draw:null:positions.find(position=>!position.draw&&position.tile===actualDiscard);
    let out=`<svg class="naga-board-recommendations-v311" viewBox="0 0 ${W} ${H}" role="img" aria-label="NAGA打牌推奨度・赤枠はプレイヤー、紫枠はNAGA推奨"><title>表示モデル：${esc(models[selectedColumn].name)}</title>`;
    for(const position of positions) {
      out+=discardBars(position,{models,probabilities,selectedModel});
      if(position===recommendationPosition)out+=recommendationFrame(position,'naga',3,'#7c3be6');
      if(position===playerPosition)out+=recommendationFrame(position,'player',2,'#ff0000');
    }
    return out+'</svg>';
  }
  const validPercent=value=>value!=null&&value!==''&&Number.isFinite(Number(value))?Math.max(0,Math.min(100,Number(value))):null;
  const callLabel=code=>({0:'スルー',1:'チー',2:'チー',3:'チー',4:'ポン',5:'カン',6:'暗槓',7:'加槓',8:'鳴く',9:'カン',10:'立直'})[code]||'';
  const tileName=tile=>({aka1:'赤5萬',aka2:'赤5筒',aka3:'赤5索',ji1:'東',ji2:'南',ji3:'西',ji4:'北',ji5:'白',ji6:'發',ji7:'中'})[tile]||String(tile).replace(/^(man|pin|sou)([1-9])$/,(_,suit,number)=>number+({man:'萬',pin:'筒',sou:'索'})[suit]);
  function callTiles(tile,code) {
    const normal=({aka1:'man5',aka2:'pin5',aka3:'sou5'})[tile]||tile;
    if(!/^(man[1-9]|pin[1-9]|sou[1-9]|ji[1-7])$/.test(normal||''))return [];
    if(code===4||code===5)return Array(code===4?2:3).fill(normal);
    if(code<1||code>3||normal.startsWith('ji'))return [];
    const offsets=({1:[1,2],2:[-1,1],3:[-2,-1]})[code],number=Number(normal.slice(-1));
    return offsets.every(offset=>number+offset>=1&&number+offset<=9)?offsets.map(offset=>normal.slice(0,-1)+(number+offset)):[];
  }
  function judgmentOptions(question) {
    if(question.decisionType!=='call')return [{code:0,values:(question.reach||[]).map(value=>validPercent(value)==null?null:100-Number(value)/100)}, {code:10,values:(question.reach||[]).map(value=>value==null||value===''?null:validPercent(Number(value)/100))}];
    const raw=(question.callOptions||[]).filter(option=>Number.isInteger(Number(option.code))&&Number(option.code)>=0&&Number(option.code)<=7&&Array.isArray(option.values)).map(option=>({code:Number(option.code),values:option.values.map(validPercent)}));
    if(raw.some(option=>option.code>0)) {
      if(!raw.some(option=>option.code===0))raw.unshift({code:0,values:(question.callActionProbabilities?.pass||question.callProbabilities?.pass||[]).map(validPercent)});
      return raw;
    }
    // Older questions may only retain combined rates. Do not invent a chi pattern.
    const probabilities=question.callActionProbabilities||question.callProbabilities||{};
    const actions=[['pass',0],['call',8],['kan',9]];
    return actions.filter(([action])=>Array.isArray(probabilities[action])&&(action==='pass'||probabilities[action].some(value=>Number(value)>0))).map(([action,code])=>({code,values:probabilities[action].map(validPercent)}));
  }
  function judgmentMarkup(question,{models=question.models||[],selectedModel=0}={}) {
    const selectedColumn=models.findIndex((model,column)=>(model.index??column)===selectedModel);
    const isCall=question.decisionType==='call';
    if(selectedColumn<0||(!isCall&&!question.hasRiichiJudgment&&!question.actualReach&&!(question.reach||[]).some(value=>Number(value)>0)))return '';
    const options=judgmentOptions(question),available=question.callPredictionAvailable?.[selectedModel]!==false;
    const finiteOptions=options.filter(option=>option.values[selectedModel]!=null);
    if(!available||!finiteOptions.length)return '<p class="naga-judgment-missing-v312">このモデルの推奨データはありません。</p>';
    const best=finiteOptions.reduce((best,option)=>option.values[selectedModel]>=best.values[selectedModel]?option:best);
    let choices=options.filter(option=>option.code>0);
    // NAGA huroGraphBuild displays the selected model's top two call patterns.
    if(isCall&&choices.length>2)choices=choices.slice().sort((a,b)=>(b.values[selectedModel]??-1)-(a.values[selectedModel]??-1)||b.code-a.code).slice(0,2);
    if(!choices.length)return '';
    const kan=isCall&&choices.every(option=>[6,7,9].includes(option.code));
    const color=!isCall?'#c86464':kan?'#6464c8':'#64c8c8',padding=choices.length===1?40:20;
    const groupWidth=220/choices.length-2*padding,thin=Math.min((groupWidth-(models.length-1))/(models.length-1+1.7),groupWidth/1.7),thick=thin*1.7;
    const tilesWidth=choices.length===1?44:(220/choices.length-4)/(choices.some(option=>option.code===5)?3.5:3),tilesHeight=choices.length===1?60:1.5*tilesWidth;
    let graph='<rect width="260" height="270" fill="#e6e6e6"/><rect y="202.5" width="260" height="5" fill="#646464"/><rect y="101.25" width="260" height="2.5" fill="#787878"/>',cursor=20;
    const descriptions=[];
    for(const option of choices) {
      cursor+=padding;let x=cursor+choices.indexOf(option);
      const label=callLabel(option.code),tiles=callTiles(question.callTile,option.code);
      models.forEach((model,column)=>{
        const index=model.index??column,value=question.callPredictionAvailable?.[index]===false?null:option.values[index],selected=column===selectedColumn,width=selected?thick:thin;
        if(value!=null)graph+=`<rect data-judgment-code="${option.code}" data-judgment-model="${index}" x="${x}" y="${202.5*(1-value/100)}" width="${width}" height="${202.5*value/100}" fill="${selected?color:'#c8c8c8'}"><title>${esc(model.name)} ${label}：${value.toFixed(1)}%</title></rect>`;
        x+=width+1;
      });
      if(tiles.length)graph+=tiles.map((tile,index)=>face(tile,cursor+groupWidth/2-tiles.length*tilesWidth/2+index*tilesWidth,207.5,tilesWidth,tilesHeight)).join('');
      else graph+=`<text x="${cursor+groupWidth/2}" y="231" text-anchor="middle" fill="#0a0a0a" font-size="22">${esc(label[0])}</text><text x="${cursor+groupWidth/2}" y="253" text-anchor="middle" fill="#0a0a0a" font-size="22">${esc(label.slice(1))}</text>`;
      descriptions.push(`${label}${tiles.length?'（'+tiles.map(tileName).join('・')+'）':''}：${option.values[selectedModel]==null?'データなし':option.values[selectedModel].toFixed(1)+'%'}`);
      cursor+=groupWidth+padding;
    }
    const bestTiles=callTiles(question.callTile,best.code),bestLabel=!isCall&&best.code===0?'ダマ':callLabel(best.code);
    const caption=bestLabel+((isCall?best.values[selectedModel]:Number(question.reach[selectedModel])/100)>=90?'！':'寄りかな');
    const modelName=models[selectedColumn].name,title=isCall?'副露推奨':'立直推奨';
    const tileImages=bestTiles.map(tile=>`<img src="tiles/${tile}-66-90-l.png" width="22" height="30" alt="${esc(tileName(tile))}">`).join('');
    return `<section class="naga-judgment-v312" aria-label="${title}"><div class="naga-judgment-heading-v312"><strong>${title}</strong><span>${esc(modelName)}</span></div><div class="naga-judgment-body-v312"><svg class="naga-judgment-graph-v312" viewBox="0 0 260 270" role="img" aria-label="${esc(modelName+' '+descriptions.join('、'))}">${graph}</svg><div class="naga-judgment-caption-v312">${bestTiles.length&&best.code<=3?`<span class="naga-consumed-tiles-v312">${tileImages}<span>使って</span></span>`:''}<strong>${esc(caption)}</strong></div></div><div class="naga-judgment-legend-v312"><span><i style="background:${color}"></i>${esc(modelName)}</span>${models.length>1?'<span><i style="background:#c8c8c8"></i>他モデル</span>':''}</div></section>`;
  }
  root.NagaBoardV248=Object.freeze({markup,handPositions,recommendationsMarkup,tileRecommendationsMarkup,judgmentMarkup,judgmentOptions,callTiles,geometry:{width:W,height:H,tileWidth:TW,tileHeight:TH,handY:hands[0][1]}});
})(typeof globalThis!=='undefined'?globalThis:this);
