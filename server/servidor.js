'use strict';
/* Grimorio de Medianoche · servidor dinámico (Fastify + ws).
   Una única partida activa. /director (PIN) y /jugar (sin cuenta).
   Todas las rutas son relativas: la app no sabe si está en /grimorio/ o en la raíz de un subdominio. */
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const Fastify=require('fastify');
const {WebSocketServer}=require('ws');
const {Estado}=require('./estado.js');
const {crearResolutor}=require('./ip.js');

const RAIZ=path.join(__dirname,'..');
const WEB=path.join(RAIZ,'web');
const COOKIE='grimorio_director';
const MAX_FALLOS=5,VENTANA_FALLOS=10*60*1000,BLOQUEO=10*60*1000;

const TIPOS={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.md':'text/plain; charset=utf-8'};
const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function crearServidor(op={}){
  const pin=String(op.pin||'');
  if(!/^\S{4,64}$/.test(pin))throw new Error('Configura GRIMORIO_PIN (4 a 64 caracteres, sin espacios)');
  const hashPin=crypto.createHash('sha256').update(pin).digest();
  const estado=op.estado||new Estado(op.archivo);
  const ipCliente=crearResolutor(op.ipsTunel);
  const urlJugadores=op.urlJugadores||'';
  const log=op.log!==undefined?op.log:{level:'warn'};

  const app=Fastify({logger:log,bodyLimit:16*1024,trustProxy:false});

  /* ---------- Archivos estáticos (lista cerrada: nunca se sirve server/, datos ni .git) ---------- */
  function lista(dir,prefijo,filtro){
    const m=new Map();
    try{for(const f of fs.readdirSync(dir)){const ruta=path.join(dir,f);if(fs.statSync(ruta).isFile()&&(!filtro||filtro(f)))m.set(prefijo+f,ruta)}}catch(e){}
    return m;
  }
  const NUEVA=new Map([...lista(WEB,'/',f=>!f.endsWith('.html')),...lista(path.join(RAIZ,'fonts'),'/fonts/'),...lista(path.join(RAIZ,'icons'),'/icons/'),['/qrcode.js',path.join(RAIZ,'qrcode.js')]]);
  const CLASICA=new Map([
    ['/clasico/',path.join(RAIZ,'index.html')],
    ...['index.html','sw.js','manifest.webmanifest','qrcode.js','icon.svg'].map(f=>['/clasico/'+f,path.join(RAIZ,f)]),
    ...lista(path.join(RAIZ,'fonts'),'/clasico/fonts/'),...lista(path.join(RAIZ,'icons'),'/clasico/icons/')
  ]);
  const PAGINAS={'/':'inicio.html','/jugar':'jugar.html','/director':'director.html'};

  function enviarArchivo(req,reply,ruta){
    let st;try{st=fs.statSync(ruta)}catch(e){return reply.code(404).type('text/plain; charset=utf-8').send('No encontrado')}
    const etag='"'+st.size.toString(36)+'-'+Math.floor(st.mtimeMs).toString(36)+'"';
    const ext=path.extname(ruta);
    reply.header('ETag',etag).header('Cache-Control',ext==='.woff2'||ext==='.png'?'public, max-age=604800':'no-cache');
    reply.type(TIPOS[ext]||'application/octet-stream');
    if(req.headers['if-none-match']===etag)return reply.code(304).send();
    return reply.send(fs.createReadStream(ruta));
  }

  app.addHook('onSend',async(req,reply,payload)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY');
    const t=String(reply.getHeader('content-type')||'');
    /* La versión clásica lleva su script dentro del HTML: solo ella admite scripts en línea */
    if(t.startsWith('text/html'))reply.header('Content-Security-Policy',req.url.startsWith('/clasico/')?CSP.replace("script-src 'self'","script-src 'self' 'unsafe-inline'"):CSP);
    return payload;
  });

  app.get('/*',(req,reply)=>{
    let p;try{p=decodeURIComponent(req.url.split('?')[0])}catch(e){return reply.code(400).send('Ruta no válida')}
    if(PAGINAS[p])return enviarArchivo(req,reply,path.join(WEB,PAGINAS[p]));
    if(p==='/clasico')return reply.redirect('clasico/',301);
    if(CLASICA.has(p))return enviarArchivo(req,reply,CLASICA.get(p));
    if(NUEVA.has(p))return enviarArchivo(req,reply,NUEVA.get(p));
    return reply.code(404).type('text/plain; charset=utf-8').send('No encontrado');
  });

  /* ---------- Director: PIN, sesión y límite de intentos por IP ---------- */
  const fallos=new Map(); /* ip -> {n, desde, hasta} */
  function bloqueada(ip){const f=fallos.get(ip);if(!f)return 0;const now=Date.now();if(f.hasta>now)return f.hasta-now;if(now-f.desde>VENTANA_FALLOS)fallos.delete(ip);return 0}
  function fallo(ip){const now=Date.now();let f=fallos.get(ip);if(!f||now-f.desde>VENTANA_FALLOS)f={n:0,desde:now,hasta:0};f.n++;if(f.n>=MAX_FALLOS){f.hasta=now+BLOQUEO;f.n=0;f.desde=now}fallos.set(ip,f)}
  setInterval(()=>{for(const ip of [...fallos.keys()])bloqueada(ip)},60000).unref();

  const leerCookie=req=>{const m=new RegExp('(?:^|;\\s*)'+COOKIE+'=([^;]+)').exec(req.headers.cookie||'');return m?decodeURIComponent(m[1]):null};
  const esHttps=req=>req.headers['x-forwarded-proto']==='https'||!!req.socket.encrypted;
  const mismoOrigen=req=>{const o=req.headers.origin;if(!o)return true;try{return new URL(o).host===req.headers.host}catch(e){return false}};

  app.post('/api/entrar',async(req,reply)=>{
    const ip=ipCliente(req.raw);
    if(!mismoOrigen(req))return reply.code(403).send({error:'Origen no permitido'});
    const espera=bloqueada(ip);
    if(espera){reply.header('Retry-After',Math.ceil(espera/1000));return reply.code(429).send({error:'Demasiados intentos. Espera '+Math.ceil(espera/60000)+' min.'})}
    const intento=String(req.body&&req.body.pin||'');
    const ok=crypto.timingSafeEqual(crypto.createHash('sha256').update(intento).digest(),hashPin);
    if(!ok){fallo(ip);app.log.warn({ip},'PIN incorrecto');return reply.code(401).send({error:'PIN incorrecto'})}
    fallos.delete(ip);
    const t=estado.nuevaSesion();
    reply.header('Set-Cookie',`${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30*86400}${esHttps(req)?'; Secure':''}`);
    return {ok:true};
  });
  app.post('/api/salir',async(req,reply)=>{
    if(!mismoOrigen(req))return reply.code(403).send({error:'Origen no permitido'});
    estado.cerrarSesion(leerCookie(req));
    reply.header('Set-Cookie',`${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    return {ok:true};
  });
  app.get('/api/sesion',async(req)=>({director:estado.sesionValida(leerCookie(req))}));
  app.get('/api/salud',async()=>({ok:true}));

  /* ---------- WebSocket ---------- */
  const wss=new WebSocketServer({noServer:true,maxPayload:1024*1024});
  const directores=new Set();
  const jugadores=new Set(); /* sockets de /jugar; ws.jid = id del jugador si está sentado */
  const conectados=()=>new Set([...jugadores].map(w=>w.jid).filter(Boolean));
  const enviar=(w,m)=>{if(w.readyState===1)w.send(typeof m==='string'?m:JSON.stringify(m))};

  app.server.on('upgrade',(req,socket,head)=>{
    const p=(req.url||'').split('?')[0];
    const rol=p==='/ws/director'?'director':p==='/ws/jugar'?'jugador':null;
    if(!rol||!mismoOrigen(req)){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return socket.destroy()}
    if(rol==='director'&&!estado.sesionValida(leerCookie(req))){socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return socket.destroy()}
    wss.handleUpgrade(req,socket,head,ws=>{ws.rol=rol;ws.sesion=leerCookie(req);ws.vivo=true;wss.emit('connection',ws,req)});
  });

  /* Latido: detecta móviles que han perdido cobertura sin cerrar la conexión */
  const latido=setInterval(()=>{wss.clients.forEach(w=>{if(!w.vivo)return w.terminate();w.vivo=false;try{w.ping()}catch(e){}})},20000);
  latido.unref();

  let ultimaDir='';
  function difundirDirectores(rid,origen){
    const v=JSON.stringify({t:'estado',S:estado.vistaDirector(conectados()),urlJugadores});
    ultimaDir=v;
    directores.forEach(w=>{
      if(!estado.sesionValida(w.sesion)){w.close(4001,'Sesión caducada');return}
      enviar(w,w===origen&&rid?v.slice(0,-1)+',"rid":'+JSON.stringify(rid)+'}':v);
    });
  }
  function difundirJugadores(){
    jugadores.forEach(w=>{
      let m;
      if(w.jid){m=estado.vistaJugador(w.jid);if(!m){w.jid=null;w.ultima='';enviar(w,{t:'expulsado'});m=estado.vistaPublica()}}
      else m=estado.vistaPublica();
      const s=JSON.stringify(m);
      if(s!==w.ultima){w.ultima=s;enviar(w,s)}
    });
  }
  let origenPend=null,ridPend=null;
  estado.alCambiar(()=>{difundirJugadores();difundirDirectores(ridPend,origenPend)});

  wss.on('connection',(ws)=>{
    ws.on('pong',()=>{ws.vivo=true});
    if(ws.rol==='director'){
      directores.add(ws);
      enviar(ws,{t:'estado',S:estado.vistaDirector(conectados()),urlJugadores});
      ws.on('message',buf=>{
        let m;try{m=JSON.parse(buf)}catch(e){return}
        if(!m||typeof m!=='object')return;
        if(!estado.sesionValida(ws.sesion)){ws.close(4001,'Sesión caducada');return}
        let r;
        origenPend=ws;ridPend=m.rid||null;
        try{
          switch(m.op){
            case 'sync':r=estado.sync(m.d);break;
            case 'repartir':r=estado.repartir(m.pool);break;
            case 'empezar':r=estado.empezar();break;
            case 'terminar':r=estado.terminar();break;
            case 'expulsar':r=estado.expulsar(String(m.id));break;
            case 'vaciar':r=estado.vaciar();break;
            case 'renombrar':r=estado.renombrar(String(m.id),m.nombre);break;
            case 'anadir':r=estado.anadirSinMovil(m.nombre);break;
            case 'orden':r=estado.ordenar((m.ids||[]).map(String));break;
            case 'barajar':r=estado.barajarAsientos();break;
            default:r={error:'Operación desconocida'};
          }
        }catch(e){app.log.error(e);r={error:'Error interno'}}
        finally{origenPend=null;ridPend=null}
        if(m.rid)enviar(ws,{t:'resp',rid:m.rid,ok:!r.error,error:r.error,aviso:r.aviso});
      });
      ws.on('close',()=>directores.delete(ws));
      return;
    }
    /* Jugador: espera {t:'hola', token} */
    jugadores.add(ws);ws.jid=null;ws.ultima='';
    const avisarDirectores=()=>difundirDirectores();
    ws.on('message',buf=>{
      let m;try{m=JSON.parse(buf)}catch(e){return}
      if(!m||typeof m!=='object')return;
      if(m.t==='hola'){
        const p=estado.jugadorDeToken(m.token);
        ws.jid=p?p.id:null;ws.ultima='';
        if(m.token&&!p)enviar(ws,{t:'token-invalido'});
        difundirJugadores();avisarDirectores();
      }else if(m.t==='unirse'){
        if(ws.jid)return enviar(ws,{t:'error',error:'Ya estás sentado'});
        if((ws.uniones=(ws.uniones||0)+1)>20)return enviar(ws,{t:'error',error:'Demasiados intentos'});
        const r=estado.unirse(m.nombre);
        if(r.error)return enviar(ws,{t:'error',error:r.error});
        ws.jid=r.jugador.id;ws.ultima='';
        enviar(ws,{t:'token',token:r.token});
        difundirJugadores();avisarDirectores();
      }else if(m.t==='levantarse'&&ws.jid){
        const r=estado.levantarse(ws.jid);
        if(r.error)enviar(ws,{t:'error',error:r.error});
      }
    });
    ws.on('close',()=>{jugadores.delete(ws);if(ws.jid)avisarDirectores()});
  });

  /* Antes de cerrar el servidor HTTP hay que soltar los WebSocket, o close() esperaría para siempre */
  app.addHook('preClose',async()=>{clearInterval(latido);wss.clients.forEach(w=>w.terminate())});
  app.addHook('onClose',async()=>{try{estado.guardarYa()}catch(e){console.error('Error al guardar:',e)}});
  return {app,estado,wss};
}

module.exports={crearServidor};

if(require.main===module){
  const puerto=+process.env.PORT||8002;
  const host=process.env.HOST||'127.0.0.1';
  const datos=process.env.DATA_DIR||path.join(RAIZ,'datos');
  let s;
  try{
    s=crearServidor({pin:process.env.GRIMORIO_PIN,archivo:path.join(datos,'estado.json'),ipsTunel:process.env.IPS_TUNEL,urlJugadores:process.env.URL_JUGADORES||'',log:{level:process.env.LOG_LEVEL||'info'}});
  }catch(e){console.error(e.message);process.exit(1)}
  s.app.listen({port:puerto,host}).then(()=>console.log(`Grimorio escuchando en http://${host}:${puerto}`)).catch(e=>{console.error(e);process.exit(1)});
  const parar=()=>{s.app.close().finally(()=>process.exit(0))};
  process.on('SIGTERM',parar);process.on('SIGINT',parar);
}
