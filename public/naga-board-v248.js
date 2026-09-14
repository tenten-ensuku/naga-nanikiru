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
  root.NagaBoardV248=Object.freeze({markup,handPositions,geometry:{width:W,height:H,tileWidth:TW,tileHeight:TH,handY:hands[0][1]}});
})(typeof globalThis!=='undefined'?globalThis:this);
