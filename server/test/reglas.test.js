'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Reglas=require('../../web/reglas.js');
const G=Reglas.guion('animas');
const todos=G.roles.map(r=>r.id);
const bando=id=>Reglas.bandoDe(G,id);
const jug=n=>Array.from({length:n},(_,i)=>({id:'j'+i,name:'J'+i}));

test('el guion tiene 24 personajes únicos y bandos válidos',()=>{
  assert.equal(G.roles.length,24);
  assert.equal(new Set(todos).size,24);
  G.roles.forEach(r=>assert.ok(Reglas.BANDOS.includes(r.t),r.id));
  G.presets.forEach(p=>p.ids.forEach(id=>assert.ok(todos.includes(id),id)));
});

test('reparto al azar respeta la tabla de 5 a 15 jugadores (200 repartos por tamaño)',()=>{
  for(let n=5;n<=15;n++){
    for(let k=0;k<200;k++){
      const ps=jug(n),r=Reglas.repartir(G,ps,todos);
      assert.ok(!r.error,r.error);
      const roles=ps.map(p=>r.asig[p.id].role);
      assert.equal(new Set(roles).size,n,'sin personajes repetidos');
      const rc=Reglas.recuento(G,roles);
      assert.ok(rc.ok,`n=${n} ${JSON.stringify(rc)}`);
      const anf=roles.includes('anfitrion'),[T,O,M,D]=Reglas.COMP[n];
      assert.equal(rc.tiene.town,anf?T-2:T);assert.equal(rc.tiene.out,anf?O+2:O);
      assert.equal(rc.tiene.min,M);assert.equal(rc.tiene.dem,D);
      ps.forEach(p=>{
        const a=r.asig[p.id];
        if(a.role==='borracho'){assert.equal(bando(a.shown),'town');assert.ok(!roles.includes(a.shown),'el Borracho cree ser alguien que no está en juego')}
        else assert.equal(a.shown,null);
      });
      const shown=ps.map(p=>r.asig[p.id].shown).filter(Boolean);
      assert.equal(r.faroles.length,3);
      r.faroles.forEach(f=>{assert.ok(['town','out'].includes(bando(f)));assert.ok(!roles.includes(f)&&!shown.includes(f),'farol fuera de juego')});
    }
  }
});

test('reparto al azar solo usa personajes marcados',()=>{
  const pool=G.presets[0].ids;
  for(let k=0;k<200;k++){
    const ps=jug(6),r=Reglas.repartir(G,ps,pool);
    assert.ok(!r.error,r.error);
    ps.forEach(p=>assert.ok(pool.includes(r.asig[p.id].role)));
    r.faroles.forEach(f=>assert.ok(pool.includes(f)));
  }
});

test('reparto al azar: errores claros',()=>{
  assert.match(Reglas.repartir(G,jug(4),todos).error,/entre 5 y 15/);
  assert.match(Reglas.repartir(G,jug(16),todos).error,/entre 5 y 15/);
  assert.match(Reglas.repartir(G,jug(7),todos.filter(id=>bando(id)!=='dem')).error,/Demonio/);
  assert.match(Reglas.repartir(G,jug(7),['calabaza','envenenadora','vidente','farolero']).error,/Aldeanos/);
});

test('completar un reparto a mano: carta del Borracho y faroles',()=>{
  const ps=[{id:'a',role:'borracho'},{id:'b',role:'vidente'},{id:'c',role:'calabaza'},{id:'d',role:'espia'},{id:'e',role:'farolero'}];
  const r=Reglas.completar(G,ps,todos);
  assert.equal(bando(r.asig.a.shown),'town');
  assert.ok(!['vidente','farolero'].includes(r.asig.a.shown));
  assert.equal(r.faroles.length,3);
  r.faroles.forEach(f=>assert.ok(![...ps.map(p=>p.role),r.asig.a.shown].includes(f)));
  /* Si ya tenía carta falsa elegida a mano, se respeta */
  const r2=Reglas.completar(G,[{id:'a',role:'borracho',shown:'sepulturero'}],todos);
  assert.equal(r2.asig.a.shown,'sepulturero');
});

test('la carta de cada bando solo lleva lo que le toca',()=>{
  const ps=[{id:'a',name:'Ana',role:'calabaza'},{id:'b',name:'Biel',role:'espia'},{id:'c',name:'Carmen',role:'bruja'},{id:'d',name:'Dani',role:'vidente'},{id:'e',name:'Elena',role:'borracho',shown:'farolero'}];
  const f=['cronista','santo','detective'];
  assert.deepEqual(Reglas.carta(G,ps[0],ps,f),{rol:'calabaza',demonio:[],esbirros:['Biel','Carmen'],faroles:f});
  assert.deepEqual(Reglas.carta(G,ps[1],ps,f),{rol:'espia',demonio:['Ana'],esbirros:['Carmen'],faroles:[]});
  assert.deepEqual(Reglas.carta(G,ps[3],ps,f),{rol:'vidente',demonio:[],esbirros:[],faroles:[]});
  assert.deepEqual(Reglas.carta(G,ps[4],ps,f),{rol:'farolero',demonio:[],esbirros:[],faroles:[]},'el Borracho ve su carta falsa');
});
