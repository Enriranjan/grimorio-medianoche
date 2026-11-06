'use strict';
/* Grimorio de Medianoche · pantalla del jugador.
   Solo recibe del servidor su propia vista (su carta, la mesa y la fase). Rutas relativas a esta página. */
const G=Reglas.guion('animas');
const TEAMS=G.equipos,ROLES=G.roles,BANDOS=Reglas.BANDOS;
const R=Object.fromEntries(ROLES.map(r=>[r.id,r]));
const TOKEN='grimorio-token',NOTAS='grimorio-notas';
const FX=['☠️ Envenenado','🛡️ Protegido','🐈‍⬛ Embrujado','🐴 Maldito','† Muerto','👍 Me fío','👎 Sospechoso','🤥 Miente'];

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(m){const d=document.createElement('div');d.className='toast';d.setAttribute('role','status');d.textContent=m;document.body.appendChild(d);setTimeout(()=>d.remove(),3200)}
const leerToken=()=>{try{return localStorage.getItem(TOKEN)}catch(e){return null}};
const guardarToken=t=>{try{t?localStorage.setItem(TOKEN,t):localStorage.removeItem(TOKEN)}catch(e){}};

/* V: última vista del servidor. P: estado de la pantalla. */
let V=null,PUB=null;
const P={view:'cargando',rev:false,f:'all',err:'',nombre:'',enviando:false,first:false,antes:'carta'};
const HELP={};
function hbox(k,t,html){return `<div class="help"><button class="helpb" data-act="help" data-k="${k}" aria-expanded="${!!HELP[k]}"><span aria-hidden="true">ⓘ</span> ${t}</button><div class="helpc" ${HELP[k]?'':'hidden'}>${html}</div></div>`}
const embers=n=>`<div class="embers" aria-hidden="true">${Array.from({length:n},(_,i)=>`<span style="left:${(i*7.3+4)%100}%;animation-duration:${8+(i*1.7)%7}s;animation-delay:${(i*1.3)%9}s"></span>`).join('')}</div>`;
function ringSVG(){
  let t='';
  for(let i=0;i<48;i++){const a=i*Math.PI/24,r1=i%4===0?45.6:47,r2=48.6;t+=`<line x1="${(50+r1*Math.cos(a)).toFixed(2)}" y1="${(50+r1*Math.sin(a)).toFixed(2)}" x2="${(50+r2*Math.cos(a)).toFixed(2)}" y2="${(50+r2*Math.sin(a)).toFixed(2)}"/>`}
  return `<svg class="runes" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48.6"/><circle cx="50" cy="50" r="27"/><circle cx="50" cy="50" r="25.6" stroke-dasharray="2.5 1.4"/>${t}</svg>`;
}
function shell(inner,wide){
  const pv=$('.pv'),st=pv?pv.scrollTop:0;
  $('#app').innerHTML=`${embers(12)}<div class="pv"><div class="pvbox ${wide?'wide':''}"><div class="lst">${inner}</div></div></div>`;
  marcaRed();
  return st;
}
const keep=st=>{const pv=$('.pv');if(pv)pv.scrollTop=st};
const cabecera=()=>`<div class="pvtop"><div class="lbl">${esc(G.nombre)}${V?' · '+esc(V.yo.nombre):''}</div></div>`;
const momento=()=>V&&V.momento?`<div class="momento">${V.momento.noche?'☾ Noche ':'☀ Día '}${V.momento.dia}</div>`:'';

/* ============ Textos de la carta ============ */
function wakeText(r){
  if(r.id==='murcielago')return 'Solo te despiertan de noche si has muerto esa noche.';
  if(r.f&&r.o)return 'El Narrador te despertará todas las noches.';
  if(r.f)return 'El Narrador te despertará solo la primera noche.';
  if(r.o)return 'El Narrador te despertará a partir de la segunda noche.';
  return 'Tu habilidad es pasiva o se usa de día. No te despertarán de noche.';
}
function wakeShort(r){
  if(r.id==='murcielago')return 'Solo despierta de noche si muere esa noche.';
  if(r.f&&r.o)return 'Despierta todas las noches.';
  if(r.f)return 'Despierta solo la primera noche.';
  if(r.o)return 'Despierta a partir de la segunda noche.';
  return 'Pasiva o de día: no despierta de noche.';
}
function cardHTML(c){
  const r=R[c.rol];
  if(!r)return `<div class="card"><h2>Sin rol</h2><p class="ab">El Narrador aún no te ha asignado personaje.</p></div>`;
  let ex='';
  if(r.t==='min'&&!c.demonio.length&&!c.esbirros.length)ex='';
  else if(r.t==='min')ex=`<div class="ex"><b>El Demonio:</b> ${c.demonio.length?c.demonio.map(esc).join(', '):'nadie'}.${c.esbirros.length?`<br><b>Otros Esbirros:</b> ${c.esbirros.map(esc).join(', ')}.`:''}</div>`;
  if(r.t==='dem')ex=`<div class="ex"><b>Tus Esbirros:</b> ${c.esbirros.length?c.esbirros.map(esc).join(', '):'nadie'}.${c.faroles.length?`<br><b>Faroles (roles que no están en juego):</b> ${c.faroles.map(id=>R[id]?R[id].i+' '+esc(R[id].n):'').join(' · ')}.`:''}</div>`;
  return `<div class="card" style="--tc:var(--${r.t})"><div class="ct">${TEAMS[r.t].n.toUpperCase()}</div><div class="ci">${r.i}</div><h2>${esc(r.n)}</h2><p class="ab">${esc(r.a)}</p><div class="div"></div><p class="wake">${wakeText(r)}</p>${ex}</div>`;
}
function mesaHTML(){
  const ps=V?V.mesa:(PUB?PUB.mesa:[]);
  if(!ps.length)return '<p class="sub" style="text-align:center">Todavía no hay nadie sentado.</p>';
  const yo=V?V.yo.asiento-1:-1;
  return `<ul class="mesal">${ps.map((q,i)=>`<li class="${i===yo?'yo':''} ${q.vivo===false?'muerto':''}"><span class="seat">${i+1}</span><span class="nm">${esc(q.n)}</span>${i===yo?'<span class="you">Tú</span>':''}${q.vivo===false?'<span class="sub">† muerto</span>':''}</li>`).join('')}</ul>`;
}

/* ============ Pantallas ============ */
function renderJoin(){
  const n=PUB?PUB.mesa.length:0;
  const st=shell(`<div class="pvtop"><div class="lbl">${esc(G.nombre)}</div></div>
   <h1 class="pvh">Únete a la mesa</h1>
   <p class="sub" style="text-align:center;margin:0">Escribe tu nombre para sentarte. Este móvil te recordará: si recargas o pierdes la conexión, volverás a tu sitio.</p>
   ${PUB&&PUB.cerrada?'<div class="panel empty"><h2>🔒 La mesa está cerrada</h2><p>El Narrador ha cerrado la mesa: ya no se puede sentar nadie más. Si te falta sentarte, pídele que la abra.</p></div>':''}
   <form id="fjoin" class="login" style="width:100%" ${PUB&&PUB.cerrada?'hidden':''}>
    <input type="text" id="jname" maxlength="24" autocomplete="nickname" autocapitalize="words" placeholder="Tu nombre" aria-label="Tu nombre" value="${esc(P.nombre)}" style="letter-spacing:normal">
    <div class="err" role="alert">${esc(P.err)}</div>
    <button class="btn primary block" type="submit" ${P.enviando?'disabled':''}>🕯️ Sentarme a la mesa</button>
   </form>
   ${n?`<h2 class="th" style="--tc:var(--ember)">Ya en la mesa · ${n}</h2>${mesaHTML()}`:''}
   ${PUB&&PUB.fase==='partida'?'<p class="nwarn" style="text-align:center">Hay una partida en curso: te sentarás sin personaje hasta que el Narrador te dé uno.</p>':''}
   <button class="btn block" data-act="libro">📖 Ver todos los personajes</button>`);
  keep(st);
  const fj=$('#fjoin');if(!fj||fj.hidden)return;
  fj.addEventListener('submit',e=>{
    e.preventDefault();
    const v=$('#jname').value.trim();P.nombre=v;
    if(!v){P.err='Escribe tu nombre';renderJoin();return}
    if(!enviar({t:'unirse',nombre:v})){P.err='Sin conexión. Reintentando…';renderJoin();return}
    P.err='';P.enviando=true;renderJoin();
  });
}
function renderMesa(){
  const st=shell(`${cabecera()}
   <h1 class="pvh">Estás en la mesa</h1>
   <div class="cardback" style="min-height:0;padding:26px 18px">${ringSVG()}<div class="ph flame">🕯️</div><div class="hi">${esc(V.yo.nombre)}</div><p class="sub">Asiento ${V.yo.asiento}. Esperando a que el Narrador reparta los personajes…</p></div>
   <h2 class="th" style="--tc:var(--ember)">La mesa · ${V.mesa.length}</h2>
   ${mesaHTML()}
   <button class="btn block" data-act="libro">📖 Ver todos los personajes</button>
   <button class="btn sm" style="align-self:center" data-act="levantarse">Levantarme de la mesa</button>`);
  keep(st);
}
function renderCarta(){
  const c=V.carta,r=R[c.rol];
  if(!r){
    const st=shell(`${cabecera()}${momento()}<div class="panel empty"><h2>Aún no tienes personaje</h2><p>La partida ya ha empezado. El Narrador te dará uno en cuanto pueda; aparecerá aquí sin que tengas que hacer nada.</p></div>
     <h2 class="th" style="--tc:var(--ember)">La mesa</h2>${mesaHTML()}
     <button class="btn block" data-act="libro">📖 Ver todos los personajes</button>`);
    keep(st);return;
  }
  const notas=V.cfg&&V.cfg.notas;
  const st=shell(`${cabecera()}
   ${momento()}
   ${V.vivo?'':'<p class="verdict" style="text-align:center">† Has muerto. Puedes seguir hablando y te queda un voto fantasma.</p>'}
   <div class="scene ${P.rev?'on':''}" id="scene"><div class="flip">
     <div class="face back" id="fback" aria-hidden="${P.rev}"><div class="cardback">${ringSVG()}<div class="ph flame">🕯️</div><div class="hi">Hola, ${esc(V.yo.nombre)}</div><p class="sub">Esta carta es solo para tus ojos.</p><div class="tap">Asegúrate de que nadie mira</div></div></div>
     <div class="face front" id="ffront" aria-hidden="${!P.rev}">${cardHTML(c)}</div>
   </div></div>
   <button class="btn primary block" id="ptog" data-act="ptoggle">${P.rev?'Ocultar mi rol':'Revelar mi rol'}</button>
   <div class="goal" id="pgoal" ${P.rev?'':'hidden'} style="--tc:var(--${r.t})"><b>TU OBJETIVO</b>${esc(G.objetivos[r.t])}</div>
   ${hbox('card','Qué hay en esta pantalla',`<ul><li><b>Revelar mi rol</b> gira la carta. Ocúltala cuando acabes.</li><li>Si el Narrador cambia tu personaje, la carta se actualiza sola y se vuelve a tapar.</li>${notas?'<li><b>Mis notas:</b> tus apuntes y sospechas, privados y solo en este móvil.</li>':''}<li><b>La mesa:</b> quién sigue vivo.</li></ul>`)}
   ${notas?'<button class="btn block" data-act="notas">✎ Mis notas y sospechas</button>':''}
   <button class="btn block" data-act="libro">📖 Ver todos los personajes</button>
   <h2 class="th" style="--tc:var(--ember)">La mesa</h2>
   ${mesaHTML()}`);
  keep(st);
}
function renderLibro(){
  const enP=V&&V.fase==='partida',own=enP&&V.carta&&P.rev?V.carta.rol:null;
  const pool=enP?new Set(V.pool):null,hideOff=enP&&V.cfg&&!V.cfg.fuera,f=P.f;
  const can=id=>!pool||pool.has(id)||id===own;
  const groups=BANDOS.filter(t=>f==='all'||f===t).map(t=>{
    const items=ROLES.filter(r=>r.t===t&&(can(r.id)||!hideOff)).sort((a,b)=>can(b.id)-can(a.id));
    if(!items.length)return '';
    const nc=items.filter(r=>can(r.id)).length;
    return `<h2 class="th t-${t}">${TEAMS[t].p} · ${!pool||hideOff?items.length:nc+' de '+items.length+' posibles'}</h2>`+items.map(r=>{const c=can(r.id),me=r.id===own;return `<article class="rle t-${r.t} ${me?'own':''} ${c?'':'off'}"${me?' id="ownrole"':''}><div class="ri" aria-hidden="true">${r.i}</div><div class="rb"><h3>${esc(r.n)}${me?' <span class="you">Tu personaje</span>':''}</h3><div class="rt">${TEAMS[r.t].n.toUpperCase()}</div>${!pool||hideOff?'':c?'<span class="can">✓ Puede salir en esta partida</span>':'<span class="can no">✕ No entra en esta partida</span>'}<p>${esc(r.a)}</p><p class="rw">${wakeShort(r)}</p></div></article>`}).join('');
  }).join('');
  const fil=[['all','Todos'],['town','Aldeanos'],['out','Marginados'],['min','Esbirros'],['dem','Demonios']].map(([k,l])=>`<button class="chipb" data-act="pfilter" data-k="${k}" aria-pressed="${f===k}">${l}</button>`).join('');
  const back=V||PUB?'<button class="btn primary block" data-act="volver">← Volver</button>':'';
  const st=shell(`<div class="pvtop"><div class="lbl">${esc(G.nombre)}</div></div><h1>Libro de personajes</h1>
   <p class="sub" style="text-align:center;margin:0">${!pool?'Todos los personajes del guion.':hideOff?'Los personajes que pueden salir en esta partida.':'Marcados con ✓ los personajes que el Narrador ha metido en el bote de esta partida. Que puedan salir no significa que estén en juego.'}</p>
   ${back}
   ${hbox('list','Cómo leer el libro',`<p>Todos los personajes de «${esc(G.nombre)}», agrupados por bando. Si abres el libro con tu carta revelada, tu personaje aparece resaltado; con la carta tapada no se marca, por si alguien mira tu pantalla.</p>`)}
   <details class="rules"><summary>Resumen de reglas</summary><ul>${G.reglas.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>
   <div class="fil" role="group" aria-label="Filtrar por bando">${fil}</div>
   ${groups||'<p class="sub">No hay personajes en esta categoría.</p>'}
   ${back.replace('btn primary','btn')}`,true);
  if(P.first){P.first=false;const o=$('#ownrole');if(o)o.scrollIntoView({block:'center'});else keep(0)}else keep(st);
}

/* ---- Notas privadas: solo en este móvil, se borran al cambiar de partida ---- */
function notasLeer(){
  let n=null;try{n=JSON.parse(localStorage.getItem(NOTAS)||'null')}catch(e){}
  if(!n||n.g!==V.gid||n.yo!==V.yo.nombre)n={g:V.gid,yo:V.yo.nombre,txt:'',s:{}};
  return n;
}
function notasGuardar(n){try{localStorage.setItem(NOTAS,JSON.stringify(n))}catch(e){}}
function renderNotas(){
  const n=notasLeer(),pool=new Set(V.pool),fuera=V.cfg&&V.cfg.fuera;
  const can=id=>pool.has(id);
  const opts=BANDOS.map(t=>`<optgroup label="${TEAMS[t].p}">${ROLES.filter(r=>r.t===t&&(can(r.id)||fuera)).sort((a,b)=>can(b.id)-can(a.id)).map(r=>`<option value="${r.id}">${r.i} ${esc(r.n)}${can(r.id)?'':' (no entra)'}</option>`).join('')}</optgroup>`).join('');
  const rows=V.mesa.map((q,j)=>{
    if(j===V.yo.asiento-1)return '';
    const e=n.s[q.n]||{r:[],fx:[]},k=esc(q.n);
    return `<div class="nrow"><div class="nrh"><b>${k}${q.vivo===false?' †':''}</b><span class="sub">Asiento ${j+1}</span></div>
     <div class="chips">${e.r.map(id=>R[id]?`<button class="rchip t-${R[id].t}" data-act="nrm" data-j="${k}" data-r="${id}" aria-label="Quitar ${esc(R[id].n)}">${R[id].i} ${esc(R[id].n)}${id==='borracho'&&e.dr&&R[e.dr]?' · cree ser '+R[e.dr].i+' '+esc(R[e.dr].n):''} ✕</button>`:'').join('')}
      ${e.r.includes('borracho')&&!e.dr?`<select class="nsel" data-chg="ndr" data-j="${k}" aria-label="Qué cree ser el Borracho"><option value="">🍾 Cree ser…</option>${ROLES.filter(r=>r.t==='town').map(r=>`<option value="${r.id}">${r.i} ${esc(r.n)}</option>`).join('')}</select>`:''}
      <select class="nsel" data-chg="nadd" data-j="${k}" aria-label="Añadir posible personaje de ${k}"><option value="">+ Puede ser…</option>${opts}</select></div>
     <div class="chips" style="margin-top:6px">${FX.map(f=>`<button class="chipb sm" data-act="nfx" data-j="${k}" data-f="${esc(f)}" aria-pressed="${e.fx.includes(f)}">${esc(f)}</button>`).join('')}</div></div>`;
  }).join('');
  const st=shell(`${cabecera()}<h1>Mis notas</h1>
   <p class="sub" style="text-align:center;margin:0">Solo se guardan en este móvil y se borran al empezar otra partida.</p>
   ${hbox('notes','Cómo usar las notas',`<ul><li><b>Notas libres:</b> escribe lo que quieras; se guarda solo.</li><li><b>Puede ser…:</b> añade los personajes que crees que puede ser cada jugador. Tócalos para quitarlos.</li><li>Si crees que alguien es el <b>Borracho</b>, elige qué personaje cree ser.</li><li>Las etiquetas marcan lo que crees que le pasa.</li></ul>`)}
   <button class="btn primary block" data-act="volver">← Volver a mi carta</button>
   <label class="lbl" for="pnotes">Notas libres</label>
   <textarea id="pnotes" placeholder="Quién dijo qué, a quién nominaron, tus teorías…" style="min-height:130px">${esc(n.txt)}</textarea>
   <h2 class="th" style="--tc:var(--ember)">Sospechas por jugador</h2>
   ${rows}
   <button class="btn block" data-act="volver">← Volver a mi carta</button>`,true);
  keep(st);
}

function render(){
  if(P.view==='libro')return renderLibro();
  if(!V){if(P.view==='cargando'){shell('<div class="empty">Conectando con la mesa…</div>');return}return renderJoin()}
  if(V.fase==='mesa')return renderMesa();
  if(P.view==='notas'&&V.cfg&&V.cfg.notas)return renderNotas();
  return renderCarta();
}

/* ============ Acciones ============ */
const A={
  libro:()=>{P.antes=P.view;P.view='libro';P.first=P.rev;render()},
  volver:()=>{P.view='carta';render();keep(0)},
  notas:()=>{P.view='notas';render();keep(0)},
  pfilter:(d)=>{P.f=d.k;renderLibro()},
  levantarse:()=>{if(confirm('¿Seguro que quieres levantarte de la mesa?'))enviar({t:'levantarse'})},
  ptoggle:()=>{
    const sc=$('#scene');if(!sc)return;
    P.rev=sc.classList.toggle('on');
    $('#ptog').textContent=P.rev?'Ocultar mi rol':'Revelar mi rol';
    const g=$('#pgoal');if(g)g.hidden=!P.rev;
    $('#ffront').setAttribute('aria-hidden',String(!P.rev));$('#fback').setAttribute('aria-hidden',String(P.rev));
  },
  help:(d,el)=>{const c=el.nextElementSibling;if(!c)return;c.hidden=!c.hidden;HELP[d.k]=!c.hidden;el.setAttribute('aria-expanded',String(!c.hidden))},
  nrm:(d)=>{const n=notasLeer(),e=n.s[d.j];if(e){e.r=e.r.filter(x=>x!==d.r);if(d.r==='borracho')e.dr=null;notasGuardar(n)}renderNotas()},
  nfx:(d)=>{const n=notasLeer(),e=n.s[d.j]||(n.s[d.j]={r:[],fx:[]}),i=e.fx.indexOf(d.f);if(i>=0)e.fx.splice(i,1);else e.fx.push(d.f);notasGuardar(n);renderNotas()}
};
const C={
  ndr:(d,el)=>{const n=notasLeer(),e=n.s[d.j];if(e){e.dr=el.value||null;notasGuardar(n)}renderNotas()},
  nadd:(d,el)=>{if(!el.value)return;const n=notasLeer(),e=n.s[d.j]||(n.s[d.j]={r:[],fx:[]});if(!e.r.includes(el.value))e.r.push(el.value);notasGuardar(n);renderNotas()}
};
document.addEventListener('click',e=>{const el=e.target.closest('[data-act]');if(!el||/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))return;const f=A[el.dataset.act];if(f)f(el.dataset,el)});
document.addEventListener('change',e=>{const el=e.target.closest('[data-chg]');if(!el)return;const f=C[el.dataset.chg];if(f)f(el.dataset,el)});
document.addEventListener('input',e=>{if(e.target.id==='pnotes'&&V){const n=notasLeer();n.txt=e.target.value;notasGuardar(n)}});

/* ============ Conexión ============ */
let ws=null,red=false,reintento=0,timer=null;
function wsUrl(){const u=new URL('ws/jugar',location.href);u.protocol=u.protocol==='https:'?'wss:':'ws:';return u.href}
function enviar(m){if(!ws||ws.readyState!==1)return false;ws.send(JSON.stringify(m));return true}
function marcaRed(){
  let b=$('#estado-red');
  if(red||P.view==='cargando'){if(b)b.remove();return}
  if(!b){b=document.createElement('div');b.id='estado-red';b.className='estado-red';b.setAttribute('role','status');document.body.appendChild(b)}
  b.textContent='Sin conexión · reconectando…';
}
function conectar(){
  clearTimeout(timer);
  try{ws=new WebSocket(wsUrl())}catch(e){return reconectar()}
  ws.onopen=()=>{red=true;reintento=0;marcaRed();enviar({t:'hola',token:leerToken()})};
  ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch(_){return}recibir(m)};
  ws.onclose=()=>{const habia=red;red=false;ws=null;if(P.view==='cargando'){P.view='carta'}if(habia||!V)render();reconectar()};
}
function reconectar(){marcaRed();clearTimeout(timer);timer=setTimeout(conectar,Math.min(8000,600*Math.pow(1.6,reintento++)))}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!ws){reintento=0;conectar()}});
window.addEventListener('online',()=>{if(!ws){reintento=0;conectar()}});

function recibir(m){
  if(P.view==='cargando')P.view='carta';
  switch(m.t){
    case 'token':guardarToken(m.token);P.enviando=false;P.err='';P.nombre='';break;
    case 'token-invalido':case 'expulsado':
      guardarToken(null);V=null;P.rev=false;
      if(P.view!=='libro')P.view='carta';
      toast('Ya no estás en la mesa. Puedes volver a sentarte.');
      if(m.t==='expulsado')render();
      break;
    case 'error':P.enviando=false;P.err=m.error||'Error';if(!V)render();else toast(P.err);break;
    case 'sin-sitio':PUB=m;V=null;if(P.view!=='libro')render();break;
    case 'vista':{
      const prev=V;V=m;PUB=null;
      if(!prev||prev.fase!==m.fase||prev.gid!==m.gid){P.rev=false;if(P.view!=='libro')P.view='carta'}
      else if(prev.carta&&m.carta&&prev.carta.rol!==m.carta.rol){P.rev=false;toast(m.carta.rol?'El Narrador ha cambiado tu personaje':'El Narrador te ha quitado el personaje')}
      if(prev&&prev.fase==='partida'&&m.fase==='mesa')toast('La partida ha terminado. Sigues en la mesa');
      if(prev&&prev.fase==='mesa'&&m.fase==='partida')toast('¡Personajes repartidos! Mira tu carta en secreto');
      /* En notas no se repinta (se perdería lo que estás escribiendo) salvo que cambie la partida */
      if(P.view==='notas'&&prev&&prev.gid===m.gid&&m.fase==='partida')break;
      render();
      break;
    }
  }
}

/* ============ Arranque ============ */
try{if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(function(){})}catch(e){}
if(location.hash==='#libro')P.view='libro';
render();
conectar();
