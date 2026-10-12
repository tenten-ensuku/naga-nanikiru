(function (root) {
  'use strict';
  const enabled = question => question?.decisionType === 'call' && question.callChoiceMode === 'pattern-v346';
  const code = action => action === 'pass' ? 0 : /^call:[1-5]$/.test(String(action)) ? Number(action.slice(5)) : null;
  const action = value => value === 0 ? 'pass' : 'call:' + value;
  const options = question => (question.callOptions || []).filter(option => Number.isInteger(option.code) && option.code >= 0 && option.code <= 5);
  function tiles(question, selected) {
    const hand = [...(question.handBeforeDraw || []), ...(question.draw ? [question.draw] : [])];
    return root.NagaBoardV248.callTiles(question.callTile, code(selected)).map(tile => {
      const red = {man5:'aka1',pin5:'aka2',sou5:'aka3'}[tile];
      const actual = hand.includes(tile) ? tile : red && hand.includes(red) ? red : tile;
      const at = hand.indexOf(actual); if (at >= 0) hand.splice(at, 1);
      return actual;
    });
  }
  function recommendation(question, index) {
    if (question.callPredictionAvailable?.[index] === false) return null;
    const rows = options(question).filter(option => option.values?.[index] != null && Number.isFinite(Number(option.values[index])));
    if (!rows.some(option => Number(option.values[index]) > 0)) return null;
    const best = rows.reduce((best, option) => Number(option.values[index]) >= Number(best.values[index]) ? option : best);
    return action(best.code);
  }
  function score(question, selected, judgeIndex) {
    if (code(selected) == null || !options(question).some(option => action(option.code) === selected)) return null;
    const names = (question.models || []).filter((model, index) => recommendation(question, index) === selected).map(model => model.name);
    const modelMatch = names.length ? `◎ ${names.join('・')}と一致！！` : '';
    if (recommendation(question, judgeIndex) === selected) return {className:'score-first',mark:'◎',label:'第一推奨と一致',modelMatch};
    if (names.length) return {className:'score-partial',mark:'△',label:'他モデルの第一推奨と一致',modelMatch};
    return {className:'score-bad',mark:'×',label:'全モデルと不一致',modelMatch};
  }
  function label(question, selected, tileLabel) {
    const value = code(selected);
    if (value === 0) return 'スルー';
    if (value == null) return '鳴く（鳴き方未記録）';
    const name = value <= 3 ? 'チー' : value === 4 ? 'ポン' : 'カン';
    const consumed = tiles(question, selected);
    return name + (consumed.length ? `（${consumed.map(tileLabel).join('・')}）` : '');
  }
  function markup(question, selected, tileImage) {
    const value = code(selected);
    if (value === 0) return '<span>スルー</span>';
    if (value == null) return '<span>鳴く（鳴き方未記録）</span>';
    const name = value <= 3 ? 'チー' : value === 4 ? 'ポン' : 'カン';
    return `<span class="call-pattern-tiles-v346">${tiles(question, selected).map(tileImage).join('')}</span><span>${name}</span>`;
  }
  root.MinkiruCallChoicesV346 = Object.freeze({enabled,code,action,options,tiles,recommendation,score,label,markup});
})(typeof globalThis !== 'undefined' ? globalThis : this);
