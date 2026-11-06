'use strict';
/* Grimorio de Medianoche · pantalla del director.
   La lógica del grimorio es la de la versión clásica; el estado vive en el servidor
   y cada cambio se sincroniza por WebSocket. Rutas relativas a esta página. */
const G=Reglas.guion('animas');
const TEAMS=G.equipos,ROLES=G.roles,COMP=Reglas.COMP,BANDOS=Reglas.BANDOS;
const R=Object.fromEntries(ROLES.map(r=>[r.id,r]));
const CHIPS=['Envenenado','Protegido','Maldito','Embrujado','Marcado','Falsa pista','Sin habilidad','Habilidad usada','Muere esta noche'];
/* ============ Estado ============ */
let S;
const U={gqr:false,sheet:null,card:null,stage:0,from:'',to:'',voting:null,votes:[],confirm:null,focus:null,pick:null,show:null,nres:{},ninfo:{},nfake:{}};
const T={total:180,left:180,end:null,ac:null,done:false};

const HELP={};
function hbox(k,t,html){return `<div class="help"><button class="helpb" data-act="help" data-k="${k}" aria-expanded="${!!HELP[k]}"><span aria-hidden="true">ⓘ</span> ${t}</button><div class="helpc" ${HELP[k]?'':'hidden'}>${html}</div></div>`}
const phelp=hbox;
const HTAB={
 setup:['Cómo preparar la partida',`<ol><li><b>Mesa:</b> enseña el QR para unirse. Cada jugador escribe su nombre en su móvil y aparece aquí, en orden de llegada. Arrastra ⠿ para colocarlos como estáis sentados, en círculo.</li><li><b>Personajes recomendados:</b> cuántos de cada bando salen con tu número de jugadores y cuántos conviene marcar.</li><li><b>La Noche de las Ánimas:</b> marca o desmarca qué personajes pueden salir.</li><li><b>Reparto:</b> al azar (respeta la tabla y los personajes marcados) o a mano, eligiendo el personaje de cada uno en la lista de la mesa. Cada jugador ve su carta en su móvil al empezar.</li><li><b>Terminar partida</b> (arriba) borra roles y grimorio, pero los jugadores siguen sentados y vuelven a la mesa.</li></ol>`],
 grim:['Cómo usar el grimorio',`<p>Es tu tablero secreto: la mesa vista desde arriba, con el personaje de cada jugador.</p><ul><li>Toca una ficha para cambiar su personaje, marcarlo muerto, poner recordatorios (Envenenado, Protegido…) o escribir notas.</li><li>El color del borde es su bando. El punto blanco es su voto fantasma. 🎭 indica que cree ser otro personaje (el Borracho).</li><li><b>Ocultar</b>, arriba, tapa los personajes si alguien puede ver tu pantalla.</li><li>El <b>Diario del Narrador</b>, abajo, recoge todo lo que has mostrado a cada jugador.</li></ul>`],
 night:['Cómo llevar la noche',`<p>Los pasos salen en el orden en que se despierta cada personaje en juego. Ve de arriba abajo.</p><ul><li>Los botones de cada paso son atajos: eligen jugadores, ponen y quitan fichas, calculan la respuesta y enseñan cartas en grande.</li><li>Al usar un atajo o pulsar <b>Marcar</b>, el paso queda hecho y lo que le has mostrado se apunta en el <b>Diario del Narrador</b> (en el Grimorio).</li><li>Solo puedes dar información falsa si quien despierta es el Borracho o está envenenado, o si hay un Espía o un Eremita implicado (pueden aparecer como otra cosa). Solo entonces salen las opciones para mentir. Elige lo que le dices en <b>Le has dicho</b> o pulsa <b>🎭 Dar información falsa</b>; quedará marcada como falsa en tu diario.</li><li>Al final, <b>Aplicar muertes</b> mata a quien tenga «Muere esta noche».</li></ul>`],
 day:['Cómo llevar el día',`<ul><li><b>Cuenta atrás:</b> para el debate. La duración por defecto se cambia en Ajustes de partida.</li><li><b>Nominar:</b> elige quién nomina y a quién, y abre la votación. Ve marcando quién levanta la mano, en sentido horario.</li><li>Si alcanza la mitad de los vivos, va a la hoguera. Si otro le supera después, le sustituye; si empatan, no queda nadie.</li><li>Antes de anochecer, <b>Ejecutar</b> a quien esté en la hoguera.</li></ul>`],
 cards:['Para qué sirve esta pestaña',`<ul><li><b>QR de la mesa:</b> lleva a la página de los jugadores. Sirve para sentarse y, después, para volver a su carta.</li><li><b>Libro de personajes:</b> la lista de personajes con un resumen de reglas.</li><li><b>Dirección para los jugadores:</b> la que abren los móviles. Normalmente no hace falta tocarla.</li></ul>`]
};
const defCfg=()=>({notes:true,off:true,tmin:3});
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const P=id=>S.players.find(p=>p.id===String(id));
const teamOf=p=>p&&p.role&&R[p.role]?R[p.role].t:null;
const aliveN=()=>S.players.filter(p=>p.alive).length;
const thr=()=>Math.ceil(aliveN()/2);
const names=a=>a.length?a.map(p=>esc(p.name)).join(', '):'nadie';
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function toast(m){const d=document.createElement('div');d.className='toast';d.setAttribute('role','status');d.textContent=m;document.body.appendChild(d);setTimeout(()=>d.remove(),2600)}
function commit(){render();enviarSync()}
/* ============ Lógica de partida (en el servidor) ============ */
function limpiarU(){U.sheet=null;U.voting=null;U.votes=[];U.gqr=false;U.nres={};U.ninfo={};U.nfake={};U.pick=null;U.show=null;U.card=null}
function trasEmpezar(r){
  if(!r.ok){toast(r.error);return}
  S.tab='grim';guardarUI();limpiarU();render();
  toast(r.aviso?'Roles repartidos. '+r.aviso:'Roles repartidos. Cada jugador ya ve su carta en su móvil');
}
function deal(){pedir({op:'repartir',pool:S.pool}).then(trasEmpezar)}
function startManual(){pedir({op:'empezar'}).then(trasEmpezar)}
function resetGame(){
  pedir({op:'terminar'}).then(r=>{
    if(!r.ok){toast(r.error);return}
    S.tab='setup';guardarUI();limpiarU();render();
    toast('Partida terminada. Los jugadores siguen sentados y vuelven a la mesa');
  });
}
function phase(){
  U.nres={};U.ninfo={};U.nfake={};
  if(S.night){S.night=false;S.done={};S.noms=[];S.nomd=[];S.nomr=[];S.block=null;U.voting=null;U.votes=[];S.tab='day'}
  else{S.night=true;S.day++;S.done={};S.tab='night'}
  commit();
}
function verdict(){
  if(!S.started)return '';
  const demAlive=S.players.some(p=>p.alive&&teamOf(p)==='dem');
  if(!demAlive)return 'No queda ningún Demonio vivo. Ganan los Aldeanos, salvo que una Dama del Velo siga viva con 5 o más jugadores en pie.';
  if(aliveN()<=2)return 'Quedan 2 jugadores vivos y el Demonio sigue entre ellos. Ganan los malvados.';
  return '';
}
/* ============ Pasos de la noche ============ */
function nightSteps(){
  const first=S.day===1&&S.night,out=[];
  out.push({id:'dusk',o:0,i:'🌑',n:'Anochecer',txt:'Pide a todos que cierren los ojos.'});
  ROLES.forEach(r=>{
    const ord=first?r.f:r.o;if(!ord)return;
    const hs=S.players.filter(p=>p.role===r.id||p.shown===r.id);
    if(!hs.some(p=>p.alive))return;
    out.push({id:r.id,o:ord,i:r.i,n:r.n,t:r.t,holders:hs,txt:r.r});
  });
  if(first){
    const mins=S.players.filter(p=>teamOf(p)==='min'),dems=S.players.filter(p=>teamOf(p)==='dem');
    if(mins.length)out.push({id:'minfo',o:30,i:'🕸️',n:'Los Esbirros se reconocen',t:'min',txt:'Despierta a los Esbirros a la vez. Señala al Demonio: '+names(dems)+'. Esbirros: '+names(mins)+'.'});
    if(dems.length)out.push({id:'dinfo',o:41,i:'🩸',n:'El Demonio conoce a sus Esbirros',t:'dem',txt:'Despierta al Demonio. Señala a sus Esbirros: '+names(mins)+'. Enséñale 3 faroles (roles buenos que no están en juego).',bluffs:true});
  }
  out.push({id:'dawn',o:999,i:'🌅',n:'Amanecer',txt:'Abre los ojos y anuncia quién ha muerto esta noche. Marca los fallecidos en el grimorio.'});
  return out.sort((a,b)=>a.o-b.o);
}

/* ============ Vistas ============ */
const EYE='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function header(){
  const lab=S.started?(S.night?'Noche ':'Día ')+S.day:'Preparación';
  return `<header class="top"><h1>Grimorio de Medianoche</h1><span class="chip ${S.started?(S.night?'night':'dayc'):''}">${S.started?(S.night?'☾ ':'☀ '):''}${lab}</span>${S.started?'<button class="endbtn" data-act="reset" title="Terminar partida">⏹ Terminar</button>':''}<button class="eyebtn" data-act="hide" aria-pressed="${S.hide}" aria-label="${S.hide?'Roles ocultos. Pulsa para mostrarlos':'Ocultar los roles del grimorio'}" title="${S.hide?'Roles ocultos: pulsa para mostrarlos':'Oculta los roles por si alguien mira tu pantalla'}">${S.hide?EYE_OFF:EYE}<span>${S.hide?'Oculto':'Ocultar'}</span></button></header>`;
}
function nav(){
  const tabs=[['setup','✎','Preparar'],['grim','❂','Grimorio'],['night','☾','Noche'],['day','☀','Día'],['cards','♦','Tarjetas']];
  return `<nav class="bar" aria-label="Secciones">${tabs.map(([k,g,l])=>`<button data-act="tab" data-k="${k}" ${S.tab===k?'aria-current="true"':''}><b aria-hidden="true">${g}&#xFE0E;</b>${l}</button>`).join('')}</nav>`;
}
function needStart(){return `<div class="panel empty"><p>Todavía no hay roles repartidos.</p><button class="btn primary" data-act="tab" data-k="setup">Ir a Preparar</button></div>`}

/* ---- Recomendaciones de personajes según jugadores ---- */
const PRESETS=G.presets;
const presetFor=n=>PRESETS.find(p=>n<=p.max);
function recNeed(n){
  const c=COMP[n];if(!c)return null;
  const [Tn,O,M]=c,anf=S.pool.includes('anfitrion');
  return {town:Math.min(13,Tn+3),out:Math.min(4,O+(anf?2:0)+1),min:Math.min(5,M+1),dem:n>=7?2:1,c};
}
function vRec(){
  const n=S.players.length,c=COMP[n];
  if(!c)return `<section class="panel"><h2>Personajes recomendados</h2><p class="verdict">Con ${n} jugadores no hay reparto estándar. Hacen falta entre 5 y 15.</p></section>`;
  const need=recNeed(n),pr=presetFor(n);
  const why={town:'los que salen + 3 para los faroles del Demonio',out:'los que salen + 1 de margen'+(S.pool.includes('anfitrion')?' (+2 por si sale el Anfitrión)':''),min:'los que salen + 1, para que no se sepa cuál hay',dem:n>=7?'2 para que no se sepa cuál es':'con 1 basta'};
  const rows=['town','out','min','dem'].map((t,k)=>{
    const have=ROLES.filter(r=>r.t===t&&S.pool.includes(r.id)).length,inp=c[k],ok=have>=need[t];
    return `<div class="recrow t-${t}"><b>${TEAMS[t].p}</b><span>salen <b>${inp}</b></span><span>marcados <b>${have}</b></span><span>recomendado <b>${need[t]}+</b></span><span class="${ok?'ok':(have>=inp?'meh':'bad')}">${ok?'✓':(have>=inp?'⚠ justo':'✕ faltan')}</span><small>${why[t]}</small></div>`;
  }).join('');
  const same=pr.ids.length===S.pool.length&&pr.ids.every(id=>S.pool.includes(id));
  const table=Object.keys(COMP).map(Number).map(k=>{const [a,b,m,d]=COMP[k],p=presetFor(k);return `<tr${k===n?' class="cur"':''}><td>${k}</td><td class="t-town">${a}</td><td class="t-out">${b}</td><td class="t-min">${m}</td><td class="t-dem">${d}</td><td>${p.ids.length}</td></tr>`}).join('');
  return `<section class="panel"><h2>Personajes recomendados</h2>
   ${hbox('rec','Por qué marcar más de los que salen',`<p>Si marcas justo los personajes que salen, todos sabrán qué hay en juego y el Demonio no tendrá faroles creíbles. Por eso se recomienda marcar algunos más:</p><ul><li><b>Aldeanos:</b> los que salen + 3, porque el Demonio recibe 3 personajes buenos que no están en juego para mentir.</li><li><b>Marginados y Esbirros:</b> uno más de los que salen, para que no se sepa cuál ha tocado.</li><li><b>Demonios:</b> dos a partir de 7 jugadores.</li></ul>`)}
   <p class="sub">Con <b>${n} jugadores</b> entran en juego:</p>
   <div class="comp"><span class="t-town">${c[0]} Aldeanos</span><span class="t-out">${c[1]} Marginados</span><span class="t-min">${c[2]} Esbirro${c[2]>1?'s':''}</span><span class="t-dem">${c[3]} Demonio</span></div>
   <p class="sub" style="margin-top:8px">Conviene marcar más personajes de los que salen: así nadie puede deducir qué hay en juego y el Demonio tiene 3 faroles (personajes buenos que no están). Si sale el Anfitrión Siniestro, +2 Marginados y −2 Aldeanos.</p>
   <div class="rec">${rows}</div>
   <div class="preset"><div class="lbl" style="color:var(--ember)">SELECCIÓN RECOMENDADA · ${esc(pr.n).toUpperCase()}</div><p class="sub" style="margin:4px 0">${esc(pr.d)} ${pr.ids.length} personajes.</p>
    <div class="chips">${pr.ids.map(id=>`<span class="rchip t-${R[id].t}">${R[id].i} ${esc(R[id].n)}</span>`).join('')}</div>
    <button class="btn ${same?'':'primary'} block" style="margin-top:10px" data-act="preset" ${same?'disabled':''}>${same?'✓ Ya tienes esta selección':'Aplicar selección recomendada'}</button></div>
   <details class="rules" style="margin-top:10px"><summary>Tabla de reparto (5–15 jugadores)</summary>
    <table class="rtab"><thead><tr><th>Jug.</th><th class="t-town">Ald.</th><th class="t-out">Marg.</th><th class="t-min">Esb.</th><th class="t-dem">Dem.</th><th>Recom.</th></tr></thead><tbody>${table}</tbody></table>
    <p class="sub" style="font-size:14px">Ald./Marg./Esb./Dem.: cuántos salen en juego. Recom.: personajes marcados en la selección recomendada.</p></details>
  </section>`;
}

function vCfg(){
  const c=S.cfg,tg=(k,t,d,dis)=>`<label class="pick"><input type="checkbox" data-chg="cfg" data-k="${k}" ${c[k]?'checked':''} ${dis?'disabled':''}><span class="tx"><b style="color:var(--bone)">${t}</b><small>${d}</small></span></label>`;
  return `<section class="panel"><h2>Ajustes de partida</h2><p class="sub">Afectan a lo que ven los jugadores en su móvil. Los cambios les llegan al momento.</p>
   ${hbox('cfg','Qué hace cada ajuste',`<ul><li><b>Notas personales:</b> bloc de notas y sospechas en el móvil de cada jugador. No las ve nadie más, ni tú.</li><li><b>Personajes que no entran:</b> en el libro, enseña también los que has dejado fuera, atenuados.</li></ul>`)}
   ${tg('notes','Notas personales para los jugadores','Bloc de notas y sospechas por jugador en el móvil de cada uno. Son privadas y se borran en cada partida.')}
   ${tg('off','Enseñar en el libro los personajes que no entran','Si lo quitas, el libro de personajes solo muestra los que pueden salir.')}
   <div class="field" style="margin-top:8px"><label class="lbl" for="cfgt">Duración del debate por defecto</label><select id="cfgt" data-chg="cfg" data-k="tmin">${[1,2,3,5,7,10].map(m=>`<option value="${m}" ${c.tmin===m?'selected':''}>${m} min</option>`).join('')}</select></div>
  </section>`;
}

function vReparto(){
  const n=S.players.length,rc=Reglas.recuento(G,S.players.map(p=>p.role)),alguno=S.players.some(p=>p.role);
  const cnt=BANDOS.map(t=>`<span class="t-${t} ${rc.espera&&rc.tiene[t]!==rc.espera[t]?'mal':''}">${TEAMS[t].p}: ${rc.tiene[t]}${rc.espera?' de '+rc.espera[t]:''}</span>`).join('')+(rc.sin&&alguno?`<span style="--tc:var(--dim)">Sin personaje: ${rc.sin}</span>`:'');
  return `<section class="panel"><h2>Reparto</h2>
   <p class="sub"><b>Al azar:</b> respeta la tabla para ${n} jugadores y los personajes marcados. <b>A mano:</b> elige el personaje de cada uno en la lista de la mesa y empieza. Nadie ve su carta hasta que empiece la partida.</p>
   ${alguno?`<div class="cnt">${cnt}</div>${rc.espera&&!rc.ok?'<p class="nwarn">El reparto a mano no cuadra con la tabla. Puedes empezar igualmente.</p>':''}`:''}
   <button class="btn primary block" data-act="deal" ${COMP[n]?'':'disabled'}>🎲 Repartir al azar y empezar</button>
   ${COMP[n]?'':`<p class="sub" style="text-align:center">El reparto al azar necesita entre 5 y 15 jugadores.</p>`}
   <button class="btn block" style="margin-top:8px" data-act="manual" ${alguno?'':'disabled'}>✋ Empezar con el reparto a mano</button>
  </section>`;
}
function roleOpts(sel,none){return `<option value="">${none}</option>`+BANDOS.map(t=>`<optgroup label="${TEAMS[t].p}">${ROLES.filter(r=>r.t===t).map(r=>`<option value="${r.id}" ${sel===r.id?'selected':''}>${r.i} ${esc(r.n)}</option>`).join('')}</optgroup>`).join('')}
function vSetup(){
  const n=S.players.length;
  const conn=p=>`<span class="conn ${p.movil?(p.conectado?'on':''):'nomovil'}" title="${p.movil?(p.conectado?'Conectado':'Sin conexión ahora mismo'):'Sin móvil'}"></span>`;
  const rol=p=>S.hide?'':S.started?(R[p.role]?`<span aria-label="${esc(R[p.role].n)}">${R[p.role].i}</span>`:''):`<select class="rsel" data-chg="mrole" data-id="${p.id}" aria-label="Personaje de ${esc(p.name)}">${roleOpts(p.role,'— personaje —')}</select>`;
  const plist=S.players.map((p,i)=>`<li data-id="${p.id}"><span class="asa" title="Arrastra para cambiar de asiento" aria-hidden="true">⠿</span><span class="seat">${i+1}</span>${conn(p)}<span class="nm">${esc(p.name)}</span>${rol(p)}<button class="btn sm" data-act="sheet" data-id="${p.id}" aria-label="Ficha de ${esc(p.name)}">✎</button><button class="btn sm danger" data-act="rm2" data-id="${p.id}" aria-label="Quitar a ${esc(p.name)}">✕</button></li>`).join('');
  const groups=BANDOS.map(t=>{
    const items=ROLES.filter(r=>r.t===t);
    const on=items.filter(r=>S.pool.includes(r.id)).length;
    return `<details class="t-${t}" ${t==='min'||t==='dem'?'open':''}><summary class="lbl" style="cursor:pointer;padding:6px 0;color:var(--tc)">${TEAMS[t].p} · ${on}/${items.length}</summary>${items.map(r=>`<label class="pick t-${t}"><input type="checkbox" data-chg="pool" data-id="${r.id}" ${S.pool.includes(r.id)?'checked':''}><span class="ic">${r.i}</span><span class="tx"><b>${esc(r.n)}</b><small>${esc(r.a)}</small></span></label>`).join('')}</details>`;
  }).join('');
  const live=S.started?`<section class="panel" style="border-color:var(--ember)"><h2>Partida en curso</h2><p class="sub">Cada jugador ve su carta en su móvil. Cambia roles desde la ficha de cada jugador en el Grimorio. Si alguien se une ahora, aparece sin personaje: dale uno desde su ficha.</p>
    <div class="row" style="margin-top:8px"><button class="btn" data-act="deal">🎲 Volver a repartir al azar</button><button class="btn danger" data-act="reset">⏹ Terminar partida</button></div></section>`:'';
  return `<div class="wrap">
  ${live}
  <button class="btn primary block" data-act="gameqr">▣ QR para unirse a la mesa</button>
  <button class="btn block" data-act="bookqr">📖 QR del libro de personajes</button>
  <section class="panel"><h2>Mesa · ${n} sentado${n===1?'':'s'}</h2><p class="sub">Los jugadores aparecen al unirse desde su móvil, en orden de llegada. Arrastra ⠿ para colocarlos como estáis sentados, en círculo. <span class="conn on"></span> conectado · <span class="conn"></span> sin conexión · <span class="conn nomovil"></span> sin móvil.</p>
   ${n?`<ul class="plist" id="plist">${plist}</ul>`:'<p class="empty">Todavía no se ha sentado nadie. Enseña el QR para unirse.</p>'}
   <div class="row"><input type="text" id="newname" placeholder="Añadir jugador sin móvil" maxlength="24" autocomplete="off" style="flex:1;min-width:140px"><button class="btn" data-act="add">Añadir</button></div>
   <div class="row" style="margin-top:8px"><button class="btn sm" data-act="shuf" ${n>1?'':'disabled'}>Barajar asientos</button><button class="btn sm danger" data-act="clear" ${n?'':'disabled'}>Vaciar la mesa</button></div>
  </section>
  ${vRec()}
  <section class="panel"><h2>${esc(G.nombre)}</h2><p class="sub">Guion propio con ${ROLES.length} personajes. Marca o desmarca a mano los que quieras que puedan salir en la partida.</p>${groups}</section>
  ${S.started?'':vReparto()}
  ${vCfg()}
  <p class="legal">Proyecto de aficionados con personajes originales, inspirado en la mecánica de Blood on the Clocktower. No está afiliado a The Pandemonium Institute.</p>
  </div>`;
}
function ringSVG(){
  let t='';
  for(let i=0;i<48;i++){const a=i*Math.PI/24,r1=i%4===0?45.6:47,r2=48.6;t+=`<line x1="${(50+r1*Math.cos(a)).toFixed(2)}" y1="${(50+r1*Math.sin(a)).toFixed(2)}" x2="${(50+r2*Math.cos(a)).toFixed(2)}" y2="${(50+r2*Math.sin(a)).toFixed(2)}"/>`}
  return `<svg class="runes" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48.6"/><circle cx="50" cy="50" r="27"/><circle cx="50" cy="50" r="25.6" stroke-dasharray="2.5 1.4"/>${t}</svg>`;
}
function narrLog(){
  if(!S.started||!(S.log||[]).length)return '';
  const ix=id=>S.players.findIndex(p=>p.id===id),cv=v=>Array.isArray(v)?v.map(cv):v&&v.p!=null?ix(v.p):v&&v.r!=null?ROLES.findIndex(r=>r.id===v.r):v;
  const sv=[PV.G,PV.i];PV.G={ps:S.players.map(p=>[p.name])};PV.i=-1;
  let last=-1,h='';
  S.log.slice().sort((a,b)=>(a.n*2+(a.d?1:0))-(b.n*2+(b.d?1:0))).forEach(e=>{
    const key=e.n*2+(e.d?1:0),hd=e.to==='all'?[0,0,-1]:[0,0,[]];
    if(key!==last){last=key;h+=`<div class="lbl" style="margin-top:8px">${phaseName(key).toUpperCase()}</div>`}
    const who=e.to==='all'?'Toda la mesa':names(e.to.map(P).filter(Boolean)),f=isFalse(e);
    h+=`<div class="hev ${e.to==='all'?'pub':''} ${f?'fake':''}"><span class="sub">${who} ${e.w==='b'?'(Borracho)':e.w==='e'?'(envenenado)':''}</span><br>${histText([key,e.k,hd[2],...e.a.map(cv)])}${f?`<div class="hfx"><span class="ftag">🎭 Falsa</span> <span class="sub">Verdad: ${histText([key,e.k,hd[2],...e.t.map(cv)])}</span></div>`:''}</div>`;
  });
  [PV.G,PV.i]=sv;
  const nf=S.log.filter(isFalse).length;
  return `<details class="rules"><summary>📜 Diario del Narrador · ${S.log.length} sucesos${nf?' · '+nf+' falsos':''}</summary><p class="sub" style="font-size:14px">Todo lo que has mostrado, a quién y si era falso. Los jugadores solo ven lo suyo, en segunda persona.</p><div class="lst" style="gap:6px">${h}</div></details>`;
}
function vGrim(){
  const n=S.players.length;if(!n)return `<div class="panel empty">Todavía no hay nadie sentado. Enseña el QR de la mesa desde Preparar.</div>`;
  const toks=grimToks(false);
  const v=verdict();
  return vGrimBody(toks,v);
}
function grimToks(all){
  const n=S.players.length,sz=Math.min(19,215/Math.max(n,5)),R0=37,hide=S.hide&&!all;
  return S.players.map((p,i)=>{
    const a=-Math.PI/2+i*2*Math.PI/n,x=50+R0*Math.cos(a),y=50+R0*Math.sin(a);
    const r=p.role?R[p.role]:null,tm=r?r.t:null;
    const glyph=hide?'☾':(r?r.i:'?');
    const tc=hide||!tm?'var(--dim)':`var(--${tm})`;
    if(all)return `<div class="tok ${p.alive?'':'dead'}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--sz:${sz.toFixed(2)};--tc:${tc}"><span class="medal">${glyph}${!p.alive&&p.ghost?'<i class="pip"></i>':''}${p.rem.length?`<span class="bdg">${p.rem.length}</span>`:''}${p.shown?'<span class="mask">🎭</span>':''}</span><span class="tname">${esc(p.name)}</span></div>`;
    return `<button class="tok ${p.alive?'':'dead'}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--sz:${sz.toFixed(2)};--tc:${tc}" data-act="sheet" data-id="${p.id}" aria-label="${esc(p.name)}${r&&!S.hide?', '+esc(r.n):''}${p.alive?'':', muerto'}"><span class="medal">${glyph}${!p.alive&&p.ghost?'<i class="pip" title="Conserva su voto fantasma"></i>':''}${p.rem.length&&!S.hide?`<span class="bdg">${p.rem.length}</span>`:''}${!S.hide&&p.shown?'<span class="mask">🎭</span>':''}</span><span class="tname">${esc(p.name)}</span></button>`;
  }).join('');
}
function vGrimBody(toks,v){
  return `<div class="wrap">
   ${v?`<div class="verdict" role="status">${esc(v)}</div>`:''}
   <div class="ring ${S.hide?'veil':''}">${ringSVG()}${toks}<div class="core"><div class="moon">${S.night?'🌕':'🎃'}</div><div class="ph">${S.started?(S.night?'Noche ':'Día ')+S.day:'Sin repartir'}</div><div class="st">${aliveN()} vivos · hacen falta ${thr()} votos</div>${S.hide?'<div class="veiltag">◉ Roles ocultos</div>':''}</div></div>
   <div class="legend"><span class="t-town"><i></i>Aldeano</span><span class="t-out"><i></i>Marginado</span><span class="t-min"><i></i>Esbirro</span><span class="t-dem"><i></i>Demonio</span><span>● voto fantasma</span><span>🎭 cree ser otro</span></div>
   ${S.started?`<button class="btn primary block" data-act="phase">${S.night?'☀ Amanece':'☾ Anochece'}</button>`:needStart()}
   <p class="sub" style="text-align:center">Toca una ficha para cambiar su rol, marcarla muerta o poner recordatorios.</p>
   ${narrLog()}
  </div>`;
}

/* ---- Atajos de la noche ---- */
const isEvil=p=>['min','dem'].includes(teamOf(p));
const holdersOf=id=>S.players.filter(p=>p.role===id||p.shown===id);
function markOnly(chip,id){S.players.forEach(p=>{const i=p.rem.indexOf(chip);if(i>=0)p.rem.splice(i,1)});const p=P(id);if(p&&!p.rem.includes(chip))p.rem.push(chip)}
function addChip(p,chip){if(!p.rem.includes(chip))p.rem.push(chip)}
const safe=p=>p.rem.includes('Protegido')||(p.role==='soldado'&&!p.rem.includes('Envenenado'));
function tokenCard(rid,mini){const r=R[rid];if(!r)return '';return `<div class="card ${mini?'mini':''}" style="--tc:var(--${r.t})"><div class="ct">${TEAMS[r.t].n.toUpperCase()}</div><div class="ci">${r.i}</div><h2>${esc(r.n)}</h2><p class="ab">${esc(r.a)}</p></div>`}
/* Diario del Narrador: cada suceso guarda a quién se mostró (ids de jugador o 'all'). Refs: {p:id} jugador, {r:id} personaje. */
const pr=id=>({p:id}),rr=id=>({r:id});
function relog(st){if(logGet(st)){S.log=S.log.filter(e=>!(e.n===S.day&&!e.d&&e.s===st));autoLog(st)}}
const hid=st=>holdersOf(st).filter(p=>p.alive||st==='murcielago').map(p=>p.id);
function logSet(st,k,to,a,t){
  S.log=(S.log||[]).filter(e=>!(e.n===S.day&&!e.d&&e.s===st));
  if(to!=='all'&&!to.length)return;
  const ps=to==='all'?[]:to.map(P).filter(Boolean),w=ps.some(p=>p.shown===st&&p.role!==st)?'b':ps.some(p=>p.rem.includes('Envenenado'))?'e':'';
  S.log.push({n:S.day,s:st,k,to,a,t:JSON.parse(JSON.stringify(t||a)),w});
}
const isFalse=e=>!!e.t&&JSON.stringify(e.a)!==JSON.stringify(e.t);
/* Información falsa para Bibliotecaria, Cronista y Detective: un personaje del tipo y 2 jugadores que no lo tienen */
function genFake(id){
  const t={bibliotecaria:'out',cronista:'town',detective:'min'}[id],hs=holdersOf(id).map(p=>p.id);
  const r=shuffle(ROLES.filter(x=>x.t===t))[0],c=shuffle(S.players.filter(p=>!hs.includes(p.id)&&p.role!==r.id&&p.shown!==r.id)).slice(0,2);
  return {r:r.id,ids:c.map(p=>p.id),fake:true};
}
const infoArr=inf=>inf.none?[]:[rr(inf.r),...inf.ids.map(pr)];
const logGet=st=>(S.log||[]).find(e=>e.n===S.day&&!e.d&&e.s===st);
function faroInfo(p){const al=S.players.filter(q=>q.alive||q.id===p.id),i=al.indexOf(p);if(al.length<3)return null;const nb=[al[(i-1+al.length)%al.length],al[(i+1)%al.length]];return{nb,n:nb.filter(isEvil).length}}
function autoLog(st){
  if(logGet(st))return;
  const dems=S.players.filter(p=>teamOf(p)==='dem'),mins=S.players.filter(p=>teamOf(p)==='min');
  switch(st){
    case 'minfo':logSet(st,'m',mins.map(p=>p.id),[dems.map(p=>pr(p.id)),mins.map(p=>pr(p.id))]);break;
    case 'dinfo':logSet(st,'d',dems.map(p=>p.id),[mins.map(p=>pr(p.id)),S.bluffs.map(rr)]);break;
    case 'espia':logSet(st,'e',hid(st),[]);break;
    case 'farolero':{const h=holdersOf(st).find(p=>p.alive),f=h&&faroInfo(h);if(f)logSet(st,'f',[h.id],[f.n]);break}
    case 'sepulturero':{const e=S.exec&&S.exec.day===S.day-1?P(S.exec.id):null;if(e)logSet(st,'s',hid(st),[pr(e.id),rr(e.role)]);break}
    case 'bibliotecaria':case 'cronista':case 'detective':{const inf=U.ninfo[st],fk=U.nfake[st];if(inf)logSet(st,'i',hid(st),infoArr(fk||inf),infoArr(inf));break}
  }
}
const PICKS={
  envenenadora:{s:'envenenadora',n:1,t:'¿A quién envenena?',run:([a])=>{markOnly('Envenenado',a);logSet('envenenadora','p',hid('envenenadora'),[pr(a)]);return `☠️ <b>${esc(P(a).name)}</b> queda envenenado (se quitó la marca anterior).`}},
  bruja:{s:'bruja',n:1,t:'¿A quién embruja?',run:([a])=>{markOnly('Embrujado',a);logSet('bruja','w',hid('bruja'),[pr(a)]);return `🐈‍⬛ <b>${esc(P(a).name)}</b> queda embrujado: si nomina mañana, muere en el acto.`}},
  guardiana:{s:'guardiana',n:1,t:'¿A quién protege?',run:([a])=>{markOnly('Protegido',a);logSet('guardiana','g',hid('guardiana'),[pr(a)]);return `🧂 <b>${esc(P(a).name)}</b> está protegido esta noche.`}},
  calabaza:{s:'calabaza',n:1,t:'¿A quién ataca la Calabaza?',run:([a])=>{
    const p=P(a);logSet('calabaza','k',hid('calabaza'),[pr(a)]);
    if(teamOf(p)==='dem'&&p.role==='calabaza'){addChip(p,'Muere esta noche');const mins=S.players.filter(q=>q.alive&&teamOf(q)==='min');return `🎃 Se ha elegido a sí misma: <b>${esc(p.name)}</b> muere. ${mins.length?'Convierte a un Esbirro vivo ('+names(mins)+') en la Calabaza Hueca desde su ficha en el grimorio y avísale.':'No quedan Esbirros vivos.'}`}
    if(safe(p))return `🛡️ <b>${esc(p.name)}</b> no muere: ${p.rem.includes('Protegido')?'está protegido':'es el Soldado de Paja'}.`;
    addChip(p,'Muere esta noche');
    return `🎃 <b>${esc(p.name)}</b> morirá al amanecer.${p.role==='alcaldesa'&&!p.rem.includes('Envenenado')?' Es la Alcaldesa: puedes hacer que muera otro jugador en su lugar.':''}`}},
  jinete:{s:'jinete',n:1,t:'¿A quién maldice el Jinete?',run:([a])=>{
    logSet('jinete','h',hid('jinete'),[pr(a)]);const prev=S.players.find(q=>q.rem.includes('Maldito'));let t='';
    if(prev&&prev.alive){if(safe(prev))t=`<b>${esc(prev.name)}</b> (maldito anterior) se salva: ${prev.rem.includes('Protegido')?'está protegido':'es el Soldado de Paja'}. `;else{addChip(prev,'Muere esta noche');t=`<b>${esc(prev.name)}</b> (maldito anterior) muere ahora. `}}
    markOnly('Maldito',a);return `🐴 ${t}<b>${esc(P(a).name)}</b> queda maldito.`}},
  vidente:{s:'vidente',n:2,any:true,t:'¿Qué 2 jugadores elige la Vidente?',run:(ids)=>{
    const ps=ids.map(P),yes=ps.some(p=>teamOf(p)==='dem'||p.rem.includes('Falsa pista'));
    logSet('vidente','v',hid('vidente'),[pr(ids[0]),pr(ids[1]),yes?1:0]);
    return `🔮 ${names(ps)}: <span class="big2">${yes?'SÍ':'NO'}</span> — ${yes?'asiente':'niega con la cabeza'}.`}},
  vidente_fp:{s:'vidente',nodone:true,n:1,any:true,good:true,t:'¿Quién es la falsa pista de la Vidente? (un jugador bueno)',run:([a])=>{markOnly('Falsa pista',a);return `🔮 <b>${esc(P(a).name)}</b> es la falsa pista: a la Vidente siempre le aparece como Demonio.`}},
  costurera:{s:'costurera',n:2,any:true,t:'¿Qué 2 jugadores elige la Costurera?',run:(ids)=>{
    const ps=ids.map(P),same=isEvil(ps[0])===isEvil(ps[1]);
    logSet('costurera','c',hid('costurera'),[pr(ids[0]),pr(ids[1]),same?1:0]);
    holdersOf('costurera').forEach(p=>addChip(p,'Habilidad usada'));
    return `🧵 ${names(ps)}: <span class="big2">${same?'SÍ':'NO'}</span> — ${same?'son del mismo bando, asiente':'son de bandos distintos, niega'}. Marcada «Habilidad usada».`}},
  murcielago:{s:'murcielago',n:1,any:true,t:'¿A quién elige el Murciélago?',run:([a])=>{logSet('murcielago','b',hid('murcielago'),[pr(a),rr(P(a).role)]);U.show={k:'role',r:P(a).role,x:'Este es el personaje de '+P(a).name};return `🦇 Enséñale la ficha de <b>${esc(P(a).name)}</b>: ${R[P(a).role]?R[P(a).role].i+' '+esc(R[P(a).role].n):'sin personaje'}.`}}
};
function genInfo(id){
  const t={bibliotecaria:'out',cronista:'town',detective:'min'}[id],hs=holdersOf(id).map(p=>p.id);
  const c=S.players.filter(p=>teamOf(p)===t&&!hs.includes(p.id));
  if(!c.length)return {none:true};
  const a=shuffle(c)[0],b=shuffle(S.players.filter(p=>p.id!==a.id&&!hs.includes(p.id)))[0];
  return {r:a.role,ids:shuffle([a,b].filter(Boolean)).map(p=>p.id)};
}
/* Solo se puede mentir si quien recibe la información es el Borracho o está envenenado,
   o si hay un Espía o un Eremita implicado (pueden registrarse como otra cosa). */
function lieWhy(sid,inv){
  const hs=holdersOf(sid).filter(p=>p.alive||sid==='murcielago');
  if(hs.some(p=>p.shown===sid&&p.role!==sid))return 'es el Borracho';
  if(hs.some(p=>p.rem.includes('Envenenado')))return 'está envenenado';
  const odd=(inv||[]).filter(p=>p&&(p.role==='espia'||p.role==='eremita'));
  return odd.length?odd.map(p=>esc(p.name)+' ('+(p.role==='espia'?'Espía':'Eremita')+')').join(', ')+' puede registrarse como otra cosa':'';
}
const infoInv=sid=>S.players.filter(p=>p.alive&&p.role===(sid==='detective'?'eremita':'espia'));
const ids2p=a=>a.filter(v=>v&&v.p!=null).map(v=>P(v.p));
function nightTools(s){
  const pb=(k,l)=>`<button class="btn sm" data-act="npick" data-k="${k}">${l}</button>`;
  const sb=(k,l,extra='')=>`<button class="btn sm" data-act="nshow" data-k="${k}" ${extra}>${l}</button>`;
  let b='',warn='';
  if(s.holders){
    const bad=s.holders.filter(p=>(p.shown===s.id&&p.role!==s.id)||p.rem.includes('Envenenado'));
    if(bad.length)warn=`<div class="nwarn">⚠ ${names(bad)} ${bad.length>1?'están':'está'} borracho o envenenado: su habilidad falla y puedes darle información falsa.</div>`;
  }
  switch(s.id){
    case 'envenenadora':b=pb('envenenadora','☠️ Elegir envenenado');break;
    case 'bruja':b=pb('bruja','🐈‍⬛ Elegir embrujado');break;
    case 'guardiana':b=pb('guardiana','🧂 Elegir protegido');break;
    case 'calabaza':b=pb('calabaza','🎃 Elegir víctima');break;
    case 'jinete':b=pb('jinete','🐴 Elegir maldito');break;
    case 'vidente':{
      const fp=S.players.find(p=>p.rem.includes('Falsa pista'));
      b=fp?`<span class="sub">Falsa pista: <b>${esc(fp.name)}</b>.</span>`+pb('vidente','🔮 Elegir 2 jugadores'):pb('vidente_fp','🎯 Poner falsa pista')+`<button class="btn sm" disabled title="Primero pon la falsa pista">🔮 Elegir 2 jugadores</button><span class="sub" style="font-size:13px">Primero elige la falsa pista: un jugador bueno que a la Vidente le aparecerá como Demonio.</span>`;
      break}
    case 'costurera':b=U.nres.costurera?'':s.holders.some(p=>p.rem.includes('Habilidad usada'))?'<span class="sub">Ya usó su habilidad: no la despiertes.</span>':pb('costurera','🧵 Elegir 2 jugadores');break;
    case 'murcielago':b=s.holders.some(p=>p.rem.includes('Muere esta noche'))?pb('murcielago','🦇 Elegir jugador'):'<span class="sub">No muere esta noche: no lo despiertes.</span>';break;
    case 'farolero':{
      const out=s.holders.filter(p=>p.alive).map(p=>{
        const fi=faroInfo(p);
        if(!fi)return `${esc(p.name)}: no tiene 2 vecinos vivos.`;
        const {nb,n}=fi;
        const odd=nb.filter(q=>q.role==='espia'||q.role==='eremita');
        return `🏮 Vecinos de ${esc(p.name)}: ${names(nb)} → <span class="big2">${n}</span> ${n===1?'dedo':'dedos'}.${odd.length?` <span class="nwarn">${names(odd)} puede registrarse distinto (Espía/Eremita): decides tú.</span>`:''}`});
      const lg=logGet('farolero'),fh=s.holders.find(p=>p.alive),ff=fh&&faroInfo(fh),why=ff?lieWhy('farolero',ff.nb):'';
      b=`<div class="nres">${out.join('<br>')}</div>`+(out.length&&(why||(lg&&isFalse(lg)))?`<div class="row"><span class="sub">Le has enseñado:</span>${[0,1,2].map(v=>`<button class="chipb" data-act="nfaro" data-v="${v}" aria-pressed="${!!lg&&lg.a[0]===v}">${v}</button>`).join('')}${lg&&isFalse(lg)?'<span class="ftag">🎭 Información falsa</span>':''}${why?`<span class="sub" style="font-size:13px">Puedes mentir: ${why}.</span>`:''}</div>`:'');break}
    case 'sepulturero':{
      const e=S.exec&&S.exec.day===S.day-1?P(S.exec.id):null;
      b=e?`<span>Hoy fue ejecutado <b>${esc(e.name)}</b>.</span>`+sb('exec','⚰️ Enseñar su ficha'):'<span class="sub">Hoy no hubo ejecución registrada: no lo despiertes.</span>';break}
    case 'bibliotecaria':case 'cronista':case 'detective':{
      const inf=U.ninfo[s.id],why=lieWhy(s.id,infoInv(s.id));
      const fb=why?`<button class="btn sm" data-act="nfake" data-id="${s.id}" title="Puedes mentir: ${why}">🎭 Dar información falsa</button>`:'';
      if(!inf)b=`<button class="btn sm" data-act="ninfo" data-id="${s.id}">✨ Generar información</button>${fb}`;
      else if(inf.none&&!U.nfake[s.id])b=`<div class="nres">No hay ${s.id==='bibliotecaria'?'Marginados':'personajes de ese tipo'} en juego: haz el gesto de cero.</div><button class="btn sm" data-act="ninfo" data-id="${s.id}">↻ Repetir</button>${fb}`;
      else if(inf.none){const fk=U.nfake[s.id];b=`<div class="nres fake"><span class="ftag">🎭 Información falsa</span> Ficha ${R[fk.r].i} <b>${esc(R[fk.r].n)}</b> · señala a ${names(fk.ids.map(P))}.<br><span class="sub">La verdad: no hay ninguno en juego.</span></div><div class="row">${sb('info','🃏 Enseñar ficha',`data-id="${s.id}"`)}<button class="btn sm" data-act="nfake" data-id="${s.id}">↻ Otra falsa</button><button class="btn sm" data-act="ntrue" data-id="${s.id}">✓ Dar la verdadera</button></div>`}
      else{const fk=U.nfake[s.id],sh=fk||inf;
        b=`<div class="nres ${fk?'fake':''}">${fk?'<span class="ftag">🎭 Información falsa</span> ':''}Ficha ${R[sh.r].i} <b>${esc(R[sh.r].n)}</b> · señala a ${names(sh.ids.map(P))}.${fk?`<br><span class="sub">La verdadera era: ${R[inf.r].i} ${esc(R[inf.r].n)} · ${names(inf.ids.map(P))}.</span>`:''}</div><div class="row">${sb('info','🃏 Enseñar ficha',`data-id="${s.id}"`)}${fk?`<button class="btn sm" data-act="nfake" data-id="${s.id}">↻ Otra falsa</button><button class="btn sm" data-act="ntrue" data-id="${s.id}">✓ Dar la verdadera</button>`:`<button class="btn sm" data-act="ninfo" data-id="${s.id}">↻ Otra opción</button>${fb}`}</div>`}
      break}
    case 'espia':b=sb('spy','🕷️ Enseñar el grimorio al Espía');break;
    case 'minfo':b=sb('demon','🩸 Enseñar quién es el Demonio');break;
    case 'dinfo':b=sb('minions','🕸️ Enseñar sus Esbirros')+sb('bluffs','🃏 Enseñar los 3 faroles');break;
    case 'dawn':{
      const d=S.players.filter(p=>p.rem.includes('Muere esta noche'));
      b=`<button class="btn sm primary" data-act="ndawn">🌅 Aplicar muertes${d.length?': '+names(d):' (nadie)'}</button>`;break}
  }
  let res=U.nres[s.id];
  const lg=logGet(s.id);
  const why=lg?lieWhy(s.id,ids2p(lg.t)):'';
  if(lg&&(lg.k==='v'||lg.k==='c')&&(why||isFalse(lg)))res=(res||'')+`<div class="row" style="margin-top:6px"><span class="sub">Le has dicho:</span>${[1,0].map(v=>`<button class="chipb" data-act="nans" data-s="${s.id}" data-v="${v}" aria-pressed="${lg.a[2]===v}">${v?'SÍ':'NO'}</button>`).join('')}${isFalse(lg)?'<span class="ftag">🎭 Información falsa</span>':''}${why?`<span class="sub" style="font-size:13px">Puedes mentir: ${why}.</span>`:''}</div>`;
  if(lg&&(lg.k==='s'||lg.k==='b')&&(why||isFalse(lg)))res=(res||'')+`<div class="row" style="margin-top:6px"><label class="sub" for="nr-${s.id}">Ficha que le enseñaste:</label><select id="nr-${s.id}" class="nsel" data-chg="nrole" data-s="${s.id}">${ROLES.map(r=>`<option value="${r.id}" ${lg.a[1].r===r.id?'selected':''}>${r.i} ${esc(r.n)}</option>`).join('')}</select>${isFalse(lg)?'<span class="ftag">🎭 Información falsa</span>':''}</div>`;
  if(!b&&!warn&&!res)return '';
  return `<div class="ntools">${warn}${b?`<div class="row">${b}</div>`:''}${res?`<div class="nres">${res}</div>`:''}</div>`;
}

function vNight(){
  if(!S.started)return needStart();
  if(!S.night)return `<div class="wrap"><div class="panel empty"><p>Es de día. La noche empieza cuando pulses Anochece.</p><button class="btn primary" data-act="phase">☾ Anochece</button></div></div>`;
  const steps=nightSteps();
  const html=steps.map(s=>{
    const done=S.done[s.id];
    const who=s.holders?s.holders.map(p=>{
      const tags=[];if(!p.alive)tags.push('muerto');if(p.shown===s.id&&p.role!==s.id)tags.push('es el Borracho: su habilidad falla');
      return `<b>${esc(p.name)}</b>${tags.length?` <em>(${tags.join(', ')})</em>`:''}`}).join(', '):'';
    const bl=s.bluffs?`<div class="faro">${S.bluffs.map(id=>`<span>${R[id].i} ${esc(R[id].n)}</span>`).join('')}</div>`:'';
    return `<div class="step ${done?'done':''} ${s.t?'t-'+s.t:''}"><span class="ic" aria-hidden="true">${s.i}</span><h3>${esc(s.n)}</h3><button class="btn sm" data-act="done" data-id="${s.id}" aria-pressed="${!!done}">${done?'Hecho ✓':'Marcar'}</button>${who?`<div class="who">${who}</div>`:'<div></div>'}<div class="rem">${esc(s.txt)}${bl}</div>${nightTools(s)}</div>`;
  }).join('');
  const pend=steps.filter(s=>!S.done[s.id]).length;
  return `<div class="wrap"><div class="panel"><h2>Noche ${S.day}${S.day===1?' · primera noche':''}</h2><p class="sub">${pend?pend+' pasos pendientes':'Todos los pasos hechos'}. Orden de despertar para los personajes en juego.</p></div>${html}<button class="btn primary block" data-act="phase">☀ Amanece</button></div>`;
}

function vDay(){
  if(!S.started)return needStart();
  const t=thr(),blk=S.block?P(S.block.id):null,v=verdict();
  const timer=`<section class="panel timer ${T.done?'end':''}" id="timerbox"><h2>Cuenta atrás</h2><div class="big" id="tmr">${fmt(T.left)}</div>
   <div class="row" style="justify-content:center;margin-top:10px"><button class="btn" data-act="tstart">${T.end?'Pausar':'Iniciar'}</button><button class="btn" data-act="treset">Reiniciar</button></div>
   <div class="row" style="justify-content:center;margin-top:8px">${[1,3,5,10].map(m=>`<button class="btn sm" data-act="tset" data-m="${m}">${m} min</button>`).join('')}</div></section>`;
  if(S.night)return `<div class="wrap"><div class="panel empty"><p>Es de noche. Las nominaciones se abren al amanecer.</p><button class="btn primary" data-act="phase">☀ Amanece</button></div>${timer}</div>`;
  const tiles=`<div class="tiles"><div class="tile"><b>${aliveN()}</b><span>VIVOS</span></div><div class="tile"><b>${t}</b><span>VOTOS PARA EJECUTAR</span></div><div class="tile"><b>${blk?S.block.n:'–'}</b><span>${blk?'EN LA HOGUERA: '+esc(blk.name).toUpperCase():'HOGUERA VACÍA'}</span></div></div>`;
  let nomUI;
  if(U.voting){
    const to=P(U.voting.to),from=P(U.voting.from),ps=S.players,idx=ps.indexOf(to);
    const ord=[...ps.slice(idx+1),...ps.slice(0,idx+1)];
    const cnt=U.votes.length;
    nomUI=`<section class="panel"><h2>Votación</h2><p><b>${esc(from.name)}</b> nomina a <b>${esc(to.name)}</b>. Se vota en sentido horario, empezando por quien está tras el nominado.</p>
     <div class="big" style="margin-top:6px">${cnt} <span class="sub" style="font-size:22px">de ${t} necesarios</span></div>
     <div class="bar2 ${cnt>=t?'ok':''}"><i style="width:${Math.min(100,t?cnt/t*100:0)}%"></i></div>
     ${ord.map(p=>{const can=p.alive||p.ghost,on=U.votes.includes(p.id);return `<button class="vote" data-act="vote" data-id="${p.id}" aria-pressed="${on}" ${can?'':'disabled'}><span class="ck" aria-hidden="true">${on?'✓':''}</span><span style="flex:1">${esc(p.name)}</span><span class="sub">${p.alive?'':(p.ghost?'muerto · voto fantasma':'muerto · sin voto')}</span></button>`}).join('')}
     <div class="row" style="margin-top:12px"><button class="btn primary" data-act="closevote">Cerrar votación</button><button class="btn" data-act="cancelvote">Cancelar</button></div></section>`;
  }else{
    const fr=S.players.filter(p=>p.alive&&!S.nomr.includes(p.id)),tt=S.players.filter(p=>!S.nomd.includes(p.id));
    if(!fr.some(p=>p.id===U.from))U.from=fr[0]?String(fr[0].id):'';
    if(!tt.some(p=>p.id===U.to))U.to=tt[0]?String(tt[0].id):'';
    nomUI=`<section class="panel"><h2>Nominar</h2><p class="sub">Cada jugador vivo nomina una vez por día y solo puede ser nominado una vez.</p>
     <div class="field" style="margin-top:8px"><label class="lbl" for="selfrom">Nominador</label><select id="selfrom" data-chg="from">${fr.map(p=>`<option value="${p.id}" ${U.from===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
     <div class="field" style="margin-top:8px"><label class="lbl" for="selto">Nominado</label><select id="selto" data-chg="to">${tt.map(p=>`<option value="${p.id}" ${U.to===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
     <button class="btn primary block" style="margin-top:12px" data-act="openvote" ${fr.length&&tt.length?'':'disabled'}>Abrir votación</button></section>`;
  }
  const nl=S.noms.length?`<section class="panel"><h2>Nominaciones de hoy</h2>${S.noms.map(m=>`<div class="nomli">${esc(P(m.from)?.name)} → <b>${esc(P(m.to)?.name)}</b>: ${m.n} voto${m.n===1?'':'s'}${m.n>=m.t?' (alcanza el umbral)':''}</div>`).join('')}</section>`:'';
  const exe=blk?`<section class="panel" style="border-color:var(--ember)"><h2>En la hoguera: ${esc(blk.name)}</h2><p>${S.block.n} votos. Si nadie lo supera antes del anochecer, será ejecutado.</p><div class="row"><button class="btn primary" data-act="exec">Ejecutar a ${esc(blk.name)}</button><button class="btn" data-act="spare">Perdonar</button></div></section>`:'';
  return `<div class="wrap">${v?`<div class="verdict" role="status">${esc(v)}</div>`:''}${tiles}${exe}${nomUI}${nl}${timer}<button class="btn primary block" data-act="phase">☾ Anochece</button></div>`;
}
const fmt=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');

let URL_SERV='';
const defUrl=()=>URL_SERV||new URL('jugar',location.href).href;
const urlJug=()=>String(S.baseUrl||'').trim()||defUrl();
const rolesUrl=()=>urlJug().split('#')[0]+'#libro';
function vCards(){
  const u=urlJug();
  return `<div class="wrap"><div class="panel"><h2>QR de la mesa</h2><p class="sub">Un único QR para toda la mesa. Cada jugador lo escanea, escribe su nombre y queda sentado. Cuando repartas verá su carta, y si recarga o pierde cobertura vuelve solo a su sitio. Si alguien no tiene móvil, añádelo en Preparar y enséñale su carta desde su ficha en el grimorio.</p>
  <button class="btn primary block" style="margin-top:10px" data-act="gameqr">▣ Mostrar QR de la mesa</button></div>
  <div class="panel"><h2>Libro de personajes</h2><p class="sub">La lista de personajes con un resumen de reglas. Los jugadores también lo abren desde su carta.</p>
  <div class="qrframe" style="margin:10px auto;width:min(60vw,220px)">${qrSVG(rolesUrl())}</div>
  <div class="row" style="justify-content:center"><button class="btn sm" data-act="copyroles">Copiar enlace</button></div></div>
  <div class="panel"><h2>Dirección para los jugadores</h2><p class="sub">La que abren los móviles de la mesa. Déjala vacía para usar la predeterminada: <b>${esc(defUrl())}</b></p>
  <input type="text" id="baseurl" data-chg="baseurl" value="${esc(S.baseUrl||'')}" placeholder="${esc(defUrl())}" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Dirección para los jugadores">
  <p class="sub" style="margin-top:6px">Ahora el QR lleva a: ${esc(u)}</p></div>
  <div class="panel"><h2>Sesión</h2><p class="sub">Esta pantalla queda abierta 30 días en este dispositivo.</p><button class="btn" data-act="logout">Cerrar sesión de director</button></div></div>`;
}
function cardData(p){
  const id=p.shown||p.role,idx=ROLES.findIndex(r=>r.id===id),d={r:idx,n:p.name,m:[],d:[],b:[]};
  if(idx>=0&&!p.shown){
    const t=ROLES[idx].t,dems=S.players.filter(q=>teamOf(q)==='dem'),mins=S.players.filter(q=>teamOf(q)==='min');
    if(t==='min'){d.d=dems.map(q=>q.name);d.m=mins.filter(q=>q.id!==p.id).map(q=>q.name)}
    if(t==='dem'){d.m=mins.map(q=>q.name);d.b=S.bluffs.map(b=>ROLES.findIndex(r=>r.id===b))}
  }
  return d;
}
function qrSVG(text){
  try{
    const q=qrcode(0,text.length>420?'L':'M');q.addData(text);q.make();
    const n=q.getModuleCount(),m=4;let d='';
    for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))d+=`M${c+m} ${r+m}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n+2*m} ${n+2*m}" shape-rendering="crispEdges" role="img" aria-label="Código QR de la tarjeta"><rect width="100%" height="100%" fill="#fffaf0"/><path d="${d}" fill="#1a0f24"/></svg>`;
  }catch(e){return ''}
}
const GOAL={
  town:'Eres del bando bueno. Descubre quién es el Demonio y consigue que lo ejecuten.',
  out:'Eres del bando bueno, aunque tu personaje te lo ponga difícil. Ayuda a ejecutar al Demonio.',
  min:'Eres del bando malvado. Protege al Demonio y mentid con estilo. Ganáis si quedan 2 jugadores vivos con el Demonio entre ellos.',
  dem:'Eres el Demonio. Elimina a los aldeanos sin que te descubran. Ganas si quedan 2 jugadores vivos contigo entre ellos.'
};
function wakeText(r){
  if(r.id==='murcielago')return 'Solo te despiertan de noche si has muerto esa noche.';
  if(r.f&&r.o)return 'El Narrador te despertará todas las noches.';
  if(r.f)return 'El Narrador te despertará solo la primera noche.';
  if(r.o)return 'El Narrador te despertará a partir de la segunda noche.';
  return 'Tu habilidad es pasiva o se usa de día. No te despertarán de noche.';
}
function cardFromData(d){
  const r=ROLES[d.r];
  if(!r)return `<div class="card"><h2>Sin rol</h2><p class="ab">El Narrador aún no te ha asignado personaje.</p></div>`;
  let ex='';
  if(r.t==='min'&&(d.d.length||d.m.length))ex=`<div class="ex"><b>El Demonio:</b> ${d.d.length?d.d.map(esc).join(', '):'nadie'}.${d.m.length?`<br><b>Otros Esbirros:</b> ${d.m.map(esc).join(', ')}.`:''}</div>`;
  if(r.t==='dem')ex=`<div class="ex"><b>Tus Esbirros:</b> ${d.m.length?d.m.map(esc).join(', '):'nadie'}.${d.b.length?`<br><b>Faroles (roles que no están en juego):</b> ${d.b.map(i=>ROLES[i]?ROLES[i].i+' '+esc(ROLES[i].n):'').join(' · ')}.`:''}</div>`;
  return `<div class="card" style="--tc:var(--${r.t})"><div class="ct">${TEAMS[r.t].n.toUpperCase()}</div><div class="ci">${r.i}</div><h2>${esc(r.n)}</h2><p class="ab">${esc(r.a)}</p><div class="div"></div><p class="wake">${wakeText(r)}</p>${ex}</div>`;
}
function cardHTML(p){return cardFromData(cardData(p))}
/* Diario: histText de la versión clásica (PV es solo un apoyo para los nombres) */
const PV={G:null,d:null,i:-1,conf:null,view:'pick',mask:null,f:'all',first:false};
const phaseName=k=>(k%2?'Día ':'Noche ')+(k>>1);
function histText(e){
  const G=PV.G,nm=j=>`<b>${esc(G.ps[j]?G.ps[j][0]:'?')}</b>`,rn=j=>ROLES[j]?ROLES[j].i+' <b>'+esc(ROLES[j].n)+'</b>':'?',ls=a=>a&&a.length?a.map(nm).join(', '):'nadie',a=e.slice(3);
  switch(e[1]){
    case 'p':return `☠️ Envenenaste a ${nm(a[0])}.`;
    case 'w':return `🐈‍⬛ Embrujaste a ${nm(a[0])}: si nominaba al día siguiente, moría.`;
    case 'g':return `🧂 Protegiste a ${nm(a[0])} del Demonio.`;
    case 'k':return `🎃 Atacaste a ${nm(a[0])}.`;
    case 'h':return `🐴 Maldijiste a ${nm(a[0])}.`;
    case 'v':return `🔮 Elegiste a ${nm(a[0])} y ${nm(a[1])}: ${a[2]?'<b>SÍ</b>, uno de ellos es el Demonio.':'<b>NO</b>, ninguno es el Demonio.'}`;
    case 'c':return `🧵 Elegiste a ${nm(a[0])} y ${nm(a[1])}: ${a[2]?'son del <b>mismo bando</b>.':'son de <b>bandos distintos</b>.'}`;
    case 'f':return `🏮 ${a[0]} de tus 2 vecinos vivos ${a[0]===1?'es malvado':'son malvados'}.`;
    case 'b':return `🦇 Al morir viste a ${nm(a[0])}: es ${rn(a[1])}.`;
    case 's':return `⚰️ ${nm(a[0])}, el ejecutado, era ${rn(a[1])}.`;
    case 'i':return a.length?`🃏 Uno de estos es ${rn(a[0])}: ${nm(a[1])} o ${nm(a[2])}.`:'🃏 No hay ningún personaje de ese tipo en juego.';
    case 'e':return '🕷️ Viste el grimorio del Narrador.';
    case 'm':{const o=(a[1]||[]).filter(j=>j!==PV.i);return `🩸 El Demonio es ${ls(a[0])}.${o.length?' Los otros Esbirros: '+ls(o)+'.':''}`}
    case 'd':return `🕸️ Tus Esbirros: ${ls(a[0])}.<br>🃏 Faroles (no están en juego): ${(a[1]||[]).map(rn).join(' · ')}.`;
    case 'x':return a[0]&&a[0].length?`🌅 Murieron esta noche: ${ls(a[0])}.`:'🌅 Nadie murió esta noche.';
    case 'X':return `🔥 Fue ejecutado ${nm(a[0])}.`;
  }
  return '';
}
function overlays(){
  let h='';
  if(U.sheet){
    const p=P(U.sheet);
    if(p){
      const opts=(sel,none)=>`<option value="">${none}</option>`+['town','out','min','dem'].map(t=>`<optgroup label="${TEAMS[t].p}">${ROLES.filter(r=>r.t===t).map(r=>`<option value="${r.id}" ${sel===r.id?'selected':''}>${r.i} ${esc(r.n)}</option>`).join('')}</optgroup>`).join('');
      const idx=S.players.indexOf(p);
      h+=`<div class="overlay" role="dialog" aria-modal="true" aria-label="Ficha de ${esc(p.name)}"><div class="bd" data-act="closesheet"></div><div class="sheet" id="sheetbody">
       <div class="hd"><input type="text" id="pname" data-chg="pname" value="${esc(p.name)}" maxlength="24" aria-label="Nombre"><button class="btn" data-act="closesheet" aria-label="Cerrar">✕</button></div>
       <div class="field"><label class="lbl" for="prole">Personaje</label><select id="prole" data-chg="prole">${opts(p.role,'— sin personaje —')}</select></div>
       ${p.role==='borracho'?`<div class="field"><label class="lbl" for="pshown">🍾 Qué Aldeano cree ser el Borracho</label><select id="pshown" data-chg="pshown"><option value="">— elige un Aldeano —</option>${ROLES.filter(r=>r.t==='town').map(r=>`<option value="${r.id}" ${p.shown===r.id?'selected':''}>${r.i} ${esc(r.n)}</option>`).join('')}</select></div>`:''}
       <div class="row"><button class="btn ${p.alive?'':'danger'}" data-act="alive" data-id="${p.id}">${p.alive?'Vivo · marcar muerto':'Muerto · revivir'}</button>${p.alive?'':`<button class="btn" data-act="ghostv" data-id="${p.id}">Voto fantasma: ${p.ghost?'disponible':'gastado'}</button>`}</div>
       <div class="field"><span class="lbl">Recordatorios</span><div class="chips">${CHIPS.map(c=>`<button class="chipb" data-act="chip" data-id="${p.id}" data-c="${esc(c)}" aria-pressed="${p.rem.includes(c)}">${esc(c)}</button>`).join('')}</div></div>
       <div class="field"><label class="lbl" for="pnote">Notas</label><textarea id="pnote" data-chg="pnote" placeholder="Lo que dijo, lo que sospechas…">${esc(p.note)}</textarea></div>
       <div class="row"><button class="btn" data-act="showcard" data-id="${p.id}">Ver su tarjeta</button><button class="btn sm" data-act="seatl" data-id="${p.id}" ${idx===0?'disabled':''}>← Asiento</button><button class="btn sm" data-act="seatr" data-id="${p.id}" ${idx===S.players.length-1?'disabled':''}>Asiento →</button><button class="btn sm danger" data-act="rm2" data-id="${p.id}">Quitar</button></div>
      </div></div>`;
    }
  }
  if(U.card){
    const p=P(U.card);
    if(p){
      h+=`<div class="overlay center" role="dialog" aria-modal="true" aria-label="Tarjeta de ${esc(p.name)}"><div class="bd"></div>`;
      if(U.stage===0)h+=`<div class="cover"><div class="ph flame">🕯️</div><h2>Pasa el móvil a ${esc(p.name)}</h2><p class="sub">Que nadie más mire la pantalla.</p><button class="btn primary block" data-act="reveal">Soy ${esc(p.name)}: ver mi rol</button><button class="btn" data-act="closecard">Cancelar</button></div>`;
      else h+=`<div class="cardwrap">${cardHTML(p)}<button class="btn primary block" style="max-width:360px" data-act="hidecard">Cerrar</button></div>`;
      h+=`</div>`;
    }
  }
  if(U.bqr){
    const url=rolesUrl(),svg=url?qrSVG(url):'';
    h+=`<div class="overlay center" role="dialog" aria-modal="true" aria-label="QR del libro de personajes"><div class="bd" data-act="closebqr"></div><div class="qrbox">
      <div class="lbl">La Noche de las Ánimas</div><h2>Libro de personajes</h2>
      ${svg?`<div class="qrframe">${svg}</div><p class="sub">Escanead este código para ver todos los personajes y un resumen de reglas mientras se prepara la partida. No muestra el rol de nadie.</p>`:`<p class="verdict">No se puede generar el QR. Revisa la dirección de la web en la pestaña Tarjetas.</p>`}
      <p class="sub" style="font-size:14px">Muestra los ${ROLES.length} personajes del guion.</p>
      <div class="row" style="justify-content:center"><button class="btn sm" data-act="copybook" ${url?'':'disabled'}>Copiar enlace</button><button class="btn primary" data-act="closebqr">Cerrar</button></div>
    </div></div>`;
  }
  if(U.gqr){
    const url=urlJug(),svg=qrSVG(url);
    h+=`<div class="overlay center" role="dialog" aria-modal="true" aria-label="QR de la mesa"><div class="bd" data-act="closegqr"></div><div class="qrbox">
      <div class="lbl">${esc(G.nombre)}</div><h2>Únete a la mesa</h2>
      ${svg?`<div class="qrframe">${svg}</div>`:''}<p class="sub">Escanead este código con la cámara del móvil y escribid vuestro nombre. Cuando el Narrador reparta, cada uno verá su carta en secreto.</p>
      <p class="sub" style="font-size:14px;word-break:break-all">${esc(url)}</p>
      <p class="sub" style="font-size:14px">${S.players.length} sentado${S.players.length===1?'':'s'}.</p>
      <div class="row" style="justify-content:center"><button class="btn sm" data-act="copygame">Copiar enlace</button><button class="btn primary" data-act="closegqr">Cerrar</button></div>
    </div></div>`;
  }
  if(U.pick){
    const k=PICKS[U.pick.k],sel=U.pick.sel;
    const list=S.players.filter(p=>(k.any||p.alive)&&(!k.good||!isEvil(p)));
    h+=`<div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(k.t)}"><div class="bd" data-act="ncancel"></div><div class="sheet"><h2>${esc(k.t)}</h2><p class="sub">${k.n>1?'Elige '+k.n+' jugadores.':'Elige un jugador.'}</p>
     <div class="pickl">${list.map(p=>{const on=sel.includes(p.id),r=R[p.role];return `<button class="vote" data-act="nsel" data-id="${p.id}" aria-pressed="${on}"><span class="ck" aria-hidden="true">${on?'✓':''}</span><span style="flex:1">${esc(p.name)}${p.alive?'':' †'}</span><span class="sub">${r&&!S.hide?r.i+' '+esc(r.n):''}${p.rem.length?' · '+p.rem.map(esc).join(', '):''}</span></button>`}).join('')}</div>
     <div class="row"><button class="btn primary" data-act="nok" ${sel.length===k.n?'':'disabled'}>Confirmar</button><button class="btn" data-act="ncancel">Cancelar</button></div></div></div>`;
  }
  if(U.show){
    const v=U.show;let c='';
    const dems=S.players.filter(p=>teamOf(p)==='dem'),mins=S.players.filter(p=>teamOf(p)==='min');
    if(v.k==='role')c=`<div class="showhd">${esc(v.x||'')}</div>${tokenCard(v.r)}`;
    if(v.k==='bluffs')c=`<div class="showhd">ESTOS PERSONAJES NO ESTÁN EN JUEGO</div>${S.bluffs.map(id=>tokenCard(id,true)).join('')}`;
    if(v.k==='demon')c=`<div class="cover"><div class="lbl">ESTE ES EL DEMONIO</div><h2 style="font-size:40px;color:var(--dem)">${names(dems)}</h2>${mins.length>1?`<p class="sub">Esbirros: ${names(mins)}</p>`:''}</div>`;
    if(v.k==='spy')c=`<div class="spyv"><div class="showhd">GRIMORIO DEL NARRADOR · NOCHE ${S.day}</div><div class="ring">${ringSVG()}${grimToks(true)}<div class="core"><div class="moon">🌕</div><div class="ph">Noche ${S.day}</div><div class="st">${aliveN()} vivos</div></div></div>
      <div class="spyl">${S.players.map(p=>{const r=R[p.role],sh=p.shown&&R[p.shown];return `<div class="spyr ${p.alive?'':'dead'}" style="--tc:var(--${r?r.t:'line'})"><b>${esc(p.name)}</b> ${r?r.i+' '+esc(r.n):'—'}${sh?` <span class="sub">(cree ser ${sh.i} ${esc(sh.n)})</span>`:''}${p.alive?'':' <span class="sub">† muerto</span>'}${p.rem.length?`<div class="chips">${p.rem.map(x=>`<span class="rchip" style="--tc:var(--ember)">${esc(x)}</span>`).join('')}</div>`:''}</div>`}).join('')}</div></div>`;
    if(v.k==='minions')c=`<div class="cover"><div class="lbl">ESTOS SON TUS ESBIRROS</div><h2 style="font-size:40px;color:var(--min)">${names(mins)}</h2></div>`;
    h+=`<div class="overlay center" role="dialog" aria-modal="true"><div class="bd" data-act="nclose"></div><div class="cardwrap">${c}<button class="btn primary block" style="max-width:360px" data-act="nclose">Cerrar</button></div></div>`;
  }
  if(U.confirm){
    h+=`<div class="overlay center" role="alertdialog" aria-modal="true"><div class="bd" data-act="no"></div><div class="cover"><h2>${esc(U.confirm.t)}</h2><div class="row"><button class="btn danger" data-act="yes">Confirmar</button><button class="btn" data-act="no">Cancelar</button></div></div></div>`;
  }
  return h;
}

function render(){
  if(!S)return;
  const ae=document.activeElement,fid=ae&&ae.id&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)?ae.id:null,fval=fid?ae.value:null,fsel=fid&&ae.selectionStart!=null?[ae.selectionStart,ae.selectionEnd]:null;
  const old=$('#main'),st=old?old.scrollTop:0,sh=$('#sheetbody'),sst=sh?sh.scrollTop:0;
  const views={setup:vSetup,grim:vGrim,night:vNight,day:vDay,cards:vCards};
  const hv=HTAB[S.tab]?hbox('t-'+S.tab,HTAB[S.tab][0],HTAB[S.tab][1]):'',v=(views[S.tab]||vSetup)();
  $('#app').innerHTML=header()+`<main id="main">${v.startsWith('<div class="wrap">')?v.replace('<div class="wrap">','<div class="wrap">'+hv):`<div class="wrap">${hv}${v}</div>`}</main>`+nav()+overlays();
  const m=$('#main');if(m)m.scrollTop=st;
  const s2=$('#sheetbody');if(s2)s2.scrollTop=sst;
  if(U.focus){const f=document.getElementById(U.focus);if(f)f.focus();U.focus=null}
  else if(fid){const f=document.getElementById(fid);if(f){if(f.tagName!=='SELECT'&&f.value!==fval)f.value=fval;f.focus({preventScroll:true});if(fsel&&f.setSelectionRange)try{f.setSelectionRange(fsel[0],fsel[1])}catch(e){}}}
  marcaRed();
}
/* ============ Acciones ============ */
const A={
  tab:(d)=>{S.tab=d.k;guardarUI();render()},
  hide:()=>{S.hide=!S.hide;guardarUI();render()},
  add:()=>{const i=$('#newname');const v=(i&&i.value||'').trim();if(!v){toast('Escribe un nombre');return}pedir({op:'anadir',nombre:v}).then(r=>{if(r.ok){const j=$('#newname');if(j)j.value=''}else toast(r.error)});U.focus='newname'},
  up:(d)=>moverAsiento(d.id,-1),down:(d)=>moverAsiento(d.id,1),
  seatl:(d)=>moverAsiento(d.id,-1),seatr:(d)=>moverAsiento(d.id,1),
  rm2:(d)=>{const p=P(d.id);if(!p)return;U.confirm={t:'¿Quitar a '+p.name+' de la mesa?'+(p.movil?' Su móvil volverá a la pantalla para unirse.':''),act:()=>{U.sheet=null;pedir({op:'expulsar',id:p.id}).then(r=>{if(!r.ok)toast(r.error)})}};render()},
  preset:()=>{const pr=presetFor(S.players.length);if(!pr)return;U.confirm={t:'¿Sustituir tu selección por la recomendada para '+S.players.length+' jugadores ('+pr.ids.length+' personajes)?',act:()=>{S.pool=pr.ids.slice();enviarSync()}};render()},
  shuf:()=>{pedir({op:'barajar'}).then(r=>{if(!r.ok)toast(r.error)})},
  clear:()=>{U.confirm={t:'¿Vaciar la mesa? Se quita a todos los jugadores y se borra la partida. Tendrán que volver a unirse.',act:()=>{limpiarU();pedir({op:'vaciar'}).then(r=>{if(!r.ok)toast(r.error)})}};render()},
  deal:()=>{if(S.started){U.confirm={t:'Ya hay una partida en curso. ¿Repartir de nuevo al azar y empezar otra?',act:deal};render()}else deal()},
  manual:()=>{const rc=Reglas.recuento(G,S.players.map(p=>p.role));if(rc.sin){toast('Falta personaje para '+rc.sin+' jugador'+(rc.sin>1?'es':''));return}if(!rc.ok){U.confirm={t:rc.espera?'El reparto no cuadra con la tabla para '+S.players.length+' jugadores. ¿Empezar igualmente?':'No hay reparto estándar para '+S.players.length+' jugadores. ¿Empezar igualmente?',act:startManual};render()}else startManual()},
  logout:()=>{fetch('api/salir',{method:'POST',credentials:'same-origin'}).finally(()=>location.reload())},
  reset:()=>{U.confirm={t:'¿Terminar la partida? Se borran los roles y el grimorio. Los jugadores siguen sentados y vuelven a la mesa.',act:resetGame};render()},
  yes:()=>{const c=U.confirm;U.confirm=null;if(c)c.act();render()},
  no:()=>{U.confirm=null;render()},
  sheet:(d)=>{U.sheet=d.id;render()},
  closesheet:()=>{U.sheet=null;render()},
  alive:(d)=>{const p=P(d.id);p.alive=!p.alive;if(p.alive)p.ghost=true;commit()},
  ghostv:(d)=>{const p=P(d.id);p.ghost=!p.ghost;commit()},
  chip:(d)=>{const p=P(d.id),i=p.rem.indexOf(d.c);if(i>=0)p.rem.splice(i,1);else p.rem.push(d.c);commit()},
  phase:()=>phase(),
  done:(d)=>{S.done[d.id]=!S.done[d.id];if(S.done[d.id])autoLog(d.id);commit()},
  showcard:(d)=>{U.card=d.id;U.stage=1;U.sheet=null;U.gqr=false;render()},
  gameqr:()=>{U.gqr=true;U.sheet=null;U.card=null;render()},
  bookqr:()=>{U.bqr=true;render()},
  closebqr:()=>{U.bqr=false;render()},
  copybook:()=>{const u=rolesUrl();try{navigator.clipboard.writeText(u).then(()=>toast('Enlace copiado'),()=>toast('No se pudo copiar el enlace'))}catch(e){toast('No se pudo copiar el enlace')}},
  closegqr:()=>{U.gqr=false;render()},
  copygame:()=>{const u=urlJug();try{navigator.clipboard.writeText(u).then(()=>toast('Enlace copiado'),()=>toast('No se pudo copiar el enlace'))}catch(e){toast('No se pudo copiar el enlace')}},
  copyroles:()=>{const u=rolesUrl();try{navigator.clipboard.writeText(u).then(()=>toast('Enlace copiado'),()=>toast('No se pudo copiar el enlace'))}catch(e){toast('No se pudo copiar el enlace')}},
  reveal:()=>{U.stage=1;render()},
  hidecard:()=>{const p=P(U.card);if(p)p.seen=true;U.card=null;U.stage=0;commit()},
  closecard:()=>{U.card=null;U.stage=0;render()},
  npick:(d)=>{U.pick={k:d.k,sel:[]};render()},
  nsel:(d)=>{const k=PICKS[U.pick.k],sel=U.pick.sel,id=d.id,i=sel.indexOf(id);if(i>=0)sel.splice(i,1);else{if(sel.length>=k.n)sel.shift();sel.push(id)}render()},
  nok:()=>{const pk=U.pick,k=PICKS[pk.k];if(!pk||pk.sel.length!==k.n)return;U.pick=null;U.nres[k.s]=k.run(pk.sel);if(!k.nodone)S.done[k.s]=true;commit()},
  ncancel:()=>{U.pick=null;render()},
  nshow:(d)=>{
    if(d.k==='info'){const inf=U.nfake[d.id]||U.ninfo[d.id];U.show={k:'role',r:inf.r,x:'Uno de estos es este personaje: '+inf.ids.map(i=>P(i).name).join(' o ')};S.done[d.id]=true;autoLog(d.id)}
    else if(d.k==='exec'){const e=P(S.exec.id),lg=logGet('sepulturero');U.show={k:'role',r:lg?lg.a[1].r:e.role,x:'Hoy fue ejecutado este personaje'};S.done.sepulturero=true;autoLog('sepulturero')}
    else{U.show={k:d.k};const st=d.k==='demon'?'minfo':d.k==='spy'?'espia':'dinfo';S.done[st]=true;autoLog(st)}
    commit()},
  nfaro:(d)=>{autoLog('farolero');const e=logGet('farolero');if(e)e.a[0]=+d.v;S.done.farolero=true;commit()},
  nans:(d)=>{const e=logGet(d.s);if(e){e.a[2]=+d.v;commit()}},
  nclose:()=>{U.show=null;render()},
  ninfo:(d)=>{U.ninfo[d.id]=genInfo(d.id);U.nfake[d.id]=null;relog(d.id);commit()},
  nfake:(d)=>{if(!U.ninfo[d.id])U.ninfo[d.id]=genInfo(d.id);U.nfake[d.id]=genFake(d.id);relog(d.id);commit()},
  ntrue:(d)=>{U.nfake[d.id]=null;relog(d.id);commit()},
  help:(d,el)=>{const c=el.nextElementSibling;if(!c)return;c.hidden=!c.hidden;HELP[d.k]=!c.hidden;el.setAttribute('aria-expanded',String(!c.hidden))},
  ndawn:()=>{
    const d=S.players.filter(p=>p.rem.includes('Muere esta noche'));
    d.forEach(p=>{p.alive=false;p.rem.splice(p.rem.indexOf('Muere esta noche'),1)});
    S.players.forEach(p=>{const i=p.rem.indexOf('Protegido');if(i>=0)p.rem.splice(i,1)});
    logSet('dawn','x','all',[d.map(p=>pr(p.id))]);
    U.nres.dawn=d.length?'Han muerto esta noche: <b>'+names(d)+'</b>. Anúncialo.':'Nadie ha muerto esta noche.';S.done.dawn=true;commit()},
  openvote:()=>{if(!U.from||!U.to)return;U.voting={from:U.from,to:U.to};U.votes=[];render()},
  cancelvote:()=>{U.voting=null;U.votes=[];render()},
  vote:(d)=>{const id=d.id,i=U.votes.indexOf(id);if(i>=0)U.votes.splice(i,1);else U.votes.push(id);render()},
  closevote:()=>{
    const v=U.voting,cnt=U.votes.length,t=thr();if(!v)return;
    S.noms.push({from:v.from,to:v.to,n:cnt,t});S.nomd.push(v.to);S.nomr.push(v.from);
    U.votes.forEach(id=>{const p=P(id);if(p&&!p.alive)p.ghost=false});
    let msg=cnt+' voto'+(cnt===1?'':'s')+': no alcanza el umbral ('+t+')';
    if(cnt>=t){
      if(!S.block||cnt>S.block.n){S.block={id:v.to,n:cnt};msg=P(v.to).name+' va a la hoguera con '+cnt+' votos'}
      else if(cnt===S.block.n){S.block=null;msg='Empate: nadie queda en la hoguera'}
      else msg='No supera los '+S.block.n+' votos de la hoguera';
    }
    U.voting=null;U.votes=[];commit();toast(msg);
  },
  exec:()=>{const p=P(S.block.id);p.alive=false;S.exec={day:S.day,id:p.id};S.log.push({n:S.day,d:1,s:'exec',k:'X',to:'all',a:[pr(p.id)]});S.block=null;commit();toast(p.name+' ha sido ejecutado. Revisa si termina la partida')},
  spare:()=>{S.block=null;commit()},
  tstart:()=>{
    try{T.ac=T.ac||new (window.AudioContext||window.webkitAudioContext)();T.ac.resume&&T.ac.resume()}catch(e){}
    if(T.end){T.left=Math.max(0,Math.ceil((T.end-Date.now())/1000));T.end=null}
    else{if(T.left<=0)T.left=T.total;T.done=false;T.end=Date.now()+T.left*1000}
    render();
  },
  treset:()=>{T.end=null;T.left=T.total;T.done=false;render()},
  tset:(d)=>{T.total=T.left=+d.m*60;T.end=null;T.done=false;render()}
};
function setRole(p,v){C._prole(p,v)}
const C={
  nrole:(d,el)=>{const e=logGet(d.s);if(e){e.a[1]={r:el.value};commit()}},

  cfg:(d,el)=>{S.cfg[d.k]=el.type==='checkbox'?el.checked:+el.value;if(d.k==='tmin'&&!T.end){T.total=T.left=S.cfg.tmin*60;T.done=false}commit()},
  baseurl:(d,el)=>{S.baseUrl=el.value.trim();commit()},
  mrole:(d,el)=>{const p=P(d.id);if(p)setRole(p,el.value)},
  pool:(d,el)=>{const i=S.pool.indexOf(d.id);if(el.checked&&i<0)S.pool.push(d.id);if(!el.checked&&i>=0)S.pool.splice(i,1);commit()},
  from:(d,el)=>{U.from=el.value},
  to:(d,el)=>{U.to=el.value},
  pname:(d,el)=>{const p=P(U.sheet);if(!p)return;const v=el.value.trim();if(!v){el.value=p.name;return}pedir({op:'renombrar',id:p.id,nombre:v}).then(r=>{if(!r.ok){toast(r.error);render()}})},
  prole:(d,el)=>{const p=P(U.sheet);if(p)setRole(p,el.value)},
  _prole:(p,v)=>{p.role=v||null;
    if(p.role!=='borracho')p.shown=null;
    else if(!p.shown){const used=new Set(S.players.map(q=>q.role)),free=ROLES.filter(r=>r.t==='town'&&!used.has(r.id)),c=shuffle(free.filter(r=>S.pool.includes(r.id)))[0]||shuffle(free)[0];if(c)p.shown=c.id}
    commit()},
  pshown:(d,el)=>{const p=P(U.sheet);p.shown=el.value||null;commit()},
  pnote:(d,el)=>{const p=P(U.sheet);if(p){p.note=el.value;enviarSync()}}
};
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');
  if(!el||/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))return;
  const f=A[el.dataset.act];if(f)f(el.dataset,el);
});
document.addEventListener('change',e=>{
  const el=e.target.closest('[data-chg]');if(!el)return;
  const f=C[el.dataset.chg];if(f)f(el.dataset,el);
});
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&e.target.id==='newname'){e.preventDefault();A.add()}
  if(e.key==='Escape'){if(!S){}else if(U.confirm){A.no()}else if(U.show){A.nclose()}else if(U.pick){A.ncancel()}else if(U.bqr){A.closebqr()}else if(U.gqr){A.closegqr()}else if(U.sheet){A.closesheet()}else if(U.card){A.closecard()}}
});

/* ============ Temporizador ============ */
function beep(){
  try{
    const a=T.ac;if(!a)return;
    [0,0.35,0.7].forEach(dt=>{const o=a.createOscillator(),g=a.createGain();o.type='triangle';o.frequency.value=392;o.connect(g);g.connect(a.destination);const t0=a.currentTime+dt;g.gain.setValueAtTime(.25,t0);g.gain.exponentialRampToValueAtTime(.001,t0+.3);o.start(t0);o.stop(t0+.32)});
  }catch(e){}
  try{navigator.vibrate&&navigator.vibrate([200,100,200])}catch(e){}
}
setInterval(()=>{
  if(!T.end)return;
  T.left=Math.max(0,Math.ceil((T.end-Date.now())/1000));
  const el=$('#tmr');if(el)el.textContent=fmt(T.left);
  if(T.left<=0){T.end=null;T.done=true;beep();const b=$('#timerbox');if(b)b.classList.add('end');toast('Se acabó el tiempo')}
},250);

/* ============ Conexión con el servidor ============ */
const UIKEY='grimorio-director-ui';
function guardarUI(){try{localStorage.setItem(UIKEY,JSON.stringify({tab:S.tab,hide:S.hide}))}catch(e){}}
function leerUI(){try{return JSON.parse(localStorage.getItem(UIKEY)||'null')||{}}catch(e){return {}}}
let ws=null,rid=0,pendSync=0,red=false,reintento=0,diferido=false,timerRed=null;
const esperas=new Map(),sincs=new Set();
function wsUrl(){const u=new URL('ws/director',location.href);u.protocol=u.protocol==='https:'?'wss:':'ws:';return u.href}
function marcaRed(){
  let b=$('#estado-red');
  if(red||!S){if(b)b.remove();return}
  if(!b){b=document.createElement('div');b.id='estado-red';b.className='estado-red';b.setAttribute('role','status');document.body.appendChild(b)}
  b.textContent='Sin conexión con el servidor · reconectando…';
}
function conectar(){
  clearTimeout(timerRed);
  try{ws=new WebSocket(wsUrl())}catch(e){return reconectar()}
  ws.onopen=()=>{red=true;reintento=0;pendSync=0;sincs.clear();marcaRed()};
  ws.onmessage=e=>{
    let m;try{m=JSON.parse(e.data)}catch(_){return}
    if(m.t==='estado'){
      if(m.rid&&sincs.has(m.rid)){sincs.delete(m.rid);pendSync=Math.max(0,pendSync-1)}
      if(pendSync===0)aplicar(m.S,m.urlJugadores);
    }else if(m.t==='resp'){
      const f=esperas.get(m.rid);
      if(f){esperas.delete(m.rid);f(m)}
      else if(!m.ok&&m.error)toast(m.error);
    }
  };
  ws.onclose=()=>{
    const habia=red;red=false;ws=null;pendSync=0;sincs.clear();
    esperas.forEach(f=>f({ok:false,error:'Sin conexión con el servidor'}));esperas.clear();
    if(habia)marcaRed();
    fetch('api/sesion',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(j.director)reconectar();else{S=null;pantallaLogin('La sesión ha caducado. Vuelve a entrar.')}}).catch(()=>reconectar());
  };
}
function reconectar(){marcaRed();clearTimeout(timerRed);timerRed=setTimeout(conectar,Math.min(10000,800*Math.pow(1.6,reintento++)))}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!ws&&S!==undefined){reintento=0;conectar()}});
function pedir(m){
  return new Promise(res=>{
    if(!ws||ws.readyState!==1)return res({ok:false,error:'Sin conexión con el servidor'});
    const id='o'+(++rid);esperas.set(id,res);ws.send(JSON.stringify(Object.assign({rid:id},m)));
  });
}
function enviarSync(){
  if(!S)return;
  if(!ws||ws.readyState!==1){toast('Sin conexión: el cambio no se ha guardado');return}
  const d={players:{},pool:S.pool,cfg:S.cfg,baseUrl:S.baseUrl||''};
  S.players.forEach(p=>{d.players[p.id]={role:p.role,shown:p.shown,alive:p.alive,ghost:p.ghost,rem:p.rem,note:p.note}});
  if(S.started)['day','night','done','noms','nomd','nomr','block','bluffs','log','exec'].forEach(k=>{d[k]=S[k]});
  const id='s'+(++rid);sincs.add(id);pendSync++;
  ws.send(JSON.stringify({op:'sync',rid:id,d}));
}
function aplicar(nuevo,uj){
  const prev=S,ui=prev?{tab:prev.tab,hide:prev.hide}:leerUI();
  URL_SERV=uj||'';
  if(prev){
    const antes=new Set(prev.players.map(p=>p.id));
    nuevo.players.filter(p=>!antes.has(p.id)&&p.movil).forEach(p=>toast(p.name+' se ha sentado a la mesa'));
    if(prev.started&&!nuevo.started){limpiarU();ui.tab='setup'}
    if(nuevo.started&&prev.gid!==nuevo.gid){limpiarU();if(!prev.started)ui.tab='grim'}
  }
  S=nuevo;S.tab=ui.tab||'setup';S.hide=!!ui.hide;
  S.cfg=Object.assign({notes:true,off:true,tmin:3},S.cfg||{});if(!S.log)S.log=[];
  if(!prev&&!T.end){T.total=T.left=S.cfg.tmin*60}
  if(U.sheet&&!P(U.sheet))U.sheet=null;
  if(U.card&&!P(U.card))U.card=null;
  if(drag){diferido=true;return}
  render();
}

/* ---- Pantalla de entrada (PIN) ---- */
function pantallaLogin(msg){
  $('#estado-red')&&$('#estado-red').remove();
  $('#app').innerHTML=`<div class="pv"><form class="login" id="flogin" autocomplete="on">
   <div class="pvtop"><div class="lbl">${esc(G.nombre)}</div></div>
   <h1 class="pvh">Grimorio del Narrador</h1>
   <p class="sub">Escribe el PIN del director.</p>
   <input type="password" id="pin" name="password" autocomplete="current-password" required aria-label="PIN del director">
   <div class="err" id="perr" role="alert">${esc(msg||'')}</div>
   <button class="btn primary block" type="submit">Entrar</button>
  </form></div>`;
  const f=$('#flogin');
  f.addEventListener('submit',ev=>{
    ev.preventDefault();
    const pin=$('#pin').value;$('#perr').textContent='';
    fetch('api/entrar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin}),credentials:'same-origin'})
      .then(r=>r.json().then(j=>({ok:r.ok,j})))
      .then(({ok,j})=>{if(ok){$('#app').innerHTML='<div class="pv"><div class="empty">Abriendo el grimorio…</div></div>';S=null;conectar()}else{$('#perr').textContent=j.error||'No se pudo entrar';$('#pin').select()}})
      .catch(()=>{$('#perr').textContent='Sin conexión con el servidor'});
  });
  setTimeout(()=>{const p=$('#pin');if(p)p.focus()},50);
}

/* ---- Reordenar asientos arrastrando (táctil y ratón) ---- */
let drag=null;
document.addEventListener('pointerdown',e=>{
  const h=e.target.closest('.asa');if(!h)return;
  const li=h.closest('li');if(!li||!li.dataset.id)return;
  e.preventDefault();
  const r=li.getBoundingClientRect();
  drag={li,ul:li.parentElement,off:e.clientY-r.top,pid:e.pointerId,antes:[...li.parentElement.children].map(x=>x.dataset.id)};
  li.classList.add('arrastrando');
  try{h.setPointerCapture(e.pointerId)}catch(_){}
});
document.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.pid)return;
  e.preventDefault();
  const {li,ul}=drag,y=e.clientY;
  const prev=li.previousElementSibling,next=li.nextElementSibling;
  if(prev&&y<prev.getBoundingClientRect().top+prev.offsetHeight/2)ul.insertBefore(li,prev);
  else if(next&&y>next.getBoundingClientRect().top+next.offsetHeight/2)ul.insertBefore(next,li);
  li.style.transform='';
  const top=li.getBoundingClientRect().top;
  li.style.transform=`translateY(${y-drag.off-top}px)`;
  const m=$('#main');if(m){const mr=m.getBoundingClientRect();if(y<mr.top+50)m.scrollTop-=12;else if(y>mr.bottom-50)m.scrollTop+=12}
  [...ul.children].forEach((x,i)=>{const s=x.querySelector('.seat');if(s)s.textContent=i+1});
},{passive:false});
function soltar(e){
  if(!drag||(e&&e.pointerId!==drag.pid))return;
  const {li,ul,antes}=drag;drag=null;
  li.classList.remove('arrastrando');li.style.transform='';
  const ids=[...ul.children].map(x=>x.dataset.id);
  if(ids.join()!==antes.join()){
    const porId=new Map(S.players.map(p=>[p.id,p]));
    S.players=ids.map(id=>porId.get(id)).filter(Boolean).concat(S.players.filter(p=>!ids.includes(p.id)));
    pedir({op:'orden',ids}).then(r=>{if(!r.ok)toast(r.error)});
  }
  if(diferido){diferido=false}
  render();
}
document.addEventListener('pointerup',soltar);
document.addEventListener('pointercancel',soltar);
function moverAsiento(id,d){
  const a=S.players.map(p=>p.id),i=a.indexOf(id),j=i+d;
  if(i<0||j<0||j>=a.length)return;
  [a[i],a[j]]=[a[j],a[i]];
  const porId=new Map(S.players.map(p=>[p.id,p]));S.players=a.map(x=>porId.get(x));render();
  pedir({op:'orden',ids:a}).then(r=>{if(!r.ok)toast(r.error)});
}

/* ============ Arranque ============ */
try{if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(function(){})}catch(e){}
S=undefined;
fetch('api/sesion',{cache:'no-store',credentials:'same-origin'}).then(r=>r.json()).then(j=>{
  S=null;
  if(j.director){$('#app').innerHTML='<div class="pv"><div class="empty">Abriendo el grimorio…</div></div>';conectar()}
  else pantallaLogin();
}).catch(()=>{S=null;$('#app').innerHTML='<div class="pv"><div class="panel empty"><h2>Sin conexión</h2><p>No se puede contactar con el servidor del grimorio.</p><a class="btn primary" href="">Reintentar</a></div></div>'});
