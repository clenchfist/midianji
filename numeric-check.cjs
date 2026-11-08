'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{webcrypto,createHash}=require('node:crypto');
const root=__dirname,dir=path.join(root,'dist/2');
const two=fs.readFileSync(path.join(dir,'index.html'),'utf8'),one=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
assert.deepEqual(fs.readdirSync(dir).sort(),['.nojekyll','apple-touch-icon.png','icon-192.png','icon-512.png','index.html','manifest.webmanifest','sw.js'].sort());
for(const file of ['source2.html','dist/2/index.html']){
  const html=fs.readFileSync(path.join(root,file),'utf8');
  for(const tag of ['script','style'])for(const m of html.matchAll(new RegExp('<'+tag+'[^>]*>([\\s\\S]*?)</'+tag+'>','g'))){assert(html.includes("'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'"));if(tag==='script')new vm.Script(m[1]);}
}
assert(two.includes('<h1>密电机2号</h1>'));assert(one.includes('<h1>密电机</h1>'));assert(!one.includes('function decimal('));
assert.equal(two.match(/<style>([\s\S]*?)<\/style>/)[1],one.match(/<style>([\s\S]*?)<\/style>/)[1]);
assert.equal(two.match(/<details[\s\S]*?<\/details>/)[0],one.match(/<details[\s\S]*?<\/details>/)[0]);
assert(two.includes("STORAGE_KEY='information-translator.books2'"));assert(one.includes("STORAGE_KEY='information-translator.books'"));
assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'manifest.webmanifest'))).name,'密电机2号');
function api(html,codec=false){
  let core=html.match(/<script id="translator-core">([\s\S]*?)<\/script>/)[1];
  if(codec)core=core.replace('return {Book,COUNT,MAX_CHARS','globalThis.codec={decimal,undecimal};return {Book,COUNT,MAX_CHARS');
  const context=vm.createContext({crypto:webcrypto,TextEncoder,btoa,atob,Uint8Array,Uint32Array,DataView,BigInt});
  vm.runInContext(core+';globalThis.api=InformationTranslator',context);return context;
}
const a=api(one),b=api(two,true);
const packet64=bytes=>Buffer.from(bytes).toString('base64url');
async function cacheChecks(){
  for(const child of [false,true]){
    const pathname=child?'/midianji/2/':'/midianji/',handlers={};
    const worker=fs.readFileSync(path.join(root,'dist',child?'2/sw.js':'sw.js'),'utf8');
    const context=vm.createContext({URL,self:{location:{href:'https://example.com'+pathname+'sw.js'},addEventListener:(name,fn)=>handlers[name]=fn}});
    vm.runInContext(worker,context);let handled=false;
    handlers.fetch({request:{url:'https://example.com'+pathname+'unrelated/',method:'GET',mode:'navigate'},respondWith(){handled=true;}});
    assert(!handled,'A worker must not cache another page as its own index');
    if(!child){handlers.fetch({request:{url:'https://example.com/midianji/2/',method:'GET',mode:'navigate'},respondWith(){handled=true;}});assert(!handled);}
  }
}
(async()=>{
  let codecCases=0;
  for(const n of [1,3,5,15,141,205,1025,60001]){
    const bytes=new Uint8Array(n);webcrypto.getRandomValues(bytes);bytes[0]=0;if(n>1)bytes[1]=0;
    const digits=b.codec.decimal(bytes);assert(/^[0-9]+$/.test(digits));assert.deepEqual(b.codec.undecimal(digits),bytes);codecCases++;
  }
  assert.equal(b.codec.decimal(Uint8Array.of(0,0,0)),'00000000');
  for(const bad of ['','1234','65536000','00000256','１２３','12.3','1e3'])assert.throws(()=>b.codec.undecimal(bad));
  const original=await a.api.Book.create(),raw=await original.export('兼容性测试'),book=await b.api.Book.restore(raw),other=await b.api.Book.create();
  const restored=await b.api.Book.restore(await book.export('再次导入'));
  for(const text of ['中文简体與繁體','English words 0123456789','𠮷𠀀👨‍👩‍👧‍👦 e\u0301\n换行\t空格','000001234567890','a']){
    const cipher=await book.encode(text);assert(/^[0-9]+$/.test(cipher));assert.equal(await restored.decode(cipher),text);
    assert.equal(b.api.inspect(cipher).version,3);
    const legacy=await original.encode(text);assert.equal(await book.decode(legacy),text,'Existing alphabetic ciphertext remains readable');
    assert.equal(await book.decode(b.codec.decimal(Uint8Array.from(Buffer.from(legacy,'base64url')))),text,'Existing numeric ciphertext remains readable');
    assert.equal(await book.decode(cipher.match(/.{1,19}/g).join(' \n')),text);
    assert(await b.api.isMessage(cipher));assert.notEqual(await book.encode(text),cipher);
    await assert.rejects(()=>other.decode(cipher),{message:'密码本错误'});
    await assert.rejects(()=>book.decode(cipher.slice(0,-1)));
    const changed=cipher.slice(0,-1)+(cipher.at(-1)==='0'?'1':'0');await assert.rejects(()=>book.decode(changed));
  }
  assert(!await b.api.isMessage('12345678901234567890'));
  const cipher=await book.encode('认证检查'),packet=b.codec.undecimal(cipher);packet[37]^=1;
  const checksum=new Uint8Array(await webcrypto.subtle.digest('SHA-256',Buffer.concat([Buffer.from('INFO-TRANSLATOR/BOOK/3/PACKET/'),Buffer.from(packet.subarray(0,-4))]))).subarray(0,4);
  packet.set(checksum,packet.length-4);
  await assert.rejects(()=>book.decode(b.codec.decimal(packet)),{message:'内容不完整或已被改动，请重新复制完整内容'});
  const max='𠮷'.repeat(20000),maxCipher=await book.encode(max);assert.equal(maxCipher.length,131403);assert.equal(await book.decode(maxCipher),max);await assert.rejects(()=>book.encode(max+'字'));
  for(let n=1;n<=40;n++){
    const text=Array.from({length:n},(_,i)=>String.fromCodePoint([0,1,0x20,0x7f,0x4e00,0x20bb7,0x10ffff][i%7])).join('');
    assert.equal(await restored.decode(await book.encode(text)),text,'Every 21-bit alignment and Unicode range must round-trip');
  }
  const mixed=Array.from({length:10000},(_,i)=>{const cp=(i*7919)%0x110000;return String.fromCodePoint(cp>=0xd800&&cp<=0xdfff?0x4e00:cp);}).join('');assert.equal(await restored.decode(await book.encode(mixed)),mixed);
  const nativePacket=b.codec.undecimal(await book.encode('AES参数检查'));
  const rootKey=await webcrypto.subtle.importKey('raw',Buffer.from(JSON.parse(raw).seed,'base64url'),'HKDF',false,['deriveKey']);
  const nativeKey=await webcrypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:nativePacket.subarray(0,16),info:Buffer.from('INFO-TRANSLATOR/BOOK/3/MESSAGE')},rootKey,{name:'AES-GCM',length:256},false,['decrypt']);
  assert.equal(nativeKey.algorithm.length,256);
  const nativeAad=Buffer.concat([Buffer.from('INFO-TRANSLATOR/BOOK/3/CONTENT/'),Buffer.from(nativePacket.subarray(0,37))]);
  const plain=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:nativePacket.subarray(16,28),additionalData:nativeAad,tagLength:128},nativeKey,nativePacket.subarray(37,-4));assert.equal(new DataView(plain).getUint32(0,false),7);
  for(let tagByte=0;tagByte<16;tagByte++){
    const damaged=nativePacket.slice();damaged[damaged.length-4-16+tagByte]^=1;
    damaged.set(new Uint8Array(await webcrypto.subtle.digest('SHA-256',Buffer.concat([Buffer.from('INFO-TRANSLATOR/BOOK/3/PACKET/'),Buffer.from(damaged.subarray(0,-4))]))).subarray(0,4),damaged.length-4);
    await assert.rejects(()=>book.decode(b.codec.decimal(damaged)),{message:'内容不完整或已被改动，请重新复制完整内容'});
  }
  const lengthExamples=[];
  for(const n of [1,10,100,1000,20000]){const message=await book.encode('文'.repeat(n)),oldBytes=77+Math.ceil((4+3*n)/64)*64;lengthExamples.push({characters:n,previousDigits:Math.floor(oldBytes/2)*5+3,newDigits:message.length});}
  console.log(JSON.stringify({lengthExamples}));
  await assert.rejects(()=>book.encode('\uD800'));
  assert.notEqual((await book.encode('随机前缀')).slice(0,40),(await book.encode('随机前缀')).slice(0,40));
  await cacheChecks();
  original.destroy();book.destroy();other.destroy();restored.destroy();
  console.log(JSON.stringify({pass:'numeric encoding, crypto authentication, book compatibility, UI preservation, 20000 characters, separate caches',codecCases,maxDigits:maxCipher.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
