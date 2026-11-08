'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{webcrypto,createHash}=require('node:crypto');
const root=path.resolve(__dirname),dir=path.join(root,'dist'),html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const allowed=['.nojekyll','2','apple-touch-icon.png','icon-192.png','icon-512.png','index.html','manifest.webmanifest','sw.js'].sort();
assert.deepEqual(fs.readdirSync(dir).sort(),allowed);
for(const tag of ['script','style'])for(const match of html.matchAll(new RegExp('<'+tag+'[^>]*>([\\s\\S]*?)</'+tag+'>','g'))){assert(html.includes("'sha256-"+createHash('sha256').update(match[1]).digest('base64')+"'"));if(tag==='script')new vm.Script(match[1]);}
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.webmanifest'),'utf8'));assert.equal(manifest.name,'密电机');assert.equal(manifest.scope,'./');assert.equal(manifest.display,'standalone');
const worker=fs.readFileSync(path.join(dir,'sw.js'),'utf8');new vm.Script(worker);assert(worker.includes("request.mode==='navigate'"));assert(html.includes("connect-src 'none'"));
const source=html.match(/<script id="translator-core">([\s\S]*?)<\/script>/)[1];
const context=vm.createContext({crypto:webcrypto,TextEncoder,btoa,atob,Uint8Array,Uint32Array,DataView,BigInt});vm.runInContext(source+';globalThis.api=InformationTranslator',context);
(async()=>{
  const book=await context.api.Book.create(),raw=await book.export('发布检查'),restored=await context.api.Book.restore(raw),other=await context.api.Book.create();
  const text='发布检查：简體𠮷 English 123 👋\n第二行';const cipher=await book.encode(text);
  assert.equal(await restored.decode(cipher),text);assert(!cipher.includes('.'));assert.notEqual(await book.encode(text),cipher);
  await assert.rejects(()=>other.decode(cipher),{message:'密码本错误'});await assert.rejects(()=>restored.decode(cipher.slice(0,-8)));
  const max='𠮷'.repeat(20000);assert.equal(await restored.decode(await book.encode(max)),max);
  book.destroy();restored.destroy();other.destroy();
  console.log('PASS release files, script syntax, CSP, phone manifest, encryption round trip, wrong book, truncation, maximum length');
})().catch(error=>{console.error(error);process.exitCode=1;});
