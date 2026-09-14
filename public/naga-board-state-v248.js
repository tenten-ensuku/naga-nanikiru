(function (root) {
  'use strict';
  // Only visible board state is projected here. Concealed-hand replay remains
  // exclusively in NagaGeneratorV44, shared by the browser and Node adapter.
  const VERSION = 1;
  const tilePattern = /^(?:(?:man|pin|sou)[1-9]|ji[1-7]|aka[1-3])$/;
  const tile = value => typeof value === 'string' && tilePattern.test(value);
  const base = value => /^aka/.test(value) ? ['man5', 'pin5', 'sou5'][Number(value.slice(3)) - 1] : value;
  const sort = values => values.slice().sort((a, b) => {
    const index = x => ({man:0, pin:9, sou:18, ji:27}[base(x).slice(0, -1)] + Number(base(x).slice(-1))) * 2 - (/^aka/.test(x) ? 1 : 0);
    return index(a) - index(b);
  });
  const equalTiles = (a, b) => JSON.stringify(sort(a)) === JSON.stringify(sort(b));
  const ranks = ['新人','9級','8級','7級','6級','5級','4級','3級','2級','1級','初段','二段','三段','四段','五段','六段','七段','八段','九段','十段','天鳳位'];
  function project(report, candidate) {
    const g = root.NagaGeneratorV44;
    if (!g || !g.validateDiscardHand(candidate).valid) throw Error('手牌の整合性を確認できません');
    const {tw, ts, tv} = candidate;
    const entries = report?.pred?.[ts];
    const msg = entry => entry?.info?.msg;
    const start = msg(entries?.[0]), current = msg(entries?.[tv]);
    if (!start || start.type !== 'start_kyoku' || start.tehais?.length !== 4 || !current || !['tsumo','chi','pon','dahai','ankan','kakan','daiminkan'].includes(current.type)) throw Error('この局面形式はJSON盤面の確認が必要です');
    const convert = raw => { const result = g.tileToAppCode(raw); if (!tile(result)) throw Error('不明な牌があります'); return result; };
    const state = g.replayKyoku(entries, tv + 1, tw);
    const rivers = [[],[],[],[]], melds = [[],[],[],[]], reached = [false,false,false,false], pending = [false,false,false,false];
    let scores = start.scores.slice(), kyotaku = start.kyotaku, drawn = [null,null,null,null];
    const dora = [convert(start.dora_marker)];
    for (let i = 1; i <= tv; i++) {
      const m = msg(entries[i]), actor = m.actor;
      if (m.type === 'tsumo') drawn[actor] = convert(m.pai);
      if (m.type === 'reach') pending[actor] = true;
      else if (m.type === 'reach_accepted') { scores = m.scores.slice(); reached[actor] = true; pending[actor] = false; kyotaku++; }
      else if (m.type === 'dahai') rivers[actor].push({tile:convert(m.pai), tsumogiri:m.tsumogiri === true, riichi:pending[actor], called:false});
      else if (m.type === 'dora') dora.push(convert(m.dora_marker));
      else if (['chi','pon','daiminkan','ankan'].includes(m.type)) {
        const value = {type:m.type, pai:m.type === 'ankan' ? null : convert(m.pai), consumed:m.consumed.map(convert), from:m.type === 'ankan' ? null : (m.target - actor + 4) % 4};
        melds[actor].push(value);
        if (m.type !== 'ankan') {
          const last = rivers[m.target]?.at(-1);
          if (!last || last.tile !== value.pai || last.called) throw Error('副露元の捨て牌が一致しません');
          last.called = true;
        }
      } else if (m.type === 'kakan') {
        const added = convert(m.pai), old = melds[actor].find(x => x.type === 'pon' && base(x.pai) === base(added));
        if (!old) throw Error('加槓元のポンがありません');
        old.type = 'kakan'; old.added = added;
      } else if (!['tsumo','reach','reach_accepted'].includes(m.type)) {
        throw Error('未対応の局面イベント: ' + String(m.type));
      }
      if ((m.type === 'dahai' && i < tv) || m.type === 'dora') drawn = [null,null,null,null];
      if (['ankan','kakan'].includes(m.type)) drawn[actor] = null;
    }
    // Assert orientation metadata and canonical physical melds agree.
    for (let seat = 0; seat < 4; seat++) {
      if (melds[seat].length !== state.allMelds[seat].length) throw Error('副露の再生が一致しません');
      melds[seat].forEach((m, i) => {
        if (!equalTiles(m.consumed.concat(m.pai || [], m.added || []), g.meldDisplayTiles(state.allMelds[seat][i]))) throw Error('副露牌が一致しません');
      });
    }
    const slots = g.displayConcealedHandSlots(candidate, sort) || sort(g.displayConcealedHand(candidate));
    const own = slots.filter(Boolean).concat(candidate.draw || []);
    if (!equalTiles(own, state.allHands[tw])) throw Error('選択手牌と盤面の時点が一致しません');
    const winds = ['東','南','西','北'];
    const scene = {
      schemaVersion:VERSION, renderer:'naga-json-board',
      source:{reportId:candidate.sourceReportId, tw, ts, tv},
      round:{wind:({E:'東',S:'南',W:'西',N:'北'})[start.bakaze], number:start.kyoku, honba:start.honba, kyotaku, remaining:current.left_hai_num, dealer:start.oya},
      doraIndicators:dora,
      players:Array.from({length:4}, (_, relative) => {
        const seat = (tw + relative) % 4;
        const probability = entries[tv][['','tenpai_s','tenpai_t','tenpai_k'][relative]]?.[tw];
        const hiddenSlots = Array(state.allHands[seat].length).fill(true);
        let hiddenDraw = false;
        if (relative && current.actor === seat && current.type === 'dahai' && !current.tsumogiri) {
          const layout = sort(state.allHands[seat].concat(convert(current.pai)));
          layout[layout.indexOf(convert(current.pai))] = null;
          if (drawn[seat]) { const drawIndex=layout.indexOf(drawn[seat]); if(drawIndex>=0){layout.splice(drawIndex,1);hiddenDraw=true;} }
          hiddenSlots.splice(0,hiddenSlots.length,...layout.map(Boolean));
        }
        return {seat, relative, name:String(report.player_info?.name?.[seat] ?? ''), rank:ranks[report.player_info?.dan?.[seat]] ?? '', rating:Number.isFinite(report.player_info?.rate?.[seat]) ? Math.floor(report.player_info.rate[seat]) : null, wind:winds[(seat - start.oya + 4) % 4], score:scores[seat], concealedCount:state.allHands[seat].length, hiddenSlots, hiddenDraw, river:rivers[seat], melds:melds[seat], reached:reached[seat], tenpaiProbability:relative && Number.isFinite(probability) ? probability / 10000 : null};
      }),
      hand:{tiles:slots, draw:candidate.draw || null},
      immediateCall:['chi','pon','daiminkan','ankan'].includes(current.type) && current.actor === tw
    };
    const validation = validate(scene, candidate);
    if (!validation.valid) throw Error('盤面の検証に失敗: ' + validation.errors.join(', '));
    return scene;
  }
  function validate(scene, candidate) {
    const errors = [];
    const check = (condition, key) => { if (!condition) errors.push(key); };
    const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
    const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k));
    try {
      check(JSON.stringify(scene).length < 24000, 'size');
      check(keys(scene,['schemaVersion','renderer','source','round','doraIndicators','players','hand','immediateCall']), 'fields');
      check(scene.schemaVersion === VERSION && scene.renderer === 'naga-json-board', 'version');
      const s = scene.source, r = scene.round;
      check(keys(s,['reportId','tw','ts','tv']) && /^[a-zA-Z0-9_-]{8,160}$/.test(s.reportId) && integer(s.tw,0,3) && integer(s.ts,0,200) && integer(s.tv,0,2000), 'source');
      check(keys(r,['wind','number','honba','kyotaku','remaining','dealer']) && ['東','南','西','北'].includes(r.wind) && integer(r.number,1,4) && integer(r.honba,0,200) && integer(r.kyotaku,0,200) && integer(r.remaining,0,70) && integer(r.dealer,0,3), 'round');
      check(Array.isArray(scene.doraIndicators) && scene.doraIndicators.length > 0 && scene.doraIndicators.length <= 5 && scene.doraIndicators.every(tile), 'dora');
      check(Array.isArray(scene.players) && scene.players.length === 4, 'players');
      scene.players.forEach((p, i) => {
        check(keys(p,['seat','relative','name','rank','rating','wind','score','concealedCount','hiddenSlots','hiddenDraw','river','melds','reached','tenpaiProbability']), 'player_fields');
        check(Array.isArray(p.hiddenSlots) && p.hiddenSlots.length <= 14 && p.hiddenSlots.every(x=>typeof x==='boolean') && typeof p.hiddenDraw==='boolean' && p.hiddenSlots.filter(Boolean).length + (p.hiddenDraw?1:0) === p.concealedCount, 'hidden_slots');
        check(p.relative === i && p.seat === (s.tw + i) % 4 && ['東','南','西','北'][(p.seat - r.dealer + 4) % 4] === p.wind, 'seats');
        check(typeof p.name === 'string' && p.name.length <= 80 && typeof p.rank === 'string' && p.rank.length <= 20 && (p.rating === null || integer(p.rating,0,10000)), 'player_label');
        check(integer(p.score,-1000000,1000000) && integer(p.concealedCount,0,14) && typeof p.reached === 'boolean' && (p.tenpaiProbability === null || (Number.isFinite(p.tenpaiProbability) && p.tenpaiProbability >= 0 && p.tenpaiProbability <= 1)), 'player_values');
        check(Array.isArray(p.river) && p.river.length <= 40 && p.river.every(x => keys(x,['tile','riichi','tsumogiri','called']) && tile(x.tile) && ['riichi','tsumogiri','called'].every(k => typeof x[k] === 'boolean')), 'river');
        check(Array.isArray(p.melds) && p.melds.length <= 4, 'melds');
        p.melds.forEach(m => {
          check(keys(m,['type','pai','consumed','from','added']) && ['chi','pon','daiminkan','ankan','kakan'].includes(m.type), 'meld_fields');
          check(Array.isArray(m.consumed) && m.consumed.every(tile) && m.consumed.length === ({chi:2,pon:2,kakan:2,ankan:4,daiminkan:3})[m.type], 'meld_count');
          check(m.type === 'ankan' ? m.from === null && m.pai === null : tile(m.pai) && integer(m.from,1,3), 'meld_from');
          check(m.type !== 'chi' || m.from === 3, 'chi_from');
          check(m.type === 'kakan' ? tile(m.added) && base(m.added) === base(m.pai) : m.added === undefined, 'added');
          const group = m.consumed.concat(m.pai || []);
          if (m.type !== 'chi') check(group.every(x => base(x) === base(group[0])), 'meld_tiles');
          else { const seq = sort(group.map(base)); check(!seq[0].startsWith('ji') && seq.every(x => x.slice(0,3) === seq[0].slice(0,3)) && Number(seq[1].slice(-1)) === Number(seq[0].slice(-1)) + 1 && Number(seq[2].slice(-1)) === Number(seq[0].slice(-1)) + 2, 'chi_tiles'); }
        });
      });
      check(keys(scene.hand,['tiles','draw']) && Array.isArray(scene.hand.tiles) && scene.hand.tiles.length <= 14 && scene.hand.tiles.every(x => x === null || tile(x)) && (scene.hand.draw === null || tile(scene.hand.draw)), 'hand');
      const own = scene.hand.tiles.filter(Boolean).concat(scene.hand.draw || []);
      check(scene.players[0].concealedCount === own.length && typeof scene.immediateCall === 'boolean', 'own_count');
      if (candidate) {
        const g = root.NagaGeneratorV44;
        check(s.reportId === candidate.sourceReportId && s.tw === candidate.tw && s.ts === candidate.ts && s.tv === candidate.tv, 'candidate_source');
        check(equalTiles(own, g.displayConcealedHand(candidate).concat(candidate.draw || [])), 'candidate_hand');
        const expectedSlots = g.displayConcealedHandSlots(candidate, sort) || sort(g.displayConcealedHand(candidate));
        check(JSON.stringify(scene.hand.tiles) === JSON.stringify(expectedSlots) && scene.hand.draw === (candidate.draw || null), 'candidate_slots');
        check(scene.players[0].melds.length === (candidate.melds || []).length, 'candidate_melds');
        scene.players[0].melds.forEach((m, i) => check(equalTiles(m.consumed.concat(m.pai || [],m.added || []),g.meldDisplayTiles(candidate.melds[i])), 'candidate_meld_tiles'));
      }
    } catch (_) { errors.push('structure'); }
    return {valid:errors.length === 0, errors:[...new Set(errors)]};
  }
  root.NagaBoardStateV248 = Object.freeze({project, validate, sort, tile, base});
})(typeof globalThis !== 'undefined' ? globalThis : this);
