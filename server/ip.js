'use strict';
/* IP real del cliente, para el límite de intentos de PIN.

   Caminos posibles hasta la app (que escucha solo en 127.0.0.1):
     móvil/PC  -> Caddy (:80)        -> app   X-Forwarded-For = IP del móvil (Caddy la reescribe)
     Cloudflare -> cloudflared (Pi)  -> Caddy -> app   X-Forwarded-For = 127.0.0.1 (cloudflared)
     Cloudflare -> cloudflared (Pi)  -> app   sin X-Forwarded-For, conexión desde 127.0.0.1

   CF-Connecting-IP solo se cree si el salto anterior a nosotros es el túnel
   (una de IPS_TUNEL, por defecto la propia Pi). Si la manda un móvil de la LAN
   o de Tailscale, Caddy la deja pasar pero aquí se ignora. */
const net=require('net');

const norm=ip=>{ip=String(ip||'').trim();if(ip.startsWith('::ffff:')&&net.isIPv4(ip.slice(7)))ip=ip.slice(7);return ip};
const esLoopback=ip=>ip==='::1'||/^127\./.test(ip);

function crearResolutor(ipsTunel){
  const tunel=new Set(String(ipsTunel==null?'127.0.0.1,::1':ipsTunel).split(',').map(norm).filter(Boolean));
  return function ipCliente(req){
    const par=norm(req.socket&&req.socket.remoteAddress);
    /* Conexión directa desde otra máquina (sin proxy): no se cree ninguna cabecera */
    if(!esLoopback(par))return par;
    /* A través de un proxy local: el último salto de X-Forwarded-For es quien conectó al proxy */
    const xff=String(req.headers['x-forwarded-for']||'').split(',').map(norm).filter(Boolean);
    const salto=xff.length?xff[xff.length-1]:par;
    const cf=norm(req.headers['cf-connecting-ip']);
    if(cf&&net.isIP(cf)&&tunel.has(salto))return cf;
    return net.isIP(salto)?salto:par;
  };
}

module.exports={crearResolutor,norm};
