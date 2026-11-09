'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{webcrypto,createHash,hkdfSync,createHmac,createCipheriv,createDecipheriv}=require('node:crypto'),zlib=require('node:zlib');
const root=__dirname,dir=path.join(root,'dist/lite');
const two=fs.readFileSync(path.join(dir,'index.html'),'utf8'),one=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
assert.deepEqual(fs.readdirSync(dir).sort(),['.nojekyll','apple-touch-icon.png','icon-192.png','icon-512.png','index.html','manifest.webmanifest','sw.js'].sort());
for(const file of ['source2.html','dist/lite/index.html']){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 for(const tag of ['script','style'])for(const m of html.matchAll(new RegExp('<'+tag+'[^>]*>([\\s\\S]*?)</'+tag+'>','g'))){assert(html.includes("'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'"));if(tag==='script')new vm.Script(m[1]);}
}
assert(two.includes('<h1>密电机 Lite</h1>'));assert(one.includes('<h1>密电机</h1>'));assert(!one.includes('function liteDecimal('));assert(two.includes('<span>娱乐用途</span>'));
assert.equal(two.match(/<div class="help-body">([\s\S]*?)<\/div><\/details>/)[1],one.match(/<div class="help-body">([\s\S]*?)<\/div><\/details>/)[1]);
assert(two.includes("STORAGE_KEY='information-translator.books2'"));assert(!one.includes('localStorage.setItem'));
assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'manifest.webmanifest'))).name,'密电机 Lite');
function api(html,codec=false){
 let core=html.match(/<script id="translator-core">([\s\S]*?)<\/script>/)[1];
 if(codec)core=core.replace('return {Book,COUNT,MAX_CHARS','globalThis.codec={decimal,undecimal,shortDecimal,unshortDecimal,liteDecimal,unliteDecimal};return {Book,COUNT,MAX_CHARS');
 const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,btoa,atob,Uint8Array,Uint32Array,DataView,BigInt});vm.runInContext(core+';globalThis.api=InformationTranslator',context);return context;
}
const a=api(one),b=api(two,true);
// Public, synthetic fixtures: never use these published test seeds for real messages.
const legacy3={"raw":"{\n  \"format\": \"INFO-TRANSLATOR-BOOK\",\n  \"v\": 1,\n  \"name\": \"公开测试用密码本，不用于真实消息\",\n  \"id\": \"cac60d623f67ecdf\",\n  \"seed\": \"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA\",\n  \"checksum\": \"d912af2b674e32fda950373b08a53dbb8c9cd45f8ef557c4ab644391e130817c\"\n}","text":"旧格式兼容测试：𠮷 Hello 123\n第二行","cipher":"04748591725451639162184315175906247264451541845267520133894426070551630099748066298313809423908618800363714304333670127123063522876303358290176634309322732651486014626680315373576541039182784618816011372002247039760120964747856456347054829228933406502824525218195533279222036359201642012316115523823452608076942961555264133"};
const legacy4={"text":"旧数字密文兼容：你好𠮷 English 123\n第二行","cipher":"067676223719195122191322802451010825428848037003531122758232043212141505972397710055025411503641091704355244200026949436350391410109039396751902527815456680098951212640760905221886390040189845411443222581639373538413893104958321800"};
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 await test('decimal encoding preserves leading zeroes and every byte at block boundaries',async()=>{
  for(const n of [13,14,15,16,31,32,63,64,65,127,128,129,1025,52513]){const bytes=new Uint8Array(n);webcrypto.getRandomValues(bytes);bytes[0]=0;bytes[1]=0;const digits=b.codec.liteDecimal(bytes);assert(/^\d+$/.test(digits));assert.equal(digits.length%5,0);assert.deepEqual(b.codec.unliteDecimal(digits),bytes);}
  for(const n of [1,2,3,36,37,38,52536]){const bytes=new Uint8Array(n);webcrypto.getRandomValues(bytes);assert.deepEqual(b.codec.unshortDecimal(b.codec.shortDecimal(bytes)),bytes);}
  for(const bad of ['','5','000005','１２３４５','1e255','9'.repeat(155)+'645','0'.repeat(50)+'005'])assert.throws(()=>b.codec.unliteDecimal(bad));
 });
 const original=await a.api.Book.create(),raw=await original.export('公开兼容性测试'),book=await b.api.Book.restore(raw),restored=await b.api.Book.restore(raw),other=await b.api.Book.create();
 await test('old v2/v3/v4 numbers and original ciphertext still decrypt with unchanged book files',async()=>{
  const legacyBook=await b.api.Book.restore(legacy3.raw);assert.equal(await legacyBook.decode(legacy3.cipher),legacy3.text);assert.equal(await legacyBook.decode(legacy4.cipher),legacy4.text);legacyBook.destroy();
  for(let i=0;i<30;i++){const text='原版兼容 '+i+' 𠮷',cipher=await original.encode(text);assert.equal(await book.decode(cipher),text);assert.equal(await book.decode(b.codec.decimal(Uint8Array.from(Buffer.from(cipher,'base64url')))),text);}
 });
 await test('new numbers round-trip all scripts, zeroes, BOM, newlines and combining marks; wrong book and modifications fail',async()=>{
  const samples=['中文简体與繁體','English words 0123456789','𠮷𠀀👨‍👩‍👧‍👦 e\u0301\n换行\t空格','000001234567890','a','\uFEFFabc','\0\uFEFF你好\r\n','𠮷'.repeat(23),'12345'.repeat(30)];
  for(const text of samples){const cipher=await book.encode(text);assert(/^\d+$/.test(cipher));assert.equal(b.api.inspect(cipher).version,5);assert.equal(await restored.decode(cipher),text);assert.equal(await book.decode(cipher.match(/.{1,17}/g).join(' \n')),text);assert(await b.api.isMessage(cipher,book));assert(!await b.api.isMessage(cipher));assert.notEqual(await book.encode(text),cipher);await assert.rejects(()=>other.decode(cipher));
   for(const removed of [1,2,5])await assert.rejects(()=>book.decode(cipher.slice(0,-removed)));
   const packet=b.api.inspect(cipher).packet;packet[8]^=1;await assert.rejects(()=>book.decode(b.codec.liteDecimal(packet)),{message:'内容不完整或已被改动，请重新复制完整内容'});
  }
  assert(!await b.api.isMessage('0'.repeat(52)+'135',book));assert(!await b.api.isMessage('12345678901234567890',book));
 });
 const seed=Buffer.from(JSON.parse(raw).seed,'base64url');
 const material=nonce=>Buffer.from(hkdfSync('sha256',seed,nonce,Buffer.from('INFO-TRANSLATOR/LITE/5/KEYS'),48));
 const mac=(key,domain,data,size)=>createHmac('sha256',key).update('INFO-TRANSLATOR/LITE/5/'+domain+'/').update(data).digest().subarray(0,size);
 function independentDecrypt(packet){const nonce=packet.subarray(0,6),keys=material(nonce),iv=Buffer.alloc(16);iv.set(nonce);assert.equal(keys.subarray(0,16).length*8,128);assert.deepEqual(Buffer.from(packet.subarray(6,8)),mac(keys.subarray(16),'CHECK',nonce,2));assert.deepEqual(Buffer.from(packet.subarray(-4)),mac(keys.subarray(16),'PACKET',packet.subarray(0,-4),4));const decipher=createDecipheriv('aes-128-ctr',keys.subarray(0,16),iv);return Buffer.concat([decipher.update(packet.subarray(8,-4)),decipher.final()]);}
 function authenticated(data){const nonce=Buffer.from([1,2,3,4,5,6]),keys=material(nonce),iv=Buffer.alloc(16);iv.set(nonce);const cipher=createCipheriv('aes-128-ctr',keys.subarray(0,16),iv),encrypted=Buffer.concat([cipher.update(data),cipher.final()]);const packet=Buffer.concat([nonce,mac(keys.subarray(16),'CHECK',nonce,2),encrypted]);return b.codec.liteDecimal(Buffer.concat([packet,mac(keys.subarray(16),'PACKET',packet,4)]));}
 await test('independent Node HKDF, AES-128-CTR, HMAC and DEFLATE verify the envelope',async()=>{
  for(const text of ['ASCII 123','一二三四五六七八九十','这是一段用来检查压缩的文字。'.repeat(50)]){
   const data=independentDecrypt(b.api.inspect(await book.encode(text)).packet);let bytes=data.subarray(1);const mode=data[0]&127;
   if(data[0]&128){const size=data.readUIntBE(1,3);bytes=zlib.inflateRawSync(data.subarray(4),{maxOutputLength:80000});assert.equal(bytes.length,size);}
   if(mode===0)assert.equal(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),text);else if(mode===1)assert.equal(new TextDecoder('utf-16be',{fatal:true,ignoreBOM:true}).decode(bytes),text);else assert.equal(mode,2);
  }
  const compressed=independentDecrypt(b.api.inspect(await book.encode('重复文字'.repeat(100))).packet);assert(compressed[0]&128);
  await assert.rejects(()=>book.decode(authenticated(Buffer.from([128,2,0,0,1]))),{message:'密文长度不正确'});
  await assert.rejects(()=>book.decode(authenticated(Buffer.from([128,0,0,10,255]))));
  await assert.rejects(()=>book.decode(authenticated(Buffer.concat([Buffer.from([128,0,0,1]),zlib.deflateRawSync(Buffer.alloc(1000,65))]))));
  await assert.rejects(()=>book.decode(authenticated(Buffer.from([3,1,2,3]))));
 });
 await test('all ciphertext and authentication bytes reject tampering before plaintext is used',async()=>{
  const packet=b.api.inspect(await book.encode('检查篡改认证')).packet;
  for(let i=0;i<packet.length;i++){const changed=packet.slice();changed[i]^=1;await assert.rejects(()=>book.decode(b.codec.liteDecimal(changed)));}
 });
 await test('twenty-thousand-character limits, arbitrary Unicode and compression fallback work',async()=>{
  for(let n=1;n<=40;n++){const text=Array.from({length:n},(_,i)=>String.fromCodePoint([0,1,0x20,0x7f,0xfeff,0x4e00,0x20bb7,0x10ffff][i%8])).join('');assert.equal(await book.decode(await book.encode(text)),text);}
  const mixed=Array.from({length:20000},(_,i)=>{const cp=(i*7919)%0x110000;return String.fromCodePoint(cp>=0xd800&&cp<=0xdfff?0x4e00:cp);}).join('');assert.equal(await restored.decode(await book.encode(mixed)),mixed);
  for(const text of ['a'.repeat(20000),'𠮷'.repeat(20000)]){const cipher=await book.encode(text);assert(cipher.length<2000);assert.equal(await restored.decode(cipher),text);}
  await assert.rejects(()=>book.encode('字'.repeat(20001)));await assert.rejects(()=>book.encode('\uD800'));await assert.rejects(()=>book.encode(''));
 });
 await test('fresh 48-bit random nonces change the same message each time',async()=>{
  const nonces=new Set(),messages=new Set();for(let i=0;i<100;i++){const message=await book.encode('每次随机');messages.add(message);nonces.add(Buffer.from(b.api.inspect(message).packet.subarray(0,6)).toString('hex'));}assert.equal(messages.size,100);assert.equal(nonces.size,100);
 });
 await test('measured short and repeated messages are shorter without inflating incompressible text',async()=>{
  const examples=[{text:'你好',before:101,after:45},{text:'今晚八点老地方见',before:131,after:75},{text:'明天上午十点在图书馆门口见面，带上上次讨论的资料。如果临时有变化，请提前告诉我。',before:291,after:230},{text:'周末我们去郊外走走吧，看看天气再决定出发时间。记得带水、雨伞和充电器。到时候一起吃午饭，下午再慢慢回来。'.repeat(4),before:1131,after:320}];
  for(const example of examples){const cipher=await book.encode(example.text);assert.equal(cipher.length,example.after);assert(cipher.length<example.before);assert.equal(await book.decode(cipher),example.text);}
  console.log(JSON.stringify({lengthExamples:examples.map(x=>({characters:[...x.text].length,oldDigits:x.before,newDigits:x.after}))}));
 });
 await test('original and Lite offline workers keep their navigation caches separate',async()=>{
  for(const child of [false,true]){const pathname=child?'/midianji/lite/':'/midianji/',handlers={},worker=fs.readFileSync(path.join(root,'dist',child?'lite/sw.js':'sw.js'),'utf8');vm.runInNewContext(worker,{URL,self:{location:{href:'https://example.com'+pathname+'sw.js'},addEventListener:(name,fn)=>handlers[name]=fn}});let handled=false;handlers.fetch({request:{url:'https://example.com'+pathname+'unrelated/',method:'GET',mode:'navigate'},respondWith(){handled=true;}});assert(!handled);if(!child){handlers.fetch({request:{url:'https://example.com/midianji/lite/',method:'GET',mode:'navigate'},respondWith(){handled=true;}});assert(!handled);}}
 });
 original.destroy();book.destroy();other.destroy();restored.destroy();console.log(JSON.stringify({passed,format:5,entertainment:true,legacyFormatsReadable:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
