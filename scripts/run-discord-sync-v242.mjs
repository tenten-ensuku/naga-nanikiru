import {createRuntime} from '../bot/runtime-v242.mjs';
const runtime=await createRuntime();
try{
  await runtime.connect();
  const command=process.argv[2]||'run';
  if(command==='run'){
    process.on('SIGINT',()=>void runtime.stop());process.on('SIGTERM',()=>void runtime.stop());
    await runtime.run();
  }else if(['dry','one'].includes(command)){
    const key=process.argv[3],threadId=process.argv[4];
    if(!['pierre','nima'].includes(key)||!/^\d{15,22}$/.test(threadId||''))throw Error('Expected target and Discord thread ID');
    if(command==='one')await runtime.refreshIndex(key);
    console.log(JSON.stringify(await runtime.processOne({key,threadId},{dry:command==='dry'})));
  }else if(command==='discover'){
    for(const key of ['pierre','nima'])await runtime.refreshIndex(key);
    await runtime.discover();
  }else throw Error('Unknown command');
}catch(e){console.error(JSON.stringify({error:e.code||'bot_failed',status:e.status||null}));process.exitCode=1;}
finally{await runtime.stop();}
