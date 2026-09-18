import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,contentStageOf} from '../../server/contentCenter/store.mjs';
test('内容需求补齐后显式存入内容候选，保留身份和关联资料',()=>{
 const store=createStore(':memory:');
 try {
  const request=store.save({pool:'candidate',contentStage:'request',title:'秋日餐桌',notes:'突出花瓶的搭配方法',workstationProductIds:['sku-test']});
  assert.equal(contentStageOf(request),'request');
  assert.throws(()=>store.save({revision:request.revision,contentStage:'candidate'},request.id),/补齐/);
  const ready=store.save({revision:request.revision,copyText:'完整正文',noteFormat:'图文'},request.id);
  assert.equal(contentStageOf(ready),'request');
  assert.throws(()=>store.save({revision:ready.revision,pool:'schedule'},ready.id),/内容候选/);
  const candidate=store.save({revision:ready.revision,contentStage:'candidate'},ready.id);
  assert.equal(contentStageOf(candidate),'candidate');assert.equal(candidate.id,request.id);
  assert.equal(candidate.notes,request.notes);assert.deepEqual(candidate.workstationProductIds,['sku-test']);
  assert.equal(store.list().length,1);
  const empty=store.save({revision:candidate.revision,copyText:''},candidate.id);assert.equal(empty.copyText,'');assert.equal(contentStageOf(empty),'candidate');
 }finally{store.close();}
});
test('历史不完整内容归入需求，完整内容归入候选，读取不改写记录',()=>{
 const store=createStore(':memory:');try{
  const idea=store.save({pool:'candidate',title:'旧想法'});
  const ready=store.save({pool:'candidate',title:'旧完整内容',copyText:'正文',noteFormat:'图文'});
  assert.equal(contentStageOf(idea),'request');assert.equal(contentStageOf(ready),'candidate');
  assert.equal(store.get(idea.id).revision,1);assert.equal(store.get(ready.id).revision,1);
 }finally{store.close();}
});
test('列表新需求仅填写想法即可保存，补齐标题仍是进入候选的条件',()=>{
 const store=createStore(':memory:');try{
 const n=store.save({pool:'candidate',contentStage:'request',notes:'餐桌搭配想法',workstationProductIds:['sku-1'],preferredDate:'2026-09-20',preferredTime:'10:30'});
 assert.equal(n.title,'');assert.equal(n.notes,'餐桌搭配想法');assert.deepEqual(n.workstationProductIds,['sku-1']);
 assert.throws(()=>store.save({revision:n.revision,contentStage:'candidate'},n.id),/补齐/);
 assert.throws(()=>store.save({pool:'candidate',contentStage:'request',notes:''}),/标题/);
 }finally{store.close();}
});
