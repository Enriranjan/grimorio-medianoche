'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {crearResolutor}=require('../ip.js');
const ip=crearResolutor();
const req=(remote,h={})=>({socket:{remoteAddress:remote},headers:h});

test('conexión directa: se ignoran las cabeceras',()=>{
  assert.equal(ip(req('192.168.1.50',{'x-forwarded-for':'1.2.3.4','cf-connecting-ip':'5.6.7.8'})),'192.168.1.50');
  assert.equal(ip(req('::ffff:192.168.1.50')),'192.168.1.50');
});
test('a través de Caddy: IP del móvil (último salto de X-Forwarded-For)',()=>{
  assert.equal(ip(req('127.0.0.1',{'x-forwarded-for':'192.168.1.50'})),'192.168.1.50');
  assert.equal(ip(req('::1',{'x-forwarded-for':'9.9.9.9, 100.101.102.103'})),'100.101.102.103');
});
test('CF-Connecting-IP falsa desde la LAN o Tailscale: se ignora',()=>{
  assert.equal(ip(req('127.0.0.1',{'x-forwarded-for':'192.168.1.50','cf-connecting-ip':'8.8.8.8'})),'192.168.1.50');
  assert.equal(ip(req('127.0.0.1',{'x-forwarded-for':'100.64.0.7','cf-connecting-ip':'8.8.8.8'})),'100.64.0.7');
});
test('túnel de Cloudflare: se usa CF-Connecting-IP',()=>{
  /* cloudflared -> Caddy -> app */
  assert.equal(ip(req('127.0.0.1',{'x-forwarded-for':'127.0.0.1','cf-connecting-ip':'203.0.113.9'})),'203.0.113.9');
  /* cloudflared -> app directamente */
  assert.equal(ip(req('127.0.0.1',{'cf-connecting-ip':'2001:db8::1'})),'2001:db8::1');
  /* cabecera basura */
  assert.equal(ip(req('127.0.0.1',{'x-forwarded-for':'127.0.0.1','cf-connecting-ip':'no-es-ip'})),'127.0.0.1');
});
test('IPS_TUNEL configurable (cloudflared en otra máquina)',()=>{
  const ip2=crearResolutor('192.168.1.9');
  assert.equal(ip2(req('127.0.0.1',{'x-forwarded-for':'192.168.1.9','cf-connecting-ip':'203.0.113.9'})),'203.0.113.9');
  assert.equal(ip2(req('127.0.0.1',{'x-forwarded-for':'127.0.0.1','cf-connecting-ip':'203.0.113.9'})),'127.0.0.1');
});
