import test from 'node:test';
import assert from 'node:assert/strict';
import { mapContentNotePrefill } from '../../src/contentNotePrefill.js';
import { normalizePublicFormFields } from '../../src/publicFormFields.js';
test('正式版自定义标题文案字段收到策划数据，重渲染保留用户修改',()=>{
 const fields=normalizePublicFormFields([
  {fieldId:'form-field-1784949354980-8r2oar',label:'标题',type:'text'},
  {fieldId:'form-field-1784965858773-a6np7o',label:'内容文案',type:'textarea'},
  {fieldId:'form-field-1784965888813-9fvf3u',label:'备注',type:'textarea'},
  {key:'productName',label:'对应产品',type:'text'},
  {key:'hashtags',label:'话题',type:'text'}
 ]);
 const source={title:'花瓶分享',contentText:'自然短句\n第二段',remark:'原需求\n画面脚本',productName:'粉钿流线瓶 · HP0944-1',hashtags:'#花瓶'};
 const mapped=mapContentNotePrefill(fields,source);
 assert.equal(mapped[fields[0].key],source.title);assert.equal(mapped[fields[1].key],source.contentText);assert.equal(mapped[fields[2].key],source.remark);assert.equal(mapped.productName,source.productName);assert.equal(mapped.hashtags,'#花瓶');
 const edited={...mapped,[fields[0].key]:'用户改过',[fields[1].key]:''};
 assert.deepEqual(mapContentNotePrefill(fields,edited),edited);
 assert.equal(Object.keys(source).length,5);
});
