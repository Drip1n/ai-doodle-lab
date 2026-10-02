import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImageServer } from './index.mjs';
import { composePrompt, generate, validateInput } from './generation.mjs';

const bytes = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes); bytes.write('IHDR', 12); bytes.writeUInt32BE(100,16); bytes.writeUInt32BE(100,20);
const reference = `data:image/png;base64,${bytes.toString('base64')}`;
const input = { category: { id: 'cat', name: 'Cat' }, idea: 'in a hat', references: [reference] };
const settings = { key: 'test-only', virtualKey: 'test-route', model: 'test-model', base: 'https://api.portkey.ai/v1', operation: 'edits' };

test('requires real PNG headers, bounded references and short ideas', () => {
 assert.equal(validateInput(input).images.length, 1);
 for (const invalid of [{...input,references:[]},{...input,references:['https://example.com/a.png']},{...input,idea:'a'.repeat(181)},{...input,references:[reference,reference,reference,reference,reference]}]) assert.throws(()=>validateInput(invalid));
 assert.match(composePrompt(validateInput(input)), /main subject must be "Cat"/);
});
test('multipart adapter sends references and handles provider errors without leaking secrets', async () => {
 const result = await generate(validateInput(input), settings, async (url, options) => {
  assert.equal(url,'https://api.portkey.ai/v1/images/edits');
  assert.equal(options.body.get('image').type,'image/png');
  assert.equal(options.headers['x-portkey-api-key'],'test-only');
  return {ok:true,json:async()=>({data:[{b64_json:'YQ=='}]})};
 });
 assert.equal(result.image,'data:image/png;base64,YQ==');
 await assert.rejects(generate(validateInput(input),settings,async()=>({ok:false,status:401})), /could not make/);
});
test('chat adapter preserves reference input and reads image output', async()=>{
 const result=await generate(validateInput(input),{...settings,operation:'chat'},async(url, options)=>{
  assert.match(url,/chat\/completions$/);
  assert.equal(JSON.parse(options.body).messages[0].content[1].image_url.url,reference);
  return {ok:true,json:async()=>({choices:[{message:{images:[{image_url:{url:'data:image/png;base64,YQ=='}}]}}]})};
 }); assert.equal(result.image,'data:image/png;base64,YQ==');
});
test('HTTP rejects unauthorised requests, invalid origins and rate overages', async()=>{
 let calls=0;
 const server=createImageServer({env:{WORKSHOP_ACCESS_CODE:'test-code',PORTKEY_API_KEY:'test-only',PORTKEY_VIRTUAL_KEY:'route',IMAGE_MODEL:'model',IMAGE_REQUEST_LIMIT:'1'},fetcher:async()=>{calls++;return {ok:true,json:async()=>({data:[{b64_json:'YQ=='}]})}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/api/generate-image`;
 const post=(code, origin)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Workshop-Code':code,...(origin?{Origin:origin}:{})},body:JSON.stringify(input)});
 try {
  assert.equal((await post('wrong')).status,401);
  assert.equal((await post('test-code','https://evil.example')).status,403);
  assert.equal((await post('test-code')).status,200);
  assert.equal((await post('test-code')).status,429);
  assert.equal(calls,1);
 } finally { await new Promise(resolve=>server.close(resolve)); }
});
test('unconfigured server does not call a provider', async()=>{
 const server=createImageServer({env:{},fetcher:()=>{throw Error('must not call')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/generate-image`,{method:'POST'})).status,503); }
 finally { await new Promise(resolve=>server.close(resolve)); }
});

test('selected styles survive validation and do not inherit photorealism', () => {
 for (const style of ['realistic', 'cartoon', 'painting', 'toy']) {
  const validated=validateInput({...input,style});
  assert.equal(validated.style,style);
  const prompt=composePrompt(validated);
  assert.match(prompt,/main subject must be "Cat"/);
  if(style !== 'realistic') assert.doesNotMatch(prompt,/Photorealistic:|photographic detail/);
 }
 assert.throws(()=>validateInput({...input,style:'unknown'}));
});
