const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/source.html','utf8');
const app=[...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][1][1];
function setup(){
  const elements=new Map(),timers=new Map(),events=[],writes=[],downloads=[],blobs=new Map();let sequence=0;
  function element(id=''){
    const classes=new Set();return {id,value:'',textContent:'',className:'',disabled:false,dataset:{},files:[],
      classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,force)=>{const add=force===undefined?!classes.has(x):force;add?classes.add(x):classes.delete(x);return add;}},
      replaceChildren(){},querySelectorAll(){return [];},append(){},remove(){},setAttribute(){},addEventListener(){},contains(){return false;},
      focus(){events.push('focus:'+id);},select(){events.push('select:'+id);},click(){events.push('click:'+id);if(this.download)downloads.push({name:this.download,blob:blobs.get(this.href)});},showModal(){this.open=true;},close(){this.open=false;this.onclose?.();}};
  }
  const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
  get('copy-toast').classList.add('hidden');
  const document={getElementById:get,createElement:()=>element(),querySelectorAll:()=>[...elements.values()],addEventListener(){},body:{append(){}},execCommand:()=>false};
  const window={addEventListener(){}};
  const navigator={clipboard:{writeText:async text=>writes.push(text)}};
  const file={id:'test-book',name:'测试本',seed:'fixture'};
  const book={id:file.id,export:async()=>JSON.stringify(file),destroy(){},encode:async()=> 'CIPHER',decode:async()=> '解密后的文字'};
  const API={supported:()=>true,isMessage:async text=>text==='CIPHER',Book:{create:async()=>book,restore:async()=>book,readFile:async raw=>JSON.parse(raw)}};
  const File=globalThis.File||require('node:buffer').File;
  class FileReader{readAsText(file){this.result=file.fixture;this.onload();}}
  const url={createObjectURL:blob=>{const id='blob:test-'+(++sequence);blobs.set(id,blob);return id;},revokeObjectURL:id=>blobs.delete(id)};
  const ctx=vm.createContext({document,window,navigator,InformationTranslator:API,Blob,File,FileReader,URL:url,console,
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    requestAnimationFrame:fn=>queueMicrotask(fn),setTimeout:(fn,ms)=>{if(ms===0){queueMicrotask(fn);return 0;}const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(app,ctx);return {get,window,navigator,document,events,writes,timers,downloads};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
  await test('copy shows confirmation for exactly one second without replacing the result status',async()=>{
    const s=setup();s.get('output').value='待复制的密文';s.get('status').textContent='加密完成';
    await s.get('copy').onclick();assert.deepEqual(s.writes,['待复制的密文']);assert(!s.get('copy-toast').classList.contains('hidden'));
    assert.equal(s.get('status').textContent,'加密完成');const timer=[...s.timers.values()][0];assert.equal(timer.ms,1000);timer.fn();assert(s.get('copy-toast').classList.contains('hidden'));
  });
  await test('copying again restarts the one-second confirmation',async()=>{
    const s=setup();s.get('output').value='text';await s.get('copy').onclick();const first=[...s.timers.keys()][0];await s.get('copy').onclick();assert(!s.timers.has(first));assert.equal(s.timers.size,1);
  });
  await test('copy fallback confirms only successful copying',async()=>{
    const s=setup();s.get('output').value='text';s.navigator.clipboard=undefined;s.document.execCommand=()=>true;
    await s.get('copy').onclick();assert(!s.get('copy-toast').classList.contains('hidden'));assert.deepEqual(s.events,['focus:output','select:output']);
  });
  await test('clipboard failure gives manual-copy instructions without a false confirmation',async()=>{
    const s=setup();s.get('output').value='text';s.navigator.clipboard.writeText=async()=>{throw Error('denied');};await s.get('copy').onclick();assert(s.get('copy-toast').classList.contains('hidden'));assert.match(s.get('status').textContent,/系统复制/);
  });
  await test('saving opens picker immediately, captures the result, and waits for writing to finish',async()=>{
    const s=setup();s.get('output').value='密文\n原样保存';let resolvePicker,options;const calls=[];
    s.window.showSaveFilePicker=opts=>{options=opts;calls.push('picker');return new Promise(resolve=>resolvePicker=resolve);};
    const pending=s.get('download-text').onclick();assert.deepEqual(calls,['picker']);assert(s.get('download-text').disabled);
    await s.get('download-text').onclick();assert.equal(calls.length,1);s.get('output').value='新结果';
    resolvePicker({createWritable:async()=>({write:async blob=>{calls.push('write');assert.equal(await blob.text(),'密文\n原样保存');},close:async()=>calls.push('close')})});
    await pending;assert.deepEqual(calls,['picker','write','close']);assert.equal(options.suggestedName,'加密内容.txt');assert.deepEqual([...options.types[0].accept['text/plain']],['.txt']);assert.equal(s.get('status').textContent,'文本已保存');assert(!s.get('download-text').disabled);assert.deepEqual(s.events,[]);
  });
  await test('canceling location selection does not write or start an automatic download',async()=>{
    const s=setup();s.get('output').value='text';s.get('status').textContent='加密完成';s.window.showSaveFilePicker=async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'});};await s.get('download-text').onclick();assert.equal(s.get('status').textContent,'加密完成');assert(!s.get('download-text').disabled);assert.deepEqual(s.events,[]);
  });
  await test('Safari-style capability set opens a save panel without automatically downloading',async()=>{
    const s=setup();s.get('output').value='text';await s.get('download-text').onclick();assert(s.get('save-dialog').open);assert(s.get('share-file').classList.contains('hidden'));assert.equal(s.get('save-name').value,'加密内容.txt');assert.equal(s.downloads.length,0);
  });
  await test('confirming a filename downloads the captured text and appends the text extension',async()=>{
    const s=setup();s.get('output').value='密文\n保留原样';await s.get('download-text').onclick();s.get('output').value='新内容';s.get('save-name').value='自定名称';s.get('save-download').onclick();assert(!s.get('save-dialog').open);assert.equal(s.downloads[0].name,'自定名称.txt');assert.equal(await s.downloads[0].blob.text(),'密文\n保留原样');
  });
  await test('canceling the fallback save panel never downloads text',async()=>{
    const s=setup();s.get('output').value='text';await s.get('download-text').onclick();s.get('cancel-save').onclick();assert(!s.get('save-dialog').open);s.get('save-download').onclick();assert.equal(s.downloads.length,0);
  });
  await test('invalid fallback filename leaves the panel open without downloading',async()=>{
    const s=setup();s.get('output').value='text';await s.get('download-text').onclick();s.get('save-name').value='../wrong';s.get('save-download').onclick();assert(s.get('save-dialog').open);assert.equal(s.downloads.length,0);assert.match(s.get('save-description').textContent,/有效的文件名/);
  });
  await test('Web Share capable browsers hand a named text file to the system menu',async()=>{
    const s=setup();s.get('output').value='可保存的密文';s.navigator.canShare=({files})=>files[0].type==='text/plain';let shared;
    s.navigator.share=async data=>shared=data;await s.get('download-text').onclick();assert(!s.get('share-file').classList.contains('hidden'));assert.equal(shared,undefined);s.get('save-name').value='我的文本';await s.get('share-file').onclick();assert.equal(shared.files[0].name,'我的文本.txt');assert.equal(await shared.files[0].text(),'可保存的密文');assert(!s.get('save-dialog').open);assert.equal(s.downloads.length,0);
  });
  await test('canceling the system share menu keeps the text available and does not download',async()=>{
    const s=setup();s.get('output').value='text';s.navigator.canShare=()=>true;s.navigator.share=async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'});};
    await s.get('download-text').onclick();await s.get('share-file').onclick();assert(s.get('save-dialog').open);assert(!s.get('share-file').disabled);assert.equal(s.downloads.length,0);
  });
  await test('a broken canShare implementation still permits explicit downloading',async()=>{
    const s=setup();s.get('output').value='text';s.navigator.share=async()=>{};s.navigator.canShare=()=>{throw Error('unsupported type');};await s.get('download-text').onclick();assert(s.get('share-file').classList.contains('hidden'));s.get('save-download').onclick();assert.equal(s.downloads.length,1);
  });
  await test('file-reader fallback imports a book without File.text support',async()=>{
    const s=setup();s.get('book-file').files=[{size:100,fixture:JSON.stringify({id:'test-book',name:'测试本',seed:'fixture'})}];s.get('book-file').onchange();await new Promise(setImmediate);assert.equal(s.get('book-selected-name').textContent,'测试本');assert.match(s.get('status').textContent,/已载入/);
  });
  await test('write failures abort the stream and do not report successful saving',async()=>{
    const s=setup();s.get('output').value='text';let aborted=false;
    s.window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async()=>{throw Error('disk full');},abort:async()=>{aborted=true;}})});
    await s.get('download-text').onclick();assert(aborted);assert.match(s.get('status').textContent,/无法保存/);assert(!s.get('download-text').disabled);
  });
  await test('decrypted text is saved with the appropriate suggested filename',async()=>{
    const s=setup();await s.get('new-book').onclick();s.get('input').value='CIPHER';await s.get('decode').onclick();let options,contents;
    s.window.showSaveFilePicker=async opts=>{options=opts;return {createWritable:async()=>({write:async blob=>contents=await blob.text(),close:async()=>{}})};};
    await s.get('download-text').onclick();assert.equal(options.suggestedName,'解密文字.txt');assert.equal(contents,'解密后的文字');
  });
  await test('encryption completion uses only the requested short message',async()=>{
    const s=setup();await s.get('new-book').onclick();s.get('input').value='原文';await s.get('encode').onclick();assert.equal(s.get('status').textContent,'加密完成');
  });

  await test('book export opens the native picker synchronously and saves an importable unchanged book',async()=>{
    const s=setup();await s.get('new-book').onclick();let options,finish;const calls=[];
    s.window.showSaveFilePicker=opts=>{options=opts;calls.push('picker');return new Promise(resolve=>finish=resolve);};
    const pending=s.get('export-book').onclick();assert.deepEqual(calls,['picker']);assert(s.get('export-book').disabled);
    await s.get('export-book').onclick();assert.equal(calls.length,1);
    finish({createWritable:async()=>({write:async blob=>{calls.push('write');assert.equal(blob.type,'application/json;charset=utf-8');assert.deepEqual(JSON.parse(await blob.text()),{id:'test-book',name:'测试本',seed:'fixture'});},close:async()=>calls.push('close')})});
    await pending;assert.deepEqual(calls,['picker','write','close']);assert.equal(options.suggestedName,'测试本.itbook');assert.deepEqual([...options.types[0].accept['application/json']],['.itbook']);assert.equal(s.get('status').textContent,'密码本已保存');assert(!s.get('export-book').disabled);assert.equal(s.downloads.length,0);
  });
  await test('canceling a book export preserves the book and does not download',async()=>{
    const s=setup();await s.get('new-book').onclick();const previous=s.get('status').textContent;
    s.window.showSaveFilePicker=async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'});};await s.get('export-book').onclick();assert.equal(s.get('status').textContent,previous);assert.equal(s.get('book-selected-name').textContent,'测试本');assert(!s.get('export-book').disabled);assert.equal(s.downloads.length,0);
  });
  await test('book write failure aborts and keeps retry available without false success',async()=>{
    const s=setup();await s.get('new-book').onclick();let aborted=false;
    s.window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async()=>{throw Error('full');},abort:async()=>aborted=true})});
    await s.get('export-book').onclick();assert(aborted);assert.match(s.get('status').textContent,/无法保存密码本/);assert(!s.get('export-book').disabled);assert.equal(s.downloads.length,0);
  });
  await test('unsupported native saving opens a book save panel without downloading',async()=>{
    const s=setup();await s.get('new-book').onclick();await s.get('export-book').onclick();assert(s.get('save-dialog').open);assert.equal(s.get('save-title').textContent,'导出密码本');assert.equal(s.get('save-name').value,'测试本.itbook');assert.equal(s.downloads.length,0);s.get('cancel-save').onclick();s.get('save-download').onclick();assert.equal(s.downloads.length,0);assert.equal(s.events.at(-1),'focus:export-book');
  });
  await test('an explicitly confirmed fallback export preserves its extension, MIME type and book data',async()=>{
    const s=setup();await s.get('new-book').onclick();await s.get('export-book').onclick();s.get('save-name').value='我的密码本';s.get('save-download').onclick();assert.equal(s.downloads[0].name,'我的密码本.itbook');assert.equal(s.downloads[0].blob.type,'application/json');assert.deepEqual(JSON.parse(await s.downloads[0].blob.text()),{id:'test-book',name:'测试本',seed:'fixture'});
  });
  await test('invalid book filenames keep the save panel open without downloading',async()=>{
    const s=setup();await s.get('new-book').onclick();await s.get('export-book').onclick();s.get('save-name').value='../invalid';s.get('save-download').onclick();assert(s.get('save-dialog').open);assert.equal(s.downloads.length,0);assert.match(s.get('save-description').textContent,/有效的文件名/);
  });
  await test('book system sharing uses a named JSON file and never automatically downloads',async()=>{
    const s=setup();await s.get('new-book').onclick();let shared;s.navigator.canShare=({files})=>files[0].type==='application/json';s.navigator.share=async data=>shared=data;
    await s.get('export-book').onclick();assert(!s.get('share-file').classList.contains('hidden'));s.get('save-name').value='自定义.ITBOOK';await s.get('share-file').onclick();assert.equal(shared.files[0].name,'自定义.ITBOOK');assert.equal(shared.files[0].type,'application/json');assert.equal(JSON.parse(await shared.files[0].text()).seed,'fixture');assert.equal(s.downloads.length,0);
  });
  await test('blocked native pickers offer explicit saving without starting a download',async()=>{
    const s=setup();await s.get('new-book').onclick();s.window.showSaveFilePicker=async()=>{throw Object.assign(Error('blocked'),{name:'SecurityError'});};await s.get('export-book').onclick();assert(s.get('save-dialog').open);assert.equal(s.downloads.length,0);assert(!s.get('export-book').disabled);
  });
  await test('book save state never leaks into subsequent text saving',async()=>{
    const s=setup();await s.get('new-book').onclick();await s.get('export-book').onclick();s.get('cancel-save').onclick();s.get('output').value='text';await s.get('download-text').onclick();assert.equal(s.get('save-title').textContent,'保存文本');s.get('save-name').value='新文本';s.get('save-download').onclick();assert.equal(s.downloads[0].name,'新文本.txt');assert.equal(s.downloads[0].blob.type,'text/plain');assert.equal(await s.downloads[0].blob.text(),'text');
  });

  const html=source;
  assert(!html.includes('转译'));assert(html.includes('id="encode">信息加密</button>'));assert(html.includes('id="decode">密文翻译</button>'));
  assert(html.includes('<h1>密电机</h1>'));assert(!html.match(/<input[^>]*id="book-file"[^>]*>/)[0].includes('accept='));assert(!html.includes('。'));
  console.log(JSON.stringify({passed,visibleTerminologyUpdated:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
