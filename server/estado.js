'use strict';
/* Estado único de la partida: jugadores sentados, grimorio y vistas filtradas.
   Todo cambio pasa por aquí; el servidor es la fuente de verdad. */
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const Reglas=require('../web/reglas.js');

const MAX_JUGADORES=20;
const MAX_NOMBRE=24;
/* Campos de partida que el director puede sincronizar libremente (lógica de noche y día) */
const CLAVES_PARTIDA=['day','night','done','noms','nomd','nomr','block','bluffs','log','exec'];
const DIA_SESION=24*3600*1000;
const DURACION_SESION=30*DIA_SESION;

const nuevoId=()=>crypto.randomBytes(4).toString('hex');
const nuevoToken=()=>crypto.randomBytes(24).toString('base64url');

function partidaVacia(){return {started:false,gid:null,day:1,night:true,done:{},noms:[],nomd:[],nomr:[],block:null,bluffs:[],log:[],exec:null}}
function jugadorNuevo(id,name){return {id,name,role:null,shown:null,alive:true,ghost:true,rem:[],note:''}}

function estadoInicial(){
  const g=Reglas.guion();
  return Object.assign({v:2,guion:g.id,nextId:1,players:[],pool:g.roles.map(r=>r.id),cfg:{notes:true,off:true,tmin:3},baseUrl:'',mesaCerrada:false,tokens:{},sesiones:{},pin:null},partidaVacia());
}

function limpiarNombre(s){
  s=String(s==null?'':s).normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g,'').replace(/\s+/g,' ').trim();
  return Array.from(s).slice(0,MAX_NOMBRE).join('');
}
const mismoNombre=(a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})===0;

class Estado{
  constructor(archivo){
    this.archivo=archivo;
    this.s=estadoInicial();
    this.oyentes=new Set();
    this.temporizador=null;
    if(archivo)this.cargar();
  }

  /* ---------- Persistencia (JSON con escritura atómica) ---------- */
  cargar(){
    try{
      const j=JSON.parse(fs.readFileSync(this.archivo,'utf8'));
      if(j&&j.v===2)this.s=Object.assign(estadoInicial(),j);
    }catch(e){
      if(e.code!=='ENOENT'){
        console.error('No se pudo leer el estado, se guarda una copia y se empieza de cero:',e.message);
        try{fs.copyFileSync(this.archivo,this.archivo+'.roto-'+Date.now())}catch(_){}
      }
    }
    this.purgarSesiones();
  }
  guardarYa(){
    if(!this.archivo)return;
    clearTimeout(this.temporizador);this.temporizador=null;
    fs.mkdirSync(path.dirname(this.archivo),{recursive:true});
    const tmp=this.archivo+'.tmp';
    const fd=fs.openSync(tmp,'w',0o600);
    try{fs.writeSync(fd,JSON.stringify(this.s));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    fs.renameSync(tmp,this.archivo);
  }
  guardar(){
    if(!this.archivo||this.temporizador)return;
    this.temporizador=setTimeout(()=>{try{this.guardarYa()}catch(e){console.error('Error al guardar:',e)}},200);
  }
  cambiado(){this.guardar();this.oyentes.forEach(f=>f())}
  alCambiar(f){this.oyentes.add(f);return ()=>this.oyentes.delete(f)}

  /* ---------- Utilidades ---------- */
  get g(){return Reglas.guion(this.s.guion)}
  jugador(id){return this.s.players.find(p=>p.id===id)||null}
  jugadorDeToken(tok){const id=typeof tok==='string'?this.s.tokens[tok]:null;return id?this.jugador(id):null}
  tieneMovil(id){return Object.values(this.s.tokens).includes(id)}
  quitarTokens(id){for(const [t,v] of Object.entries(this.s.tokens))if(v===id)delete this.s.tokens[t]}

  /* ---------- Sesiones del director ---------- */
  nuevaSesion(){const t=nuevoToken();this.s.sesiones[t]=Date.now()+DURACION_SESION;this.guardar();return t}
  sesionValida(t){const e=typeof t==='string'&&Object.prototype.hasOwnProperty.call(this.s.sesiones,t)?this.s.sesiones[t]:0;return e>Date.now()}
  cerrarSesion(t){if(this.s.sesiones[t]){delete this.s.sesiones[t];this.guardar()}}
  /* Si el PIN ha cambiado desde el último arranque, se cierran todas las sesiones del director.
     Se guarda solo una huella con sal (scrypt), nunca el PIN. */
  comprobarPin(pin){
    const huella=p=>crypto.scryptSync(String(pin),Buffer.from(p.sal,'hex'),32).toString('hex');
    const p=this.s.pin;
    if(p&&p.sal&&p.h&&crypto.timingSafeEqual(Buffer.from(huella(p),'hex'),Buffer.from(p.h,'hex')))return false;
    const nuevo={sal:crypto.randomBytes(16).toString('hex')};nuevo.h=huella(nuevo);
    const habia=Object.keys(this.s.sesiones).length;
    this.s.pin=nuevo;this.s.sesiones={};this.guardar();
    return habia>0;
  }
  purgarSesiones(){const now=Date.now();for(const [t,e] of Object.entries(this.s.sesiones))if(e<=now)delete this.s.sesiones[t]}

  /* ---------- Jugadores (desde /jugar) ---------- */
  unirse(nombre){
    const name=limpiarNombre(nombre);
    if(this.s.mesaCerrada)return {error:'La mesa está cerrada. Si te falta sentarte, pide al Narrador que la abra.'};
    if(!name)return {error:'Escribe tu nombre'};
    if(this.s.players.some(p=>mismoNombre(p.name,name)))return {error:'Ya hay alguien sentado con ese nombre. Si eres tú y has cambiado de móvil, pide al Narrador que te quite de la mesa, o elige otro nombre.'};
    if(this.s.players.length>=MAX_JUGADORES)return {error:'La mesa está llena'};
    const p=jugadorNuevo(nuevoId(),name);
    this.s.players.push(p);
    const token=nuevoToken();
    this.s.tokens[token]=p.id;
    this.cambiado();
    return {token,jugador:p};
  }
  levantarse(id){
    if(this.s.started)return {error:'La partida ya ha empezado: pídeselo al Narrador'};
    return this.expulsar(id);
  }

  /* ---------- Operaciones del director ---------- */
  expulsar(id){
    const p=this.jugador(id);if(!p)return {error:'Ese jugador ya no está'};
    this.s.players=this.s.players.filter(q=>q.id!==id);
    this.quitarTokens(id);
    this.cambiado();
    return {ok:true,id};
  }
  vaciar(){
    const ids=this.s.players.map(p=>p.id);
    this.s.players=[];this.s.tokens={};this.s.mesaCerrada=false;
    Object.assign(this.s,partidaVacia());
    this.cambiado();
    return {ok:true,ids};
  }
  renombrar(id,nombre){
    const p=this.jugador(id);if(!p)return {error:'Ese jugador ya no está'};
    const name=limpiarNombre(nombre);
    if(!name)return {error:'El nombre no puede estar vacío'};
    if(this.s.players.some(q=>q.id!==id&&mismoNombre(q.name,name)))return {error:'Ya hay otro jugador con ese nombre'};
    p.name=name;this.cambiado();return {ok:true};
  }
  anadirSinMovil(nombre){
    const name=limpiarNombre(nombre);
    if(!name)return {error:'Escribe un nombre'};
    if(this.s.players.some(p=>mismoNombre(p.name,name)))return {error:'Ya hay alguien con ese nombre'};
    if(this.s.players.length>=MAX_JUGADORES)return {error:'La mesa está llena'};
    this.s.players.push(jugadorNuevo(nuevoId(),name));this.cambiado();return {ok:true};
  }
  /* Nuevo orden de asientos: los ids que no conozca se ignoran y los que falten se quedan al final */
  ordenar(ids){
    if(!Array.isArray(ids))return {error:'Orden no válido'};
    const porId=new Map(this.s.players.map(p=>[p.id,p])),vistos=new Set(),nuevo=[];
    ids.forEach(id=>{const p=porId.get(id);if(p&&!vistos.has(id)){vistos.add(id);nuevo.push(p)}});
    this.s.players.forEach(p=>{if(!vistos.has(p.id))nuevo.push(p)});
    this.s.players=nuevo;this.cambiado();return {ok:true};
  }
  /* Cerrar la mesa: nadie nuevo puede sentarse (los ya sentados siguen entrando con su token) */
  cerrarMesa(cerrada){this.s.mesaCerrada=!!cerrada;this.cambiado();return {ok:true}}
  barajarAsientos(){this.s.players=Reglas.barajar(this.s.players);this.cambiado();return {ok:true}}

  marcarPool(pool){
    if(!Array.isArray(pool))return;
    const validos=new Set(this.g.roles.map(r=>r.id));
    this.s.pool=[...new Set(pool.filter(id=>validos.has(id)))];
  }
  empezarPartida(asig,faroles){
    this.s.players.forEach(p=>{const a=asig[p.id]||{};p.role=a.role||null;p.shown=a.shown||null;p.alive=true;p.ghost=true;p.rem=[];p.note=''});
    Object.assign(this.s,partidaVacia(),{started:true,gid:nuevoId(),bluffs:faroles});
  }
  /* Reparto al azar en el servidor */
  repartir(pool){
    if(pool)this.marcarPool(pool);
    const r=Reglas.repartir(this.g,this.s.players,this.s.pool);
    if(r.error)return {error:r.error};
    this.empezarPartida(r.asig,r.faroles);
    this.cambiado();
    return {ok:true,aviso:r.aviso};
  }
  /* Empezar con el reparto hecho a mano (los roles ya están puestos con sync) */
  empezar(){
    const ps=this.s.players;
    if(!ps.length)return {error:'No hay nadie sentado'};
    const sin=ps.filter(p=>!this.g.roles.some(r=>r.id===p.role));
    if(sin.length)return {error:'Falta personaje para: '+sin.map(p=>p.name).join(', ')};
    const r=Reglas.completar(this.g,ps.map(p=>({id:p.id,role:p.role,shown:p.shown})),this.s.pool);
    this.empezarPartida(r.asig,r.faroles);
    this.cambiado();
    return {ok:true,aviso:r.aviso};
  }
  /* Terminar partida: borra roles y grimorio, conserva a los jugadores sentados (y sus tokens) */
  terminar(){
    this.s.players.forEach(p=>Object.assign(p,{role:null,shown:null,alive:true,ghost:true,rem:[],note:''}));
    Object.assign(this.s,partidaVacia());
    this.cambiado();
    return {ok:true};
  }
  /* Cambios del grimorio hechos por el director (noche, día, roles a mano, recordatorios...) */
  sync(d){
    if(!d||typeof d!=='object')return {error:'Datos no válidos'};
    const g=this.g,valido=id=>id==null||id===''?null:(g.roles.some(r=>r.id===id)?id:undefined);
    if(d.players&&typeof d.players==='object'){
      for(const [id,c] of Object.entries(d.players)){
        const p=this.jugador(id);if(!p||!c||typeof c!=='object')continue;
        if('role' in c){const v=valido(c.role);if(v!==undefined)p.role=v}
        if('shown' in c){const v=valido(c.shown);if(v!==undefined)p.shown=v}
        if(typeof c.alive==='boolean')p.alive=c.alive;
        if(typeof c.ghost==='boolean')p.ghost=c.ghost;
        if(Array.isArray(c.rem))p.rem=c.rem.filter(x=>typeof x==='string').slice(0,30).map(x=>x.slice(0,60));
        if(typeof c.note==='string')p.note=c.note.slice(0,4000);
      }
    }
    if(this.s.started)CLAVES_PARTIDA.forEach(k=>{if(k in d&&d[k]!==undefined)this.s[k]=d[k]});
    if(Array.isArray(d.pool))this.marcarPool(d.pool);
    if(d.cfg&&typeof d.cfg==='object'){
      const c=this.s.cfg;
      if(typeof d.cfg.notes==='boolean')c.notes=d.cfg.notes;
      if(typeof d.cfg.off==='boolean')c.off=d.cfg.off;
      if(Number.isFinite(d.cfg.tmin)&&d.cfg.tmin>0&&d.cfg.tmin<=60)c.tmin=d.cfg.tmin;
    }
    if(typeof d.baseUrl==='string')this.s.baseUrl=d.baseUrl.trim().slice(0,300);
    this.cambiado();
    return {ok:true};
  }

  /* ---------- Vistas ---------- */
  /* Lo que ve el director: todo menos tokens y sesiones */
  vistaDirector(conectados){
    const {tokens,sesiones,pin,...resto}=this.s;
    const v=JSON.parse(JSON.stringify(resto));
    v.players.forEach(p=>{p.movil=this.tieneMovil(p.id);p.conectado=!!(conectados&&conectados.has(p.id))});
    return v;
  }
  /* Lo que ve un jugador. Lista cerrada de campos: nunca roles, notas ni recordatorios de otros. */
  vistaJugador(id){
    const s=this.s,p=this.jugador(id);
    if(!p)return null;
    const enPartida=!!s.started;
    const v={
      t:'vista',
      fase:enPartida?'partida':'mesa',
      guion:s.guion,
      yo:{nombre:p.name,asiento:s.players.indexOf(p)+1},
      mesa:s.players.map(q=>enPartida?{n:q.name,vivo:!!q.alive}:{n:q.name})
    };
    if(enPartida){
      v.gid=s.gid;
      v.momento={dia:s.day,noche:!!s.night};
      v.vivo=!!p.alive;
      v.carta=Reglas.carta(this.g,p,s.players,s.bluffs);
      v.pool=s.pool.slice();
      v.cfg={notas:!!s.cfg.notes,fuera:!!s.cfg.off};
    }
    return v;
  }
  /* Antes de unirse: solo los nombres de la mesa */
  vistaPublica(){return {t:'sin-sitio',fase:this.s.started?'partida':'mesa',cerrada:!!this.s.mesaCerrada,mesa:this.s.players.map(q=>({n:q.name}))}}
}

module.exports={Estado,limpiarNombre,MAX_JUGADORES,CLAVES_PARTIDA};
