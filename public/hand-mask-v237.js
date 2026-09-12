(function (root) {
  'use strict';
  // Locate the original NAGA hand panel, not the current number of remaining
  // tiles. A chi/pon frame still has the pre-call panel and the consumed slots.
  function detectSourcePanel(pixels, width, height, fallback) {
    if (!pixels || pixels.length !== width * height * 4 || width < 100 || height < 100) return fallback;
    const offset = (x, y) => (y * width + x) * 4;
    const light = i => pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114;
    // Just outside the hand panel. Far-left sampling can intersect an
    // opponent's exposed tiles (Pierre 38) and mistake them for the table.
    const outsideX = Math.floor(width * .10);
    const anchor = offset(outsideX, Math.floor(height * .81));
    const baseLight = light(anchor), baseBlue = pixels[anchor + 2];
    const dark = (x, y) => {
      const i = offset(x, y);
      return baseLight - light(i) >= 12 || baseBlue - pixels[i + 2] >= 18;
    };
    const candidates = [];
    const seen = new Set();
    // The top edge is above the recommendation bars and hand tiles.
    for (let y = Math.floor(height * .76); y <= Math.floor(height * .85); y++) {
      let start = -1;
      for (let x = Math.floor(width * .08); x < Math.floor(width * .84); x++) {
        const hit = dark(x, y);
        if (hit && start < 0) start = x;
        if (!hit && start >= 0) {
          const runWidth = x - start;
          const key = start + ':' + runWidth;
          if (start >= width * .10 && start <= width * .14 && runWidth >= width * .12 && !seen.has(key)) {
            seen.add(key);
            const scanX = start + 4;
            let top = y, bottom = y;
            while (top > 0 && dark(scanX, top - 1)) top--;
            while (bottom < height - 1 && dark(scanX, bottom + 1)) bottom++;
            const panelHeight = bottom - top + 1;
            if (top >= height * .75 && top <= height * .86 && panelHeight >= height * .15 && bottom >= height * .985) {
              candidates.push({left:start,top,width:runWidth,height:panelHeight});
            }
          }
          start = -1;
        }
      }
    }
    candidates.sort((a,b) => b.width * b.height - a.width * a.height);
    const best = candidates[0];
    if (!best) return fallback;
    const color = y => {
      const i = offset(best.left + 4, y);
      return '#' + Array.from(pixels.slice(i, i + 3)).map(n => n.toString(16).padStart(2,'0')).join('');
    };
    return {left:best.left / width * 100,top:best.top / height * 100,width:best.width / width * 100,height:best.height / height * 100,
      topColor:color(best.top + Math.floor(best.height * .08)),bottomColor:color(best.top + Math.floor(best.height * .92))};
  }
  root.NagaHandMaskV237 = {detectSourcePanel};
})(globalThis);
