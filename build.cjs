'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname),out=path.join(root,'dist');
const icons=['icon-192.png','icon-512.png','apple-touch-icon.png'];
const allowed=new Set(['index.html','manifest.webmanifest','sw.js','.nojekyll',...icons]);
fs.mkdirSync(out,{recursive:true});
for(const name of fs.readdirSync(out))if(!allowed.has(name))throw Error('Unexpected file in dist: '+name);
const source=fs.readFileSync(path.join(root,'source.html'),'utf8').replace(/\r\n/g,'\n');
const bootstrap=`'use strict';
(()=>{
  if(!/^https?:$/.test(location.protocol))return;
  const footer=document.querySelector('footer');
  const label=text=>{if(footer?.firstChild)footer.firstChild.textContent=text;};
  if(!('serviceWorker' in navigator)){label('当前环境不支持离线缓存');return;}
  const controlled=!!navigator.serviceWorker.controller;
  label(controlled?'可离线使用':'正在准备离线使用');
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'})
    .then(()=>navigator.serviceWorker.ready).then(()=>label('可离线使用'))
    .catch(()=>label(controlled?'可离线使用':'离线准备未完成'));
})();`;
const manifest={id:'./',name:'密电机',short_name:'密电机',lang:'zh-CN',start_url:'./',scope:'./',display:'standalone',background_color:'#f5f6f8',theme_color:'#465f85',icons:[{src:'icon-192.png',sizes:'192x192',type:'image/png',purpose:'any maskable'},{src:'icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]};
const manifestText=JSON.stringify(manifest,null,2);
let html=source.replace('</head>','<meta name="theme-color" content="#465f85"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="密电机"><link rel="manifest" href="./manifest.webmanifest"><link rel="apple-touch-icon" href="./apple-touch-icon.png">\n</head>')
  .replace('</body>','<script>'+bootstrap+'</script>\n</body>');
const hashes=tag=>[...html.matchAll(new RegExp('<'+tag+'[^>]*>([\\s\\S]*?)</'+tag+'>','g'))].map(match=>"'sha256-"+createHash('sha256').update(match[1]).digest('base64')+"'").join(' ');
const csp="default-src 'none'; script-src "+hashes('script')+"; style-src "+hashes('style')+"; img-src data: 'self'; manifest-src 'self'; worker-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
html=html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/,(_,start,end)=>start+csp+end);
const digest=createHash('sha256').update(html).update(manifestText);
for(const icon of icons)digest.update(fs.readFileSync(path.join(root,icon)));
const version=digest.digest('hex').slice(0,16);
const worker=`'use strict';
const BASE=new URL('./',self.location.href);
const PREFIX='midianji-static-'+encodeURIComponent(BASE.pathname)+'-';
const CACHE=PREFIX+'${version}';
const INDEX=new URL('index.html',BASE).href;
const ASSETS=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png'].map(path=>new URL(path,BASE).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname))return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE),controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),4000);
      try{const response=await fetch(request,{signal:controller.signal});if(response.ok){await cache.put(INDEX,response.clone());return response;}}catch{}finally{clearTimeout(timeout);}
      return await cache.match(INDEX)||new Response('离线页面尚未准备好，请联网后重试',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
    })());
  }else if(ASSETS.includes(url.href)){
    event.respondWith(caches.open(CACHE).then(cache=>cache.match(request)).then(cached=>cached||fetch(request)));
  }
});
`;
fs.writeFileSync(path.join(out,'index.html'),html);fs.writeFileSync(path.join(out,'manifest.webmanifest'),manifestText);fs.writeFileSync(path.join(out,'sw.js'),worker);fs.writeFileSync(path.join(out,'.nojekyll'),'');
for(const icon of icons)fs.copyFileSync(path.join(root,icon),path.join(out,icon));
console.log(JSON.stringify({built:'dist',version,files:fs.readdirSync(out).length}));
