/* Service worker de la versión dinámica.
   - Fuentes e iconos: caché primero.
   - Páginas, estilo y scripts: siempre de la red; la caché solo si no hay conexión.
   - API y WebSocket: nunca pasan por la caché. La versión clásica (/clasico/) tiene su propio service worker. */
const CACHE='grimorio-dinamico-v1';
const BASE=new URL('./',self.location).pathname;
const ESTATICOS=['estilo.css','reglas.js','jugar.js','director.js','qrcode.js','manifest-jugar.webmanifest','manifest-director.webmanifest','icons/icon-180.png','icons/icon-192.png','icons/icon-512.png','fonts/pirata-one.woff2','fonts/im-fell-english.woff2','fonts/im-fell-english-sc.woff2'];
const PAGINAS=['','jugar','director'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ESTATICOS.concat(PAGINAS))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('grimorio-dinamico-')&&x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE))return;
  const rel=url.pathname.slice(BASE.length);
  if(rel.startsWith('api/')||rel.startsWith('ws/')||rel.startsWith('clasico')||rel==='sw.js')return;
  /* Fuentes e iconos: caché primero (no cambian). Todo lo demás: red primero, caché si no hay conexión,
     para que una actualización del servidor llegue siempre a la vez a páginas y scripts. */
  if(/\.(woff2|png)$/.test(rel)){e.respondWith(caches.match(req).then(hit=>hit||fetch(req)));return}
  const clave=PAGINAS.includes(rel)?BASE+rel:req;
  e.respondWith(fetch(req).then(res=>{if(res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(clave,cp))}return res})
    .catch(()=>caches.match(clave).then(r=>r||new Response('Sin conexión',{status:503,headers:{'content-type':'text/plain; charset=utf-8'}}))));
});
