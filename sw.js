const CACHE='grimorio-v2';
const FILES=['./','index.html','manifest.webmanifest','qrcode.js','icons/icon-180.png','icons/icon-192.png','icons/icon-512.png','fonts/pirata-one.woff2','fonts/im-fell-english.woff2','fonts/im-fell-english-sc.woff2'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return res}).catch(()=>caches.match('index.html'))));
});
