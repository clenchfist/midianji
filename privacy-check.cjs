'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/source.html','utf8');
const script=html.match(/<script id="translator-app">([\s\S]*?)<\/script>/)[1];
const LEGACY='information-translator.books',tick=()=>new Promise(setImmediate);
const fixture=(id='fixture',name='测试本',seed='public-test-only')=>JSON.stringify({id,name,seed,checksum:name+':'+seed});
function file(raw){return {size:Buffer.byteLength(raw),text:async()=>raw};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function setup(options={}){
  const elements=new Map(),timers=new Map(),events={},calls=[],downloads=[],blobs=new Map(),storage=new Map();let serial=0;
  if(options.legacy)storage.set(LEGACY,options.legacy);
  function element(id='',tag='div'){
    const classes=new Set(),children=[],attributes={};
    const e={id,tag,value:'',textContent:'',disabled:false,dataset:{},style:{},files:[],children,open:false,
      classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,on)=>{on=on===undefined?!classes.has(x):on;on?classes.add(x):classes.delete(x);return on;}},
      append(...items){children.push(...items);},replaceChildren(...items){children.splice(0,children.length,...items);},remove(){},
      querySelectorAll(selector){return children.flatMap(c=>[...(selector==='button'&&c.tag==='button'||selector.startsWith('.')&&c.className?.split(' ').includes(selector.slice(1))?[c]:[]),...c.querySelectorAll(selector)]);},
      setAttribute(k,v){attributes[k]=v;},getAttribute:k=>attributes[k],addEventListener(){},contains:c=>children.includes(c),focus(){},select(){},
      click(){if(e.download)downloads.push({name:e.download,blob:blobs.get(e.href)});return e.onclick?.();},
      showModal(){e.open=true;},close(){e.open=false;e.onclose?.();}};return e;
  }
  const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
  for(const id of ['copy-toast','book-list','legacy-open','rename-row'])get(id).classList.add('hidden');
  const document={getElementById:get,createElement:tag=>element('',tag),addEventListener(){},body:element(),execCommand:()=>false};
  const window={addEventListener:(name,fn)=>events[name]=fn};
  const navigator={clipboard:{writeText:async text=>calls.push(['copy',text])}};
  const API={supported:()=>true,isMessage:async text=>text.startsWith('CIPHER:'),Book:{
    async create(){calls.push(['create']);return engine(JSON.parse(fixture()));},
    async restore(raw){calls.push(['restore']);if(options.restore)return options.restore(raw);return engine(JSON.parse(raw));},
    async readFile(raw){const value=JSON.parse(raw);if(!value.id||!value.seed||value.checksum!==value.name+':'+value.seed)throw Error('密码本校验未通过');return value;},
    async renameFile(raw,name){name=name.trim();if(!name||[...name].length>40)throw Error('名称应为 1–40 个字符');const b=JSON.parse(raw);return fixture(b.id,name,b.seed);}
  }};
  function engine(book){return {id:book.id,export:async name=>fixture(book.id,name,book.seed),destroy(){calls.push(['destroy']);},
    encode:async text=>options.encode?options.encode(text):'CIPHER:'+book.id+':'+text,
    decode:async text=>{if(!text.startsWith('CIPHER:'+book.id+':'))throw Error('密码本错误');return text.slice(('CIPHER:'+book.id+':').length);}};}
  const url={createObjectURL:blob=>{if(options.urlFails)throw Error('Blob downloads unavailable');const key='blob:'+ ++serial;blobs.set(key,blob);return key;},revokeObjectURL:key=>{calls.push(['revoke',key]);blobs.delete(key);}};
  const localStorage={getItem:key=>{if(options.storageDenied)throw Error('denied');return storage.get(key)??null;},setItem(){throw Error('Password books must never be persisted');},removeItem:key=>{calls.push(['remove',key]);storage.delete(key);}};
  const context={window,document,navigator,InformationTranslator:API,Blob,File:globalThis.File||require('node:buffer').File,URL:url,localStorage,console,
    sessionStorage:new Proxy({},{get(){throw Error('No session storage');}}),indexedDB:new Proxy({},{get(){throw Error('No indexedDB');}}),fetch(){throw Error('No message or keybook network access');},
    setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(script,context);
  return {get,window,navigator,document,API,events,calls,timers,downloads,storage,engine};
}
function handle(name='选择的位置.itbook',raw='',options={}){
  const h={name,raw,writeCount:0,abortCount:0,readCount:0,requestPermission:async()=>options.permission||'granted',
    async getFile(){h.readCount++;return file(options.corrupt&&h.writeCount?fixture('other','错误本','other-seed'):h.raw);},
    async createWritable(){h.writeCount++;let staged;return {async write(blob){if(options.failWrite)throw Error('disk full');staged=await blob.text();},async close(){h.raw=staged;},async abort(){h.abortCount++;}};}};return h;
}
async function importBook(s,raw=fixture(),h=null){if(h){s.window.showOpenFilePicker=async()=>[h];await s.get('import-book').onclick();}else{s.get('book-file').files=[file(raw)];await s.get('book-file').onchange();}}
function legacyButtons(s,index=0){return s.get('legacy-list').children[index].querySelectorAll('button');}
function enableSystemSave(s,options={}){
  const shared=[];s.navigator.canShare=({files})=>!options.textOnly||files[0].type==='text/plain';
  s.navigator.share=data=>{shared.push(data.files[0]);s.calls.push(['share']);return options.share?options.share(data):Promise.resolve();};return shared;
}
async function preparePortable(s,name='手机测试本'){s.get('new-book').onclick();s.get('portable-name').value=name;await s.get('portable-prepare').onclick();}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
  await test('startup never automatically selects or persists a keybook',async()=>{const s=setup();await tick();assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert.equal(s.calls.length,0);assert(s.get('book-select').disabled);});
  await test('picker opens before key generation; cancellation generates and saves nothing',async()=>{
    const s=setup(),pending=deferred();s.window.showSaveFilePicker=()=>{s.calls.push(['picker']);return pending.promise;};const action=s.get('new-book').onclick();assert.deepEqual(s.calls,[['picker']]);assert(s.get('encode').disabled);assert(s.get('input').readOnly);
    pending.reject(Object.assign(Error('cancel'),{name:'AbortError'}));await action;assert.deepEqual(s.calls,[['picker']]);assert.equal(s.downloads.length,0);assert.equal(s.get('status').textContent,'');
  });
  await test('new keybooks cannot overwrite an existing nonempty file',async()=>{const s=setup(),h=handle('已有文件.itbook',fixture());s.window.showSaveFilePicker=async()=>h;await s.get('new-book').onclick();assert.equal(h.writeCount,0);assert(!s.calls.some(c=>c[0]==='create'));assert.match(s.get('status').textContent,/不会覆盖/);});
  await test('generation writes only the selected file, verifies it and imports with exact name',async()=>{
    const s=setup(),h=handle('新的名称.itbook');s.window.showSaveFilePicker=async()=>h;await s.get('new-book').onclick();assert.equal(h.writeCount,1);assert(h.readCount>=3);assert.equal(s.get('book-selected-name').textContent,'新的名称');assert.equal(JSON.parse(h.raw).name,'新的名称');assert.equal(s.downloads.length,0);assert.equal(s.storage.size,0);
    s.get('input').value='原文';await s.get('encode').onclick();assert.equal(s.get('status').textContent,'加密完成');assert.equal(s.get('output').value,'CIPHER:fixture:原文');
  });
  await test('write failure aborts and leaves no active or browser-stored keybook',async()=>{const s=setup(),h=handle('失败.itbook','',{failWrite:true});s.window.showSaveFilePicker=async()=>h;await s.get('new-book').onclick();assert.equal(h.abortCount,1);assert.equal(h.raw,'');assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert.equal(s.downloads.length,0);assert(s.calls.some(c=>c[0]==='destroy'));});
  await test('readback corruption prevents activation and false success',async()=>{const s=setup(),h=handle('失败.itbook','',{corrupt:true});s.window.showSaveFilePicker=async()=>h;await s.get('new-book').onclick();assert.match(s.get('status').textContent,/校验未通过/);assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert.equal(s.downloads.length,0);});
  await test('manual import does not write or duplicate a keybook',async()=>{const s=setup(),h=handle('原文件.itbook',fixture());await importBook(s,null,h);assert.equal(h.writeCount,0);assert.equal(s.get('book-selected-name').textContent,'测试本');assert.equal(s.storage.size,0);assert.equal(s.downloads.length,0);});
  await test('rename writes to the original chosen handle without changing the seed',async()=>{
    const s=setup(),h=handle('原文件.itbook',fixture());s.window.showSaveFilePicker=()=>{throw Error('Rename must not choose another path');};await importBook(s,null,h);s.get('rename-book').onclick();s.get('book-name').value='改什么就是什么';await s.get('rename-confirm').onclick();assert.equal(h.writeCount,1);assert.equal(JSON.parse(h.raw).seed,JSON.parse(fixture()).seed);assert.equal(s.get('book-selected-name').textContent,'改什么就是什么');assert.equal(s.downloads.length,0);
  });
  await test('rename refuses a changed original file and denied write permission',async()=>{
    for(const denied of [false,true]){const s=setup(),h=handle('原文件.itbook',fixture(),{permission:denied?'denied':'granted'});s.window.showSaveFilePicker=async()=>h;await importBook(s,null,h);s.get('rename-book').onclick();s.get('book-name').value='新名';if(!denied)h.raw=fixture('other','另一本','other-seed');await s.get('rename-confirm').onclick();assert.equal(h.writeCount,0);assert.match(s.get('status').textContent,denied?/没有写入/:/文件已改变/);}
  });
  await test('dropdown deletion removes only the current session record',async()=>{const s=setup(),h=handle('原文件.itbook',fixture());await importBook(s,null,h);const remove=s.get('book-list').querySelectorAll('button').find(b=>b.textContent==='删除');remove.onclick();s.get('confirm-delete').onclick();assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert.equal(h.raw,fixture());assert.equal(h.writeCount,0);assert.equal(s.storage.size,0);});
  await test('browsers without file sharing can prepare but cannot download without explicit consent',async()=>{
    const s=setup();s.get('new-book').onclick();assert(s.get('portable-dialog').open);assert(!s.calls.some(c=>c[0]==='create'));await s.get('portable-prepare').onclick();assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert(s.get('portable-download-options').open);assert(s.get('portable-share').classList.contains('hidden'));assert(s.get('portable-download').disabled);s.get('portable-download').onclick();assert.equal(s.downloads.length,0);s.get('portable-cancel').onclick();await importBook(s);s.get('rename-book').onclick();assert.match(s.get('status').textContent,/写回原密码本/);s.get('input').value='CIPHER:fixture:文字';await s.get('decode').onclick();assert.equal(s.get('output').value,'文字');assert.equal(s.downloads.length,0);
  });
  await test('explicit compatibility download uses a local blob and still requires actual saved-file verification',async()=>{
    const s=setup();await preparePortable(s,'安卓本');s.get('portable-download-consent').checked=true;s.get('portable-download-consent').onchange();assert(!s.get('portable-download').disabled);s.get('portable-download').onclick();assert.equal(s.downloads.length,1);assert.equal(s.downloads[0].name,'安卓本.itbook.txt');const raw=await s.downloads[0].blob.text();assert.equal(JSON.parse(raw).name,'安卓本');assert.equal(s.storage.size,0);assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert.match(s.get('portable-state').textContent,/不代表保存成功/);
    s.get('portable-file').files=[file(fixture('wrong'))];await s.get('portable-file').onchange();assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');s.get('portable-file').files=[file(raw)];await s.get('portable-file').onchange();assert.equal(s.get('book-selected-name').textContent,'安卓本');assert(s.calls.some(c=>c[0]==='revoke'));assert.equal(s.get('portable-download-consent').checked,false);
  });
  await test('consenting alone does not start a download and repeat clicks cannot create duplicate requests',async()=>{
    const s=setup();await preparePortable(s);s.get('portable-download-consent').checked=true;s.get('portable-download-consent').onchange();assert.equal(s.downloads.length,0);s.get('portable-download').onclick();s.get('portable-download').onclick();assert.equal(s.downloads.length,1);assert(s.get('portable-share').disabled);assert(s.get('portable-download').disabled);assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');
  });
  await test('canceling compatibility saving revokes the blob and never activates the pending book',async()=>{
    const s=setup();await preparePortable(s);s.get('portable-download-consent').checked=true;s.get('portable-download').onclick();s.get('portable-cancel').onclick();assert(s.calls.some(c=>c[0]==='revoke'));assert.equal(s.get('portable-download-consent').checked,false);assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');s.get('new-book').onclick();assert(s.get('portable-download').disabled);
  });
  await test('a failed download request cannot unlock verification or claim success',async()=>{
    const s=setup({urlFails:true});await preparePortable(s);s.get('portable-download-consent').checked=true;s.get('portable-download').onclick();assert.equal(s.downloads.length,0);assert(s.get('portable-verify').disabled);assert.match(s.get('portable-state').textContent,/未能发起下载/);assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');
  });
  await test('directory-only browsers save to the chosen folder without sharing or downloading',async()=>{
    const s=setup(),h=handle('文件夹本.itbook'),calls=[];s.window.showDirectoryPicker=options=>{calls.push(['picker',options.mode]);return Promise.resolve({getFileHandle:async(name,options)=>{calls.push(['file',name,!!options?.create]);if(!options?.create)throw Object.assign(Error('missing'),{name:'NotFoundError'});return h;}});};
    await preparePortable(s,'文件夹本');assert(!s.get('portable-share').classList.contains('hidden'));const pending=s.get('portable-share').onclick();assert.deepEqual(calls,[['picker','readwrite']]);await pending;assert.equal(h.writeCount,1);assert.equal(s.get('book-selected-name').textContent,'文件夹本');assert.equal(s.get('status').textContent,'密码本已保存并导入');assert.equal(s.downloads.length,0);assert.equal(s.storage.size,0);
  });
  await test('folder saving cannot overwrite an existing filename and cancellation leaves no active book',async()=>{
    for(const cancel of [false,true]){const s=setup(),h=handle('existing.itbook',fixture());s.window.showDirectoryPicker=async()=>{if(cancel)throw Object.assign(Error('cancel'),{name:'AbortError'});return {getFileHandle:async()=>h};};await preparePortable(s);await s.get('portable-share').onclick();assert.equal(h.writeCount,0);assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert.equal(s.downloads.length,0);if(!cancel)assert.match(s.get('portable-state').textContent,/不会覆盖/);}
  });
  await test('closing a pending compatibility download clears its blob and never saves browser records',async()=>{
    const s=setup();await preparePortable(s);s.get('portable-download-consent').checked=true;s.get('portable-download').onclick();s.events.pagehide();assert(s.calls.some(c=>c[0]==='revoke'));assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert.equal(s.storage.size,0);assert.equal(s.get('portable-download-consent').checked,false);
  });
  await test('mobile preparation dialog creates nothing before explicit preparation',async()=>{
    const s=setup();enableSystemSave(s);s.get('new-book').onclick();assert(s.get('portable-dialog').open);assert(!s.calls.some(c=>c[0]==='create'));assert(s.get('portable-share').disabled);s.get('portable-cancel').onclick();assert(!s.get('portable-dialog').open);assert.equal(s.storage.size,0);assert.equal(s.downloads.length,0);
  });
  await test('mobile preparation stays in memory, validates names and never activates an unsaved book',async()=>{
    const s=setup();enableSystemSave(s);s.get('new-book').onclick();s.get('portable-name').value='../bad';await s.get('portable-prepare').onclick();assert(!s.calls.some(c=>c[0]==='create'));assert.match(s.get('portable-state').textContent,/有效密码本名称/);
    s.get('portable-name').value='我的测试本';await s.get('portable-prepare').onclick();assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert(s.calls.some(c=>c[0]==='destroy'));assert(!s.get('portable-share').disabled);assert(s.get('portable-verify').disabled);assert.equal(s.get('portable-filename').textContent,'文件名：我的测试本.itbook');assert.equal(s.downloads.length,0);assert.equal(s.storage.size,0);
  });
  await test('system sheet opens on a fresh click; completing it alone never means saved or active',async()=>{
    const s=setup(),d=deferred();const shared=enableSystemSave(s,{share:()=>d.promise});await preparePortable(s);const pending=s.get('portable-share').onclick();assert.equal(shared.length,1,'Share must be called synchronously before awaiting anything');assert(s.get('portable-verify').disabled);assert(s.get('portable-cancel').disabled);d.resolve();await pending;assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert.match(s.get('portable-state').textContent,/不代表保存成功/);assert(!s.get('portable-verify').disabled);assert.equal(s.downloads.length,0);assert.equal(s.storage.size,0);
  });
  await test('only the actual reselected matching saved file activates a mobile book',async()=>{
    const s=setup(),shared=enableSystemSave(s);await preparePortable(s,'手机本');await s.get('portable-share').onclick();s.get('portable-verify').onclick();s.get('portable-file').files=[file(fixture('wrong','别的本','wrong-seed'))];await s.get('portable-file').onchange();assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert.match(s.get('portable-state').textContent,/不是刚才生成/);
    s.get('portable-file').files=[shared[0]];await s.get('portable-file').onchange();assert.equal(s.get('book-selected-name').textContent,'手机本');assert.equal(s.get('status').textContent,'密码本已核对并导入');assert(!s.get('portable-dialog').open);assert.equal(s.get('portable-name').value,'');assert.equal(s.downloads.length,0);assert.equal(s.storage.size,0);s.get('input').value='已落盘再启用';await s.get('encode').onclick();assert.equal(s.get('output').value,'CIPHER:fixture:已落盘再启用');
  });
  await test('unsupported custom extensions use a text file with identical verified keybook contents',async()=>{
    const s=setup(),shared=enableSystemSave(s,{textOnly:true});await preparePortable(s);assert.equal(s.get('portable-filename').textContent,'文件名：手机测试本.itbook.txt');await s.get('portable-share').onclick();assert.equal(shared[0].type,'text/plain');assert.equal(JSON.parse(await shared[0].text()).name,'手机测试本');s.get('portable-file').files=[shared[0]];await s.get('portable-file').onchange();assert.equal(s.get('book-selected-name').textContent,'手机测试本');
  });
  await test('canceling or failing the system sheet never downloads or enables the generated book',async()=>{
    for(const errorName of ['AbortError','NotAllowedError']){const s=setup();enableSystemSave(s,{share:async()=>{throw Object.assign(Error('failed'),{name:errorName});}});await preparePortable(s);await s.get('portable-share').onclick();assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert.equal(s.downloads.length,0);assert(!s.get('portable-share').disabled);s.get('portable-cancel').onclick();assert(!s.get('portable-dialog').open);assert.equal(s.get('portable-name').value,'');s.get('portable-file').files=[file(fixture())];await s.get('portable-file').onchange();assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');}
  });
  await test('canceling a pending mobile book preserves the current imported book',async()=>{
    const s=setup();await importBook(s,fixture('existing','当前本','existing-seed'));enableSystemSave(s);await preparePortable(s);s.get('portable-cancel').onclick();assert.equal(s.get('book-selected-name').textContent,'当前本');assert.equal(s.get('book-list').children.length,1);
  });
  await test('picker security failures can offer explicit system saving; picker cancellation cannot',async()=>{
    for(const errorName of ['SecurityError','NotSupportedError','AbortError']){const s=setup();enableSystemSave(s);s.window.showSaveFilePicker=async()=>{throw Object.assign(Error('picker unavailable'),{name:errorName});};await s.get('new-book').onclick();assert.equal(s.get('portable-dialog').open,errorName!=='AbortError');assert(!s.calls.some(c=>c[0]==='create'));assert.equal(s.downloads.length,0);}
  });
  await test('late system-sheet completion cannot resurrect a closed page or an unsaved book',async()=>{
    const s=setup(),d=deferred();enableSystemSave(s,{share:()=>d.promise});await preparePortable(s);const pending=s.get('portable-share').onclick();s.events.pagehide();d.resolve();await pending;assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert(!s.get('portable-dialog').open);assert.equal(s.get('portable-name').value,'');assert.equal(s.get('status').textContent,'');assert.equal(s.storage.size,0);
  });
  await test('closing a page while preparing a mobile book discards the late result',async()=>{
    const s=setup(),d=deferred();enableSystemSave(s);s.API.Book.create=()=>d.promise;s.get('new-book').onclick();const pending=s.get('portable-prepare').onclick();s.events.pagehide();d.resolve(s.engine(JSON.parse(fixture())));await pending;assert(!s.get('portable-dialog').open);assert.equal(s.get('portable-name').value,'');assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert(s.calls.some(c=>c[0]==='destroy'));
  });
  await test('wrong book is reported without switching books automatically',async()=>{const s=setup();await importBook(s);s.get('input').value='CIPHER:other:原文';await s.get('decode').onclick();assert.equal(s.get('status').textContent,'密码本错误');assert.equal(s.get('book-selected-name').textContent,'测试本');assert.equal(s.get('output').value,'');});
  await test('copy confirmation lasts exactly one second',async()=>{const s=setup();s.get('output').value='结果';await s.get('copy').onclick();assert(!s.get('copy-toast').classList.contains('hidden'));const t=[...s.timers.values()][0];assert.equal(t.ms,1000);t.fn();assert(s.get('copy-toast').classList.contains('hidden'));});
  await test('text save uses a synchronous picker and preserves captured text',async()=>{const s=setup(),h=handle('密文.txt'),d=deferred();s.get('output').value='结果';s.window.showSaveFilePicker=()=>{s.calls.push(['picker']);return d.promise;};const pending=s.get('download-text').onclick();assert.deepEqual(s.calls,[['picker']]);s.get('output').value='其他';d.resolve(h);await pending;assert.equal(h.raw,'结果');assert.equal(s.downloads.length,0);});
  await test('unsupported text saving requires explicit confirmation and keeps cancel harmless',async()=>{const s=setup();s.get('output').value='结果';s.get('download-text').onclick();assert(s.get('save-dialog').open);assert.equal(s.downloads.length,0);s.get('cancel-save').onclick();s.get('save-download').onclick();assert.equal(s.downloads.length,0);s.get('download-text').onclick();s.get('save-download').onclick();assert.equal(s.downloads.length,1);assert.equal(await s.downloads[0].blob.text(),'结果');});
  await test('legacy books are isolated and clearing requires every saved file to be verified',async()=>{
    const snapshot=JSON.stringify({v:1,files:[fixture(),fixture('second','二号本','other-seed')]}),s=setup({legacy:snapshot});await tick();assert(s.get('legacy-dialog').open);assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert(s.get('legacy-clear').disabled);s.get('legacy-clear').onclick();assert.equal(s.storage.get(LEGACY),snapshot);
    let h=handle('测试本.itbook');s.window.showSaveFilePicker=async()=>h;await legacyButtons(s)[0].onclick();assert.equal(h.raw,fixture());assert(s.get('legacy-clear').disabled);s.get('legacy-clear').onclick();assert.equal(s.storage.get(LEGACY),snapshot);
    h=handle('二号本.itbook');await legacyButtons(s,1)[0].onclick();assert(!s.get('legacy-clear').disabled);s.get('legacy-clear').onclick();assert.equal(s.storage.has(LEGACY),false);assert.equal(s.calls.filter(c=>c[0]==='remove').length,1);assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');
  });
  await test('legacy migration cancellation and save failures leave the original records intact',async()=>{for(const fail of [false,true]){const snapshot=JSON.stringify({v:1,files:[fixture()]}),s=setup({legacy:snapshot});await tick();const h=handle('测试本.itbook','',{failWrite:fail});s.window.showSaveFilePicker=async()=>{if(!fail)throw Object.assign(Error('cancel'),{name:'AbortError'});return h;};await legacyButtons(s)[0].onclick();assert(s.get('legacy-clear').disabled);s.get('legacy-clear').onclick();assert.equal(s.storage.get(LEGACY),snapshot);}});
  await test('legacy fallback download alone cannot authorize clearing; imported backup must match',async()=>{
    const snapshot=JSON.stringify({v:1,files:[fixture()]}),s=setup({legacy:snapshot});await tick();legacyButtons(s)[0].onclick();assert(s.get('save-dialog').open);assert.equal(s.downloads.length,0);s.get('save-download').onclick();assert.equal(s.downloads.length,1);assert(s.get('legacy-clear').disabled);
    legacyButtons(s)[1].onclick();s.get('legacy-file').files=[file(fixture('wrong'))];await s.get('legacy-file').onchange();assert(s.get('legacy-clear').disabled);assert.match(s.get('status').textContent,/不一致/);
    legacyButtons(s)[1].onclick();s.get('legacy-file').files=[file(fixture())];await s.get('legacy-file').onchange();assert(!s.get('legacy-clear').disabled);s.get('legacy-clear').onclick();assert(!s.storage.has(LEGACY));
  });
  await test('changed legacy snapshot and malformed legacy data are never deleted',async()=>{
    const snapshot=JSON.stringify({v:1,files:[fixture()]}),s=setup({legacy:snapshot});await tick();legacyButtons(s)[1].onclick();s.get('legacy-file').files=[file(fixture())];await s.get('legacy-file').onchange();s.storage.set(LEGACY,'changed');s.get('legacy-clear').onclick();assert.equal(s.storage.get(LEGACY),'changed');assert.match(s.get('status').textContent,/其他页面修改/);
    const bad=setup({legacy:'invalid'});await tick();assert.equal(bad.storage.get(LEGACY),'invalid');assert.equal(bad.get('book-selected-name').textContent,'尚未选择密码本');assert.match(bad.get('status').textContent,/无法读取/);
  });
  await test('page closure clears active engines, handles and text; returning requires import again',async()=>{const s=setup();await importBook(s);s.get('input').value='敏感测试文字';s.get('output').value='测试结果';s.events.pagehide();assert.equal(s.get('input').value,'');assert.equal(s.get('output').value,'');assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert(s.calls.some(c=>c[0]==='destroy'));s.events.pageshow({persisted:true});await tick();assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');});
  await test('late asynchronous imports or encryption cannot revive closed-page state',async()=>{
    const d=deferred(),s=setup({restore:()=>d.promise});const pending=importBook(s);await tick();s.events.pagehide();d.resolve(s.engine(JSON.parse(fixture())));await pending;assert.equal(s.get('book-selected-name').textContent,'尚未选择密码本');assert(s.calls.some(c=>c[0]==='destroy'));
    const result=deferred(),t=setup({encode:()=>result.promise});await importBook(t);t.get('input').value='原文';const running=t.get('encode').onclick();await tick();t.events.pagehide();result.resolve('敏感测试结果');await running;assert.equal(t.get('output').value,'');assert.equal(t.get('status').textContent,'');
  });
  await test('denied browser storage access never blocks manual import or encryption',async()=>{const s=setup({storageDenied:true});await importBook(s);s.get('input').value='文字';await s.get('encode').onclick();assert.equal(s.get('status').textContent,'加密完成');});
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'DOM IDs must be unique');
  assert(!/localStorage\.setItem|sessionStorage|indexedDB|fetch\(/.test(script));assert(!/on?scroll|requestAnimationFrame|setInterval/.test(script));
  assert(!html.includes('placeholder='));assert(!html.includes('export-book'));assert(!html.includes('转译'));assert(!html.includes('。'));
  assert.match(html,/font-family:"SimSun","宋体","Songti SC"/);assert.match(html,/line-height:21px/);assert.match(html,/padding:3px 8px/);
  console.log(JSON.stringify({passed,sessionOnly:true,noAutomaticBookDownload:true,mobileRequiresSavedFileVerification:true,legacyClearedOnlyAfterVerification:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
