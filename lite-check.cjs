'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{webcrypto,createHash}=require('node:crypto');
const html=fs.readFileSync(__dirname+'/source2.html','utf8');
const core=html.match(/<script id="translator-core">([\s\S]*?)<\/script>/)[1];
const app=html.match(/<script id="translator-app">([\s\S]*?)<\/script>/)[1];
const key='information-translator.books2';
function page(store=new Map()){
  const elements=new Map(),listeners={};let blocked=false;
  function el(id='',tag='div'){
    const classes=new Set();
    return {id,tag,value:'',textContent:'',disabled:false,style:{},dataset:{},children:[],files:[],className:'',
      classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,force)=>{const add=force===undefined?!classes.has(x):force;add?classes.add(x):classes.delete(x);return add;}},
      append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=[...nodes];},
      querySelectorAll(selector){return this.children.flatMap(child=>[(selector==='button'?child.tag==='button':child.className.split(' ').includes(selector.slice(1)))?child:null,...child.querySelectorAll(selector)]).filter(Boolean);},
      setAttribute(){},addEventListener(){},focus(){},select(){},contains(){return false;},click(){return this.onclick?.();},
      showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},remove(){}};
  }
  const get=id=>{assert(elements.has(id),'Unknown UI element '+id);return elements.get(id);};
  for(const m of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){
    const node=el(m[2],m[1]);if(/\bhidden\b/.test(m[0]))node.classList.add('hidden');elements.set(m[2],node);
  }
  const document={getElementById:get,createElement:tag=>el('',tag),querySelectorAll:()=>[...elements.values()],addEventListener(){},body:{append(){}}};
  const context=vm.createContext({document,window:{addEventListener:(name,fn)=>listeners[name]=fn},navigator:{},crypto:webcrypto,TextEncoder,TextDecoder,btoa,atob,Uint8Array,Uint32Array,DataView,BigInt,Blob,
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>{if(blocked)throw Error('storage blocked');store.set(k,v);},removeItem:k=>{if(blocked)throw Error('storage blocked');store.delete(k);}},
    requestAnimationFrame:fn=>queueMicrotask(fn),setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){}});
  vm.runInContext(core+';globalThis.API=InformationTranslator;'+app,context);
  return {get,store,listeners,api:context.API,block:()=>blocked=true,choices:()=>get('book-list').querySelectorAll('.book-choice'),async ready(){const deadline=Date.now()+10000;while(get('new-book').disabled&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));assert(!get('new-book').disabled);}};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
  const s=page(new Map([['information-translator.books','original app fixture']]));await s.ready();let raw,cipher;
  await test('generation works without save APIs and persists the book in the original Lite storage key',async()=>{
    await s.get('new-book').onclick();raw=JSON.parse(s.store.get(key)).files[0];assert(raw);assert.equal(s.store.get('information-translator.books'),'original app fixture');assert.equal(s.choices().length,1);
    s.get('input').value='持久化兼容测试：𠮷 English 123\n第二行';await s.get('encode').onclick();cipher=s.get('output').value;assert(/^[0-9A-Za-z]+$/.test(cipher));
  });
  const restored=page(s.store);await restored.ready();
  await test('reload restores old-format records without another file import and lets users choose manually',async()=>{
    assert.equal(restored.choices().length,1);assert.equal(restored.get('book-selected-name').textContent,'请选择密码本');
    await restored.choices()[0].onclick();restored.get('input').value=cipher;await restored.get('decode').onclick();assert.equal(restored.get('output').value,s.get('input').value);
  });
  await test('renaming changes exactly the displayed name and stored metadata, retaining the key and old messages',async()=>{
    restored.get('rename-book').onclick();restored.get('book-name').value='我的 Lite 密码本';await restored.get('rename-confirm').onclick();
    assert.equal(restored.get('book-selected-name').textContent,'我的 Lite 密码本');const updated=JSON.parse(JSON.parse(s.store.get(key)).files[0]),before=JSON.parse(raw);
    assert.equal(updated.name,'我的 Lite 密码本');assert.equal(updated.seed,before.seed);assert.equal(updated.id,before.id);
    await restored.get('decode').onclick();assert.equal(restored.get('status').textContent,'解密完成');
  });
  await test('an imported book stays available after reload and duplicate imports do not add copies',async()=>{
    const other=await restored.api.Book.create(),imported=await other.export('外来测试本');other.destroy();
    for(let i=0;i<2;i++){restored.get('book-file').files=[{size:imported.length,text:async()=>imported}];await restored.get('book-file').onchange();}
    assert.equal(restored.choices().length,2);const again=page(s.store);await again.ready();assert.equal(again.choices().length,2);assert.equal(again.choices()[0].textContent,'我的 Lite 密码本');
    await again.choices()[1].onclick();again.get('input').value=cipher;await again.get('decode').onclick();assert.match(again.get('status').textContent,/密码本错误|内容不完整/);assert.equal(again.get('output').value,'');again.listeners.pagehide();
  });
  await test('deleting a record removes it from the persistent dropdown without touching other app records',async()=>{
    const remove=restored.get('book-list').querySelectorAll('.book-remove')[1];remove.onclick();restored.get('confirm-delete').onclick();
    assert.equal(JSON.parse(s.store.get(key)).files.length,1);const again=page(s.store);await again.ready();assert.equal(again.choices().length,1);assert.equal(s.store.get('information-translator.books'),'original app fixture');
    again.listeners.pagehide();
  });
  await test('blocked storage leaves the record intact on failed deletion and gives a visible warning',async()=>{
    const blocked=page(s.store);await blocked.ready();blocked.block();blocked.get('book-list').querySelectorAll('.book-remove')[0].onclick();blocked.get('confirm-delete').onclick();
    assert.equal(blocked.choices().length,1);assert.match(blocked.get('status').textContent,/无法删除/);assert(blocked.get('book-storage').classList.contains('warning'));
  });
  await test('UI has unique IDs, Songti editors, small inner margins, equal main action cells and four styled book actions',async()=>{
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
    assert(!html.includes('placeholder='));assert(!html.includes('旧版内容恢复'));assert(!html.includes('2号'));assert(!html.includes('转译'));
    assert.match(html,/\.panel textarea\{[^}]*font-family:"SimSun","宋体"[^}]*line-height:21px/);assert(html.includes('padding:3px 8px'));
    assert(html.includes('grid-template-columns:repeat(3,minmax(0,1fr))'));assert(html.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
    for(const id of ['new-book','import-book','export-book','rename-book'])assert(html.includes('.book-actions #'+id+'{'));
  });
  await test('old URL is a retirement page; cleanup targets only its own worker and cache and never saved books',async()=>{
    const old=fs.readFileSync(__dirname+'/dist/2/index.html','utf8');assert(old.includes('旧地址已停用'));assert(old.includes('href="../lite/"'));assert(!old.includes('translator-core'));assert(!old.includes('localStorage'));
    const deleted=[],unregistered=[],prefix='midianji-static-'+encodeURIComponent('/midianji/2/')+'-';
    const keys=[prefix+'old','midianji-static-'+encodeURIComponent('/midianji/lite/')+'-new','unrelated'];
    const regs=['https://example.com/midianji/2/','https://example.com/midianji/lite/','https://example.com/midianji/'].map(scope=>({scope,unregister:async()=>unregistered.push(scope)}));
    vm.runInNewContext(old.match(/<script>([\s\S]*?)<\/script>/)[1],{URL,location:{href:'https://example.com/midianji/2/'},window:{caches:true},caches:{keys:async()=>keys,delete:async k=>deleted.push(k)},navigator:{serviceWorker:{getRegistrations:async()=>regs}}});
    await new Promise(setImmediate);assert.deepEqual(deleted,[keys[0]]);assert.deepEqual(unregistered,['https://example.com/midianji/2/']);
    const worker=fs.readFileSync(__dirname+'/dist/2/sw.js','utf8');new vm.Script(worker);assert(worker.includes('status:410'));assert(worker.includes('self.registration.unregister()'));
  });
  s.listeners.pagehide();restored.listeners.pagehide();console.log(JSON.stringify({passed,persistentBrowserBooks:true,alphanumericFormat:7,oldRouteRetired:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
