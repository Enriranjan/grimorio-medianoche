'use strict';
/* Pruebas de extremo a extremo: servidor real, clientes WebSocket reales, estado en disco. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const WebSocket=require('ws');
const {crearServidor}=require('../servidor.js');

const PIN='9876';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grimorio-test-'));
const archivo=path.join(dir,'estado.json');
let srv,base,host;

async function arrancar(){
  srv=crearServidor({pin:PIN,archivo,log:false});
  await srv.app.listen({port:0,host:'127.0.0.1'});
  host='127.0.0.1:'+srv.app.server.address().port;base='http://'+host;
}
async function parar(){await srv.app.close()}
const espera=ms=>new Promise(r=>setTimeout(r,ms));

/* Cliente que guarda todos los mensajes en bruto */
class Cliente{
  constructor(ruta,cabeceras={}){
    this.crudos=[];this.msgs=[];this.esperas=[];
    this.ws=new WebSocket('ws://'+host+ruta,{headers:Object.assign({Origin:base},cabeceras)});
    this.abierto=new Promise((ok,ko)=>{this.ws.once('open',ok);this.ws.once('error',ko);this.ws.once('unexpected-response',(q,res)=>ko(new Error('HTTP '+res.statusCode)))});
    this.cerrado=new Promise(ok=>this.ws.once('close',ok));
    this.ws.on('message',b=>{const s=b.toString();this.crudos.push(s);const m=JSON.parse(s);this.msgs.push(m);this.esperas=this.esperas.filter(w=>!(w.f(m)&&(w.ok(m),true)))});
  }
  send(m){this.ws.send(JSON.stringify(m))}
  /* Espera a un mensaje que cumpla f (mirando también los ya recibidos desde 'desde') */
  esperar(f,desde=0,ms=3000){
    const ya=this.msgs.slice(desde).filter(f);if(ya.length)return Promise.resolve(ya[ya.length-1]);
    return new Promise((ok,ko)=>{const t=setTimeout(()=>ko(new Error('tiempo agotado esperando mensaje')),ms);this.esperas.push({f,ok:m=>{clearTimeout(t);ok(m)}})});
  }
  ultima(t){for(let i=this.msgs.length-1;i>=0;i--)if(this.msgs[i].t===t)return this.msgs[i];return null}
  cerrar(){this.ws.close();return this.cerrado}
}
async function jugador(token){const c=new Cliente('/ws/jugar');await c.abierto;c.send({t:'hola',token});await c.esperar(m=>m.t==='vista'||m.t==='sin-sitio');return c}
async function sentar(nombre){
  const c=await jugador(null);const n=c.msgs.length;
  c.send({t:'unirse',nombre});
  const tk=await c.esperar(m=>m.t==='token'||m.t==='error',n);
  if(tk.t==='error')throw new Error(tk.error);
  c.token=tk.token;await c.esperar(m=>m.t==='vista',n);return c;
}
async function login(pin=PIN,cab={}){
  const r=await fetch(base+'/api/entrar',{method:'POST',headers:Object.assign({'content-type':'application/json',origin:base},cab),body:JSON.stringify({pin})});
  return {status:r.status,cookie:(r.headers.get('set-cookie')||'').split(';')[0],body:await r.json()};
}
async function director(cookie){const c=new Cliente('/ws/director',{Cookie:cookie});await c.abierto;await c.esperar(m=>m.t==='estado');c.rid=0;return c}
async function op(d,m){const rid='t'+(++d.rid);d.send(Object.assign({rid},m));return d.esperar(x=>x.t==='resp'&&x.rid===rid)}
const vistaDe=c=>c.ultima('vista');
async function vistaNueva(c,desde,f){return c.esperar(m=>m.t==='vista'&&(!f||f(m)),desde)}

const NOMBRES=['Ana','Biel','Carmen','Dani','Elena','Fran','Gema'];
let cookie,dir1,js=[];

test.before(arrancar);
test.after(async()=>{for(const c of js)try{c.ws.terminate()}catch(e){}if(dir1)dir1.ws.terminate();await parar();fs.rmSync(dir,{recursive:true,force:true})});

test('PIN: incorrecto, límite por IP y cabecera de Cloudflare solo desde el túnel',async()=>{
  assert.equal((await login('0000')).status,401);
  for(let i=0;i<4;i++)await login('0000');
  const b=await login(PIN);
  assert.equal(b.status,429,'tras 5 fallos queda bloqueada incluso con el PIN bueno');
  /* Otro móvil detrás de Caddy (otra IP en X-Forwarded-For) no está bloqueado */
  assert.equal((await login('0000',{'x-forwarded-for':'192.168.1.50'})).status,401);
  /* Un móvil de la LAN que se inventa CF-Connecting-IP sigue contando como su IP real */
  for(let i=0;i<4;i++)await login('0000',{'x-forwarded-for':'192.168.1.50','cf-connecting-ip':'203.0.113.'+i});
  assert.equal((await login(PIN,{'x-forwarded-for':'192.168.1.50','cf-connecting-ip':'203.0.113.99'})).status,429);
  /* Por el túnel (salto anterior = la propia Pi) cuenta la IP de Cloudflare: cada visitante su contador */
  assert.equal((await login(PIN,{'x-forwarded-for':'127.0.0.1','cf-connecting-ip':'203.0.113.7'})).status,200);
  const ok=await login(PIN,{'x-forwarded-for':'192.168.1.60'});
  assert.equal(ok.status,200);assert.match(ok.cookie,/^grimorio_director=/);
  cookie=ok.cookie;
});

test('WebSocket del director: sin sesión u otro origen, rechazado',async()=>{
  await assert.rejects(new Cliente('/ws/director').abierto,/401/);
  await assert.rejects(new Cliente('/ws/director',{Cookie:'grimorio_director=inventada'}).abierto,/401/);
  await assert.rejects(new Cliente('/ws/director',{Cookie:cookie,Origin:'http://malo.example'}).abierto,/403/);
  await assert.rejects(new Cliente('/ws/otra').abierto,/403/);
  dir1=await director(cookie);
  assert.deepEqual(dir1.ultima('estado').S.players,[]);
});

test('MESA: los jugadores se sientan y el director los ve en vivo',async()=>{
  for(const n of NOMBRES)js.push(await sentar(n));
  const est=await dir1.esperar(m=>m.t==='estado'&&m.S.players.length===7&&m.S.players.every(p=>p.conectado));
  assert.deepEqual(est.S.players.map(p=>p.name),NOMBRES,'orden de llegada');
  assert.ok(!JSON.stringify(est).includes(js[0].token),'el director no recibe tokens');
  const v=vistaDe(js[6]);
  assert.equal(v.fase,'mesa');assert.deepEqual(v.yo,{nombre:'Gema',asiento:7});
  assert.deepEqual(v.mesa.map(q=>q.n),NOMBRES,'en MESA se ven los nombres');
  await assert.rejects(sentar('ana'),/Ya hay alguien/);
  await assert.rejects(sentar('   '),/Escribe tu nombre/);
});

test('MESA: renombrar, reordenar, expulsar y levantarse',async()=>{
  const ids=dir1.ultima('estado').S.players.map(p=>p.id);
  let n=js[1].msgs.length;
  assert.ok((await op(dir1,{op:'renombrar',id:ids[1],nombre:'Biel el Bueno'})).ok);
  assert.equal((await vistaNueva(js[1],n)).yo.nombre,'Biel el Bueno');
  assert.equal((await op(dir1,{op:'renombrar',id:ids[1],nombre:'ana'})).error,'Ya hay otro jugador con ese nombre');
  /* Arrastre: Gema pasa al asiento 1 */
  n=js[6].msgs.length;
  assert.ok((await op(dir1,{op:'orden',ids:[ids[6],...ids.slice(0,6)]})).ok);
  assert.equal((await vistaNueva(js[6],n)).yo.asiento,1);
  /* Expulsar a Fran: su móvil vuelve a la pantalla de unirse y su token deja de valer */
  n=js[5].msgs.length;
  assert.ok((await op(dir1,{op:'expulsar',id:ids[5]})).ok);
  await js[5].esperar(m=>m.t==='expulsado',n);
  await js[5].cerrar();
  const fran=await jugador(js[5].token);
  assert.ok(fran.msgs.some(m=>m.t==='token-invalido'));assert.ok(!fran.msgs.some(m=>m.t==='vista'));
  await fran.cerrar();
  /* Se vuelve a sentar con el mismo nombre */
  js[5]=await sentar('Fran');
  /* Elena se levanta sola (solo en MESA) */
  n=js[4].msgs.length;js[4].send({t:'levantarse'});
  await js[4].esperar(m=>m.t==='expulsado',n);
  await js[4].cerrar();
  js[4]=await sentar('Elena');
  const est=await dir1.esperar(m=>m.t==='estado'&&m.S.players.length===7&&m.S.players.at(-1).name==='Elena');
  assert.deepEqual(est.S.players.map(p=>p.name),['Gema','Ana','Biel el Bueno','Carmen','Dani','Fran','Elena']);
});

/* Comprueba que un jugador solo ha recibido lo suyo, mirando los mensajes en bruto */
function revisarPrivacidad(c,S){
  const yo=S.players.find(p=>p.name===vistaDe(c).yo.nombre);
  const otros=S.players.filter(p=>p.id!==yo.id);
  for(const s of c.crudos){
    const m=JSON.parse(s);
    for(const p of S.players)assert.ok(!s.includes(p.id),'nunca viajan ids internos');
    for(const t of js)if(t.token&&t!==c)assert.ok(!s.includes(t.token),'nunca viajan tokens ajenos');
    assert.ok(!/"(role|shown|rem|note|alive|ghost|players|log|tokens|sesiones)"/.test(s),'ningún campo del grimorio: '+s.slice(0,120));
    if(m.t!=='vista')continue;
    assert.deepEqual(Object.keys(m).sort(),(m.fase==='partida'?['carta','cfg','fase','gid','guion','mesa','momento','pool','t','vivo','yo']:['fase','guion','mesa','t','yo']).sort());
    m.mesa.forEach(q=>assert.deepEqual(Object.keys(q).sort(),m.fase==='partida'?['n','vivo']:['n']));
    if(m.fase!=='partida')continue;
    const bandoYo=S.players.find(p=>p.id===yo.id);
    void bandoYo;void otros;
  }
}

let S1;
test('REPARTO al azar: cada jugador ve solo su carta (también inspeccionando la red)',async()=>{
  const n=js.map(c=>c.msgs.length);
  const r=await op(dir1,{op:'repartir',pool:null});
  assert.ok(r.ok,r.error);
  const est=await dir1.esperar(m=>m.t==='estado'&&m.S.started);
  S1=est.S;
  const G=require('../../web/reglas.js').guion('animas'),bando=id=>G.roles.find(x=>x.id===id).t;
  const malos=S1.players.filter(p=>['min','dem'].includes(bando(p.role)));
  for(let i=0;i<js.length;i++){
    const v=await vistaNueva(js[i],n[i],m=>m.fase==='partida');
    const p=S1.players.find(q=>q.name===v.yo.nombre);
    assert.equal(v.carta.rol,p.shown||p.role,'ve su carta (el Borracho, la falsa)');
    const t=bando(p.role);
    if(t==='dem'){assert.deepEqual(v.carta.esbirros.sort(),malos.filter(q=>bando(q.role)==='min').map(q=>q.name).sort());assert.equal(v.carta.faroles.length,3)}
    else if(t==='min'&&!p.shown){assert.deepEqual(v.carta.demonio,malos.filter(q=>bando(q.role)==='dem').map(q=>q.name))}
    else{assert.deepEqual(v.carta.demonio,[]);assert.deepEqual(v.carta.esbirros,[]);assert.deepEqual(v.carta.faroles,[])}
    assert.deepEqual(v.momento,{dia:1,noche:true});
    revisarPrivacidad(js[i],S1);
    /* Ningún rol de otro jugador bueno aparece fuera del pool (salvo faroles del Demonio) */
    const sinPool=JSON.stringify(Object.assign({},v,{pool:[],carta:Object.assign({},v.carta,{faroles:[]})}));
    for(const q of S1.players)if(q.name!==v.yo.nombre&&q.role!==v.carta.rol)assert.ok(!sinPool.includes('"'+q.role+'"'),`${v.yo.nombre} no debe ver el rol de ${q.name}`);
  }
});

test('PARTIDA: muertes y fase llegan a todos; cambio de rol llega solo al afectado',async()=>{
  const [a,b]=S1.players;
  const n=js.map(c=>c.msgs.length);
  const d={players:{[a.id]:{alive:false}},day:2,night:false,log:[{n:1,s:'x',k:'x',to:'all',a:[[]]}],noms:[],nomd:[],nomr:[],done:{},block:null,exec:null,bluffs:S1.bluffs};
  assert.ok((await op(dir1,{op:'sync',d})).ok);
  for(let i=0;i<js.length;i++){
    const v=await vistaNueva(js[i],n[i],m=>m.momento.dia===2);
    assert.equal(v.momento.noche,false);
    assert.equal(v.mesa.find(q=>q.n===a.name).vivo,false);
    if(v.yo.nombre===a.name)assert.equal(v.vivo,false);
  }
  const nuevo=['vidente','farolero','soldado','santo','cazador'].find(r=>!S1.players.some(p=>p.role===r));
  const cb=js.find(c=>vistaDe(c).yo.nombre===b.name),otro=js.find(c=>c!==cb);
  const nb=cb.msgs.length,no=otro.msgs.length;
  assert.ok((await op(dir1,{op:'sync',d:{players:{[b.id]:{role:nuevo,shown:null}}}})).ok);
  assert.equal((await vistaNueva(cb,nb)).carta.rol,nuevo);
  await espera(150);
  assert.equal(otro.msgs.length,no,'a los demás no les llega nada si su vista no cambia');
  /* Un rol inventado se ignora */
  await op(dir1,{op:'sync',d:{players:{[b.id]:{role:'<script>'}}}});
  assert.equal(dir1.ultima('estado').S.players.find(p=>p.id===b.id).role,nuevo);
});

test('RECONEXIÓN: recargar o perder cobertura devuelve al mismo sitio con el token',async()=>{
  const c=js[2],antes=vistaDe(c);
  c.ws.terminate();await c.cerrado;               /* corte brusco, sin cierre limpio */
  await dir1.esperar(m=>m.t==='estado'&&(m.S.players.find(p=>p.name===antes.yo.nombre)||{}).conectado===false);
  const c2=await jugador(c.token);c2.token=c.token;js[2]=c2;
  assert.deepEqual(vistaDe(c2),antes);
  await dir1.esperar(m=>m.t==='estado'&&(m.S.players.find(p=>p.name===antes.yo.nombre)||{}).conectado===true);
  /* Dos pestañas con el mismo token: las dos reciben su vista */
  const c3=await jugador(c.token);assert.deepEqual(vistaDe(c3),antes);await c3.cerrar();
  /* Token inventado: pantalla de unirse */
  const x=await jugador('inventado');assert.ok(x.msgs.some(m=>m.t==='token-invalido'));assert.equal(x.ultima('sin-sitio').mesa.length,7);await x.cerrar();
});

test('PERSISTENCIA: tras reiniciar el servidor todo sigue igual',async()=>{
  const antes=js.map(vistaDe),estAntes=dir1.ultima('estado').S;
  for(const c of js)c.ws.terminate();dir1.ws.terminate();
  await parar();
  assert.ok(fs.existsSync(archivo));
  await arrancar();
  for(let i=0;i<js.length;i++){const t=js[i].token;js[i]=await jugador(t);js[i].token=t;assert.deepEqual(vistaDe(js[i]),antes[i])}
  dir1=await director(cookie);
  const S=dir1.ultima('estado').S;
  assert.deepEqual(S.players.map(p=>[p.id,p.name,p.role,p.alive]),estAntes.players.map(p=>[p.id,p.name,p.role,p.alive]));
  assert.equal(S.gid,estAntes.gid);assert.equal(S.day,2);
});

test('FIN: Terminar partida borra roles, conserva a los sentados y todos vuelven a MESA',async()=>{
  const n=js.map(c=>c.msgs.length);
  assert.ok((await op(dir1,{op:'terminar'})).ok);
  const S=(await dir1.esperar(m=>m.t==='estado'&&!m.S.started)).S;
  assert.equal(S.players.length,7);
  assert.ok(S.players.every(p=>p.role===null&&p.shown===null&&p.alive&&!p.rem.length&&!p.note));
  assert.deepEqual(S.log,[]);assert.deepEqual(S.bluffs,[]);assert.equal(S.day,1);
  for(let i=0;i<js.length;i++){
    const v=await vistaNueva(js[i],n[i],m=>m.fase==='mesa');
    assert.ok(!('carta' in v));assert.equal(v.mesa.length,7);
  }
  /* Recargan y siguen sentados sin volver a unirse */
  const t=js[0].token;js[0].ws.terminate();js[0]=await jugador(t);js[0].token=t;
  assert.equal(vistaDe(js[0]).fase,'mesa');
});

test('REPARTO a mano: roles elegidos por el director y empezar',async()=>{
  const S=dir1.ultima('estado').S;
  const roles=['calabaza','envenenadora','borracho','vidente','farolero','cronista','detective'];
  const players={};S.players.forEach((p,i)=>{players[p.id]={role:roles[i]}});
  const sinUno=Object.assign({},players);delete sinUno[S.players[6].id];
  await op(dir1,{op:'sync',d:{players:sinUno}});
  assert.match((await op(dir1,{op:'empezar'})).error,/Falta personaje/);
  await op(dir1,{op:'sync',d:{players}});
  const n=js.map(c=>c.msgs.length);
  assert.ok((await op(dir1,{op:'empezar'})).ok);
  const S2=(await dir1.esperar(m=>m.t==='estado'&&m.S.started)).S;
  const bor=S2.players.find(p=>p.role==='borracho');
  assert.ok(bor.shown&&!roles.includes(bor.shown),'el Borracho recibe un Aldeano fuera de juego');
  for(let i=0;i<js.length;i++){
    const v=await vistaNueva(js[i],n[i],m=>m.fase==='partida');
    const p=S2.players.find(q=>q.name===v.yo.nombre);
    assert.equal(v.carta.rol,p.role==='borracho'?bor.shown:p.role);
    revisarPrivacidad(js[i],S2);
  }
  /* Quien se une con la partida empezada se sienta sin personaje */
  const h=await sentar('Hugo');js.push(h);
  assert.equal(vistaDe(h).fase,'partida');assert.equal(vistaDe(h).carta.rol,null);
  h.send({t:'levantarse'});
  assert.match((await h.esperar(m=>m.t==='error')).error,/ya ha empezado/);
});

test('Nombres con caracteres raros se limpian y no rompen nada',async()=>{
  const c=await sentar('<img src=x onerror=alert(1)>\u202e\u0007');js.push(c);
  assert.equal(vistaDe(c).yo.nombre,'<img src=x onerror=alert');
  assert.ok(!vistaDe(c).yo.nombre.includes('\u202e'));
});
