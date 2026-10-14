(function(root){
 'use strict';
 const names=Object.freeze(['ニシキ','ヒバカリ','カガシ','アナンタ','ウロボロス','ガンマ','オメガ']);
 function resolve(question,preferred){
  const models=question.models||[];
  let index=models.findIndex(model=>model.name===preferred);
  const missing=index<0;
  if(missing)index=Math.max(0,models.findIndex(model=>model.name==='ニシキ'));
  return {index,name:models[index]?.name||'',missing,requested:preferred};
 }
 function create({api,storage,getActor}){
  const cache=new Map(),queues=new Map(),loaded=new Set(),reads=new Map(),key=(actor,slug)=>`minkiru:study-model:v351:${actor}:${slug}`;
  function current(actor,slug){
   const id=key(actor,slug);if(cache.has(id))return cache.get(id);
   let saved;try{saved=JSON.parse(storage?.getItem(id)||'null');}catch{}
   const value={default_model:'ニシキ',preferred_model:names.includes(saved?.preferred_model)?saved.preferred_model:null};cache.set(id,value);return value;
  }
  function remember(actor,slug,value){cache.set(key(actor,slug),value);try{storage?.setItem(key(actor,slug),JSON.stringify(value));}catch{}return value;}
  async function rpc(name,slug,model,actor){if(getActor&&actor!==getActor())throw Error('ログイン状態が変わりました。');const result=await api().rpc(name,{p_share_slug:slug,...model!==undefined?{p_model:model}:{}});if(result.error)throw result.error;return result.data;}
  async function load(actor,slug){
   const before=current(actor,slug),data=await rpc('get_collection_study_model',slug,undefined,actor);
   loaded.add(key(actor,slug));
   // A later choice must win over a read that started before the choice.
   if(current(actor,slug)!==before)return current(actor,slug);
   return remember(actor,slug,data);
  }
  function ensure(actor,slug){const id=key(actor,slug);if(loaded.has(id))return Promise.resolve(current(actor,slug));if(!reads.has(id))reads.set(id,load(actor,slug).finally(()=>reads.delete(id)));return reads.get(id);}
  function choose(actor,slug,model,isDefault=false){
   if(!names.includes(model)&&!(model===null&&!isDefault))return Promise.reject(Error('正誤基準を選択してください。'));
   const id=key(actor,slug),before=current(actor,slug),value={...before,[isDefault?'default_model':'preferred_model']:model};remember(actor,slug,value);
   const pending=(queues.get(id)||Promise.resolve()).catch(()=>{}).then(()=>rpc(isDefault?'set_collection_default_model':'save_collection_study_model',slug,model,actor));queues.set(id,pending);
   return pending.then(data=>{loaded.add(id);if(current(actor,slug)===value)remember(actor,slug,data);return data;}).catch(error=>{if(isDefault&&current(actor,slug)===value)remember(actor,slug,before);throw error;});
  }
  return Object.freeze({current,load,ensure,choose});
 }
 root.MinkiruStudyModelV351=Object.freeze({names,resolve,create});
})(typeof globalThis!=='undefined'?globalThis:this);
