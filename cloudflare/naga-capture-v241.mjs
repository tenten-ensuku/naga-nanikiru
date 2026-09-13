// Runs inside the application's dedicated Cloudflare browser, not the user's
// browser. Only a validated canonical NAGA URL can enter this function.
export async function captureNaga(env,sceneUrl){
  const {default:puppeteer}=await import('@cloudflare/puppeteer');
  let browser,timer;
  try{
    browser=await puppeteer.launch(env.BROWSER);
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('capture_timeout')),45000);});
    return await Promise.race([timeout,(async()=>{
      const page=await browser.newPage();
      await page.setViewport({width:1280,height:720,deviceScaleFactor:1});
      await page.goto(sceneUrl,{waitUntil:'networkidle2',timeout:25000});
      await page.waitForSelector('.column.is-three-quarter img',{visible:true,timeout:12000});
      const toggle=await page.$('input[type="checkbox"][data-off-label="伏牌"]');
      if(!toggle)throw Error('hidden_hand_control_missing');
      // Preserve the proven V237 capture contract: force a redraw ending with
      // opponents concealed, then read the original board, not page chrome.
      for(const hidden of [false,true]){
        const previous=await page.$eval('.column.is-three-quarter img',image=>image.src);
        const changed=await page.evaluate((checkbox,next)=>{if(checkbox.checked===next)return false;checkbox.click();return true;},toggle,hidden);
        if(changed)await page.waitForFunction(before=>document.querySelector('.column.is-three-quarter img')?.src!==before,{timeout:7000},previous);
        await page.waitForFunction(expected=>document.querySelector('input[type="checkbox"][data-off-label="伏牌"]')?.checked===expected,{timeout:7000},hidden);
      }
      const source=await page.$eval('.column.is-three-quarter img',image=>image.src);
      if(!source?.startsWith('data:image/png;base64,'))throw Error('board_image_missing');
      await page.setViewport({width:1400,height:1300,deviceScaleFactor:1});
      await page.setContent('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:1400px;height:1300px;overflow:hidden;background:#075b91}img{display:block;width:1400px;height:1300px}</style><img id="scene" src="'+source+'">',{waitUntil:'load'});
      await page.waitForFunction(()=>{const img=document.getElementById('scene');return img?.complete&&img.naturalWidth>0;},{timeout:5000});
      return new Uint8Array(await page.screenshot({type:'webp',quality:86,clip:{x:0,y:0,width:1400,height:1300}}));
    })()]);
  }finally{clearTimeout(timer);if(browser)await browser.close();}
}
