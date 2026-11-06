/* Reglas y guiones compartidos entre el servidor (Node) y los navegadores.
   Solo datos y funciones puras: nada de DOM ni de red. */
(function(raiz){
'use strict';

/* Reparto estándar por número de jugadores: [Aldeanos, Marginados, Esbirros, Demonios] */
const COMP={5:[3,0,1,1],6:[3,1,1,1],7:[5,0,1,1],8:[5,1,1,1],9:[5,2,1,1],10:[7,0,2,1],11:[7,1,2,1],12:[7,2,2,1],13:[9,0,3,1],14:[9,1,3,1],15:[9,2,3,1]};
const BANDOS=['town','out','min','dem'];

/* ============ Guion: La Noche de las Ánimas ============
   f = orden la primera noche, o = orden en las demás noches (0 = no despierta). */
const ANIMAS={
 id:'animas',
 nombre:'La Noche de las Ánimas',
 equipos:{
  town:{n:'Aldeano',p:'Aldeanos'},
  out:{n:'Marginado',p:'Marginados'},
  min:{n:'Esbirro',p:'Esbirros'},
  dem:{n:'Demonio',p:'Demonios'}
 },
 roles:[
 {id:'vidente',t:'town',i:'🔮',n:'La Vidente de Cenizas',a:'Cada noche eliges a 2 jugadores y aprendes si alguno de ellos es el Demonio. Hay un jugador bueno que siempre te aparece como Demonio.',f:90,o:70,r:'Despierta a la Vidente: elige a 2 jugadores. Asiente si alguno es el Demonio o la falsa pista; si no, niega. Envenenada o borracha: responde lo que quieras.'},
 {id:'sepulturero',t:'town',i:'⚰️',n:'El Sepulturero',a:'Cada noche, menos la primera, aprendes qué personaje fue ejecutado ese día.',f:0,o:80,r:'Si hubo ejecución hoy, enséñale la ficha del ejecutado. Si no la hubo, no lo despiertes.'},
 {id:'farolero',t:'town',i:'🏮',n:'El Farolero',a:'Cada noche aprendes cuántos de tus 2 vecinos vivos son malvados.',f:80,o:60,r:'Indica 0, 1 o 2 con los dedos según sus vecinos vivos más cercanos.'},
 {id:'bibliotecaria',t:'town',i:'📚',n:'La Bibliotecaria Embrujada',a:'La primera noche aprendes que 1 de 2 jugadores es un Marginado concreto, o que no hay ninguno.',f:60,o:0,r:'Enséñale una ficha de Marginado y señala a 2 jugadores, uno de los cuales la tiene. Si no hay Marginados, haz el gesto de cero.'},
 {id:'cronista',t:'town',i:'📜',n:'El Cronista',a:'La primera noche aprendes que 1 de 2 jugadores es un Aldeano concreto.',f:50,o:0,r:'Enséñale una ficha de Aldeano y señala a 2 jugadores, uno de los cuales la tiene.'},
 {id:'detective',t:'town',i:'🔍',n:'El Detective de Sombras',a:'La primera noche aprendes que 1 de 2 jugadores es un Esbirro concreto.',f:70,o:0,r:'Enséñale una ficha de Esbirro y señala a 2 jugadores, uno de los cuales la tiene.'},
 {id:'guardiana',t:'town',i:'🧂',n:'La Guardiana de Sal',a:'Cada noche, menos la primera, eliges a un jugador: el Demonio no puede matarlo esa noche.',f:0,o:30,r:'Despierta a la Guardiana, que señala a un jugador. Pon la marca Protegido.'},
 {id:'cazador',t:'town',i:'🗡️',n:'El Cazador de Brujas',a:'Una sola vez, de día, eliges a un jugador: si es el Demonio, muere.',f:0,o:0,r:''},
 {id:'virgen',t:'town',i:'🕯️',n:'La Virgen del Cementerio',a:'La primera vez que te nominan, si quien te nomina es un Aldeano, es ejecutado en el acto.',f:0,o:0,r:''},
 {id:'soldado',t:'town',i:'🛡️',n:'El Soldado de Paja',a:'El Demonio no puede matarte.',f:0,o:0,r:''},
 {id:'alcaldesa',t:'town',i:'🏛️',n:'La Alcaldesa Fantasma',a:'Si quedan 3 jugadores vivos y nadie es ejecutado ese día, tu equipo gana. Si el Demonio te ataca de noche, el Narrador puede hacer que muera otro jugador.',f:0,o:0,r:''},
 {id:'murcielago',t:'town',i:'🦇',n:'El Murciélago Vidente',a:'Si mueres de noche, despiertas y eliges a un jugador: aprendes su personaje.',f:0,o:50,r:'Solo si ha muerto esta noche: despiértalo, que elija a un jugador y enséñale su ficha.'},
 {id:'costurera',t:'town',i:'🧵',n:'La Costurera de Almas',a:'Una sola vez, de noche, eliges a 2 jugadores: aprendes si son del mismo bando.',f:95,o:85,r:'Si aún no usó su habilidad: que elija a 2 jugadores y asiente si están en el mismo bando. Después marca Habilidad usada.'},
 {id:'borracho',t:'out',i:'🍾',n:'El Borracho de Sidra',a:'No sabes que lo eres: crees ser un Aldeano, pero tu habilidad no funciona y la información que recibes es falsa.',f:0,o:0,r:'',borracho:true},
 {id:'eremita',t:'out',i:'🏚️',n:'El Eremita',a:'Las habilidades de otros pueden mostrarte como malvado, Esbirro o Demonio aunque seas bueno.',f:0,o:0,r:''},
 {id:'santo',t:'out',i:'🕊️',n:'El Santo de Trapo',a:'Si eres ejecutado, tu equipo pierde.',f:0,o:0,r:''},
 {id:'torpe',t:'out',i:'🤡',n:'El Disfrazado Torpe',a:'Cuando mueres, eliges en el acto a un jugador vivo: si es malvado, tu equipo pierde.',f:0,o:0,r:''},
 {id:'envenenadora',t:'min',i:'☠️',n:'La Envenenadora de Brebajes',a:'Cada noche eliges a un jugador: queda envenenado hasta el amanecer (su habilidad falla y su información puede ser falsa).',f:10,o:10,r:'Despierta a la Envenenadora: señala a un jugador. Pon la marca Envenenado (quita la anterior).'},
 {id:'bruja',t:'min',i:'🐈‍⬛',n:'La Bruja de los Gatos',a:'Cada noche eliges a un jugador: si nomina mañana, muere en el acto.',f:15,o:20,r:'Despierta a la Bruja: señala a un jugador. Pon la marca Embrujado (quita la anterior). Si mañana nomina, muere.'},
 {id:'espia',t:'min',i:'🕷️',n:'El Espía Tejedor',a:'Cada noche ves el grimorio. Puedes aparecer como bueno, Aldeano o Marginado.',f:20,o:90,r:'Enséñale el grimorio unos segundos.'},
 {id:'dama',t:'min',i:'👻',n:'La Dama del Velo',a:'Si hay 5 o más jugadores vivos y el Demonio muere, te conviertes en el Demonio.',f:0,o:0,r:''},
 {id:'anfitrion',t:'min',i:'🎩',n:'El Anfitrión Siniestro',a:'Preparación: hay 2 Marginados más y 2 Aldeanos menos de lo habitual.',f:0,o:0,r:'',mod:true},
 {id:'calabaza',t:'dem',i:'🎃',n:'La Calabaza Hueca',a:'Cada noche, menos la primera, eliges a un jugador: muere. Si te eliges a ti misma, mueres y un Esbirro se convierte en la Calabaza Hueca.',f:0,o:40,r:'Despierta a la Calabaza: señala a un jugador. Ese jugador muere al amanecer salvo que esté protegido o sea el Soldado de Paja.'},
 {id:'jinete',t:'dem',i:'🐴',n:'El Jinete sin Cabeza',a:'Cada noche eliges a un jugador y queda maldito. El jugador maldito la noche anterior muere en ese momento.',f:42,o:40,r:'Despierta al Jinete: señala a un jugador y pon la marca Maldito. El maldito anterior muere ahora (protegido o Soldado de Paja no mueren).'}
 ],
 presets:[
  {max:6,n:'Mesa pequeña (5–6)',d:'Personajes sencillos y con información clara. Sin Anfitrión: con tan pocos jugadores dejaría casi sin Aldeanos.',
   ids:['vidente','farolero','cronista','detective','bibliotecaria','guardiana','soldado','borracho','santo','envenenadora','espia','calabaza']},
  {max:9,n:'Mesa media (7–9)',d:'Entra el Sepulturero y la Virgen para dar juego de día, más Marginados y un segundo Demonio para variar.',
   ids:['vidente','farolero','cronista','detective','bibliotecaria','guardiana','sepulturero','soldado','virgen','borracho','santo','eremita','envenenadora','bruja','espia','calabaza','jinete']},
  {max:12,n:'Mesa grande (10–12)',d:'Casi todo el script. Entra el Anfitrión, que cambia el reparto, y la Dama del Velo, que alarga la partida.',
   ids:['vidente','farolero','cronista','detective','bibliotecaria','guardiana','sepulturero','soldado','virgen','cazador','alcaldesa','costurera','borracho','santo','eremita','torpe','envenenadora','bruja','espia','dama','anfitrion','calabaza','jinete']},
  {max:99,n:'Mesa muy grande (13–15)',d:'Todos los personajes del script.',ids:null}
 ],
 reglas:['El pueblo (los buenos) gana si ejecuta al Demonio. Los malvados ganan si quedan 2 jugadores vivos y el Demonio es uno de ellos.',
  'De noche el Narrador despierta a algunos personajes. De día se habla, se nomina y se vota.',
  'Cada jugador vivo puede nominar una vez por día y solo puede ser nominado una vez por día.',
  'Para ir a la hoguera hacen falta votos de al menos la mitad de los jugadores vivos, redondeando hacia arriba. Se ejecuta como máximo a uno por día: el más votado. Si hay empate, no se ejecuta a nadie.',
  'Los muertos siguen hablando y pueden votar una sola vez en toda la partida (voto fantasma), pero ya no nominan.',
  'Mentir está permitido. Tu carta es secreta: enseñarla o no es decisión tuya.'],
 objetivos:{
  town:'Eres del bando bueno. Descubre quién es el Demonio y consigue que lo ejecuten.',
  out:'Eres del bando bueno, aunque tu personaje te lo ponga difícil. Ayuda a ejecutar al Demonio.',
  min:'Eres del bando malvado. Protege al Demonio y mentid con estilo. Ganáis si quedan 2 jugadores vivos con el Demonio entre ellos.',
  dem:'Eres el Demonio. Elimina a los aldeanos sin que te descubran. Ganas si quedan 2 jugadores vivos contigo entre ellos.'
 }
};
ANIMAS.presets.forEach(p=>{if(!p.ids)p.ids=ANIMAS.roles.map(r=>r.id)});

const GUIONES={animas:ANIMAS};
const GUION_POR_DEFECTO='animas';
const guion=id=>GUIONES[id]||GUIONES[GUION_POR_DEFECTO];
const rolDe=(g,id)=>g.roles.find(r=>r.id===id)||null;
const bandoDe=(g,id)=>{const r=rolDe(g,id);return r?r.t:null};

function barajar(a,azar){azar=azar||Math.random;a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(azar()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

/* Reparto al azar respetando la tabla y los personajes marcados (pool).
   jugadores: [{id}] en orden de asiento. Devuelve {asig:{id:{role,shown}}, faroles, aviso} o {error}. */
function repartir(g,jugadores,pool,azar){
  const n=jugadores.length,c=COMP[n];
  if(!c)return {error:'Hacen falta entre 5 y 15 jugadores (hay '+n+')'};
  let [Tn,O,M,D]=c;
  const bote=t=>barajar(g.roles.filter(r=>r.t===t&&pool.includes(r.id)),azar);
  const dem=bote('dem'),min=bote('min');
  if(dem.length<D)return {error:'Marca al menos un Demonio'};
  if(min.length<M)return {error:'Marca al menos '+M+' Esbirro'+(M>1?'s':'')};
  const out=bote('out'),town=bote('town');
  let minSel=min.slice(0,M);
  if(minSel.some(r=>r.mod)&&(out.length<O+2||Tn<3)){const alt=min.filter(r=>!r.mod);if(alt.length>=M)minSel=alt.slice(0,M)}
  if(minSel.some(r=>r.mod)){O+=2;Tn-=2}
  if(out.length<O)return {error:'Faltan Marginados marcados: necesitas '+O};
  if(town.length<Tn)return {error:'Faltan Aldeanos marcados: necesitas '+Tn};
  /* El Borracho necesita un Aldeano marcado que no esté en juego para su carta falsa */
  let outSel=out.slice(0,O);
  if(outSel.some(r=>r.borracho)&&town.length<=Tn){
    const alt=out.filter(r=>!r.borracho);
    if(alt.length>=O)outSel=alt.slice(0,O);
    else return {error:'El Borracho necesita un Aldeano marcado más, que no esté en juego, para su carta. Marca otro Aldeano o desmarca el Borracho'};
  }
  const elegidos=barajar([...dem.slice(0,D),...minSel,...outSel,...town.slice(0,Tn)],azar);
  const asig={};
  jugadores.forEach((j,i)=>{asig[j.id]={role:elegidos[i].id,shown:null}});
  return completar(g,jugadores.map(j=>({id:j.id,role:asig[j.id].role,shown:null})),pool,azar);
}

/* A partir de un reparto (a mano o al azar): carta falsa del Borracho si falta y 3 faroles para el Demonio. */
function completar(g,jugadores,pool,azar){
  const usados=new Set(jugadores.map(j=>j.role).filter(Boolean));
  jugadores.forEach(j=>{if(j.shown)usados.add(j.shown)});
  const asig={};
  const libres=barajar(g.roles.filter(r=>r.t==='town'&&!usados.has(r.id)&&pool.includes(r.id)),azar);
  const libresTodos=barajar(g.roles.filter(r=>r.t==='town'&&!usados.has(r.id)),azar);
  jugadores.forEach(j=>{
    let shown=null;
    const r=rolDe(g,j.role);
    if(r&&r.borracho){
      shown=j.shown&&bandoDe(g,j.shown)==='town'?j.shown:null;
      if(!shown){const c=libres.find(x=>!usados.has(x.id))||libresTodos.find(x=>!usados.has(x.id));if(c){shown=c.id;usados.add(c.id)}}
    }
    asig[j.id]={role:r?r.id:null,shown};
  });
  /* Faroles solo entre los personajes marcados: uno de fuera saldría como «no entra» en el libro */
  const faroles=barajar(g.roles.filter(r=>(r.t==='town'||r.t==='out')&&!usados.has(r.id)&&pool.includes(r.id)),azar).slice(0,3).map(r=>r.id);
  const aviso=faroles.length<3?'Solo hay '+faroles.length+' farol'+(faroles.length===1?'':'es')+' para el Demonio: marca más personajes buenos la próxima vez':'';
  return {asig,faroles,aviso};
}

/* Cuántos hay de cada bando en un reparto, comparado con la tabla (con el Anfitrión si está). */
function recuento(g,roles){
  const n=roles.length,c=COMP[n],tiene={town:0,out:0,min:0,dem:0};let sin=0;
  roles.forEach(id=>{const t=bandoDe(g,id);if(t)tiene[t]++;else sin++});
  if(!c)return {tiene,sin,espera:null,ok:false};
  let [Tn,O,M,D]=c;
  if(roles.some(id=>{const r=rolDe(g,id);return r&&r.mod})){O+=2;Tn-=2}
  const espera={town:Tn,out:O,min:M,dem:D};
  return {tiene,sin,espera,ok:!sin&&BANDOS.every(t=>tiene[t]===espera[t])};
}

/* Datos de la carta de un jugador (lo único que verá de los demás).
   El Borracho ve la carta del Aldeano que cree ser y nada más. */
function carta(g,j,todos,faroles){
  const id=j.shown||j.role,r=rolDe(g,id);
  const d={rol:r?r.id:null,demonio:[],esbirros:[],faroles:[]};
  if(r&&!j.shown){
    const de=t=>todos.filter(q=>q.id!==j.id&&bandoDe(g,q.role)===t).map(q=>q.name);
    if(r.t==='min'){d.demonio=de('dem');d.esbirros=de('min')}
    if(r.t==='dem'){d.esbirros=de('min');d.faroles=(faroles||[]).filter(f=>rolDe(g,f))}
  }
  return d;
}

const API={COMP,BANDOS,GUIONES,GUION_POR_DEFECTO,guion,rolDe,bandoDe,barajar,repartir,completar,recuento,carta};
if(typeof module==='object'&&module.exports)module.exports=API;else raiz.Reglas=API;
})(typeof self!=='undefined'?self:this);
