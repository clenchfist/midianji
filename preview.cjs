'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(__dirname,'dist');
const allowed=new Set(['index.html','sw.js','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png']);
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const route=url.pathname==='/midianji'||url.pathname==='/midianji/'?'index.html':url.pathname.startsWith('/midianji/')?url.pathname.slice('/midianji/'.length):null;
  if(req.method!=='GET'||!allowed.has(route)){res.writeHead(404);res.end();return;}
  const type=route.endsWith('.png')?'image/png':route.endsWith('.js')?'text/javascript;charset=utf-8':route.endsWith('.webmanifest')?'application/manifest+json':'text/html;charset=utf-8';
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(path.join(dir,route)));
}).listen(5175,'127.0.0.1',()=>console.log('Preview ready: http://127.0.0.1:5175/midianji/'));
