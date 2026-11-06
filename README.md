# grimorio-medianoche
Grimorio digital con estética Halloween para narrar partidas presenciales de juegos de deducción social. Instalable como app (PWA) en iPad y iPhone.

Hay dos versiones en este repo:

| Versión | Qué es | Dónde está |
|---|---|---|
| **Clásica** (estática) | Una sola página, todo en el dispositivo del Narrador. Funciona sin servidor (GitHub Pages, archivo local). | `index.html`, `sw.js`, `manifest.webmanifest`, `qrcode.js`, `fonts/`, `icons/` (sin cambios) |
| **Dinámica** | Una partida en un servidor. El Narrador usa `/director` (con PIN) y cada jugador ve **solo su carta** en su móvil en `/jugar`. | `server/`, `web/`, `despliegue/` |

La versión dinámica también sirve la clásica en `/clasico/`.

## Versión dinámica

### Cómo funciona
- **Una única partida activa.** Sin salas ni cuentas.
- **`/director`**: tu grimorio completo (Preparar, Grimorio, Noche, Día, Tarjetas), protegido con PIN. La sesión dura 30 días en ese dispositivo.
- **`/jugar`**: el QR de la mesa apunta aquí. Cada jugador escribe su nombre y queda sentado; se guarda un token en `localStorage`, así que si recarga o pierde cobertura vuelve solo a su sitio.
- **Flujo**: MESA (se sientan, ves quién está conectado, puedes renombrar, expulsar y reordenar asientos arrastrando ⠿) → REPARTO (al azar con la tabla de 5 a 15 jugadores y los personajes marcados, o a mano) → PARTIDA (cada uno ve su carta, la fase y quién está vivo) → **Terminar partida** (botón arriba, siempre visible): borra roles y grimorio, los jugadores siguen sentados y vuelven a MESA.
- **Privacidad**: el estado vive en el servidor, que construye la vista de cada jugador con una lista cerrada de campos (su carta, los nombres de la mesa, vivos o muertos y la fase). Nunca se envían roles, recordatorios, notas ni ids de otros jugadores, ni siquiera por WebSocket.
- **Guiones**: de momento «La Noche de las Ánimas». Los datos están en `web/reglas.js` (`GUIONES`), preparados para añadir más.

### Requisitos
- Node.js 20 o superior. Dependencias: solo `fastify` y `ws`.
- Pensado para una Raspberry Pi 3B (1 GB): usa unos 50 MB de RAM.

### Ejecutar en local
```bash
npm ci
GRIMORIO_PIN=1234 npm start          # http://127.0.0.1:8002/
npm test                             # 22 pruebas: reglas, IP real e integración completa
```

### Variables de entorno
| Variable | Por defecto | Para qué |
|---|---|---|
| `GRIMORIO_PIN` | *(obligatoria)* | PIN del director, de 4 a 64 caracteres sin espacios. Sin él el servidor no arranca. |
| `PORT` | `8002` | Puerto |
| `HOST` | `127.0.0.1` | Interfaz. Déjala en local y pon un proxy (Caddy) delante. |
| `DATA_DIR` | `./datos` | Dónde se guarda `estado.json` (escritura atómica). |
| `URL_JUGADORES` | *(vacía)* | Dirección del QR de la mesa. Vacía = la misma desde la que abres `/director`. También se puede cambiar en la pestaña Tarjetas. |
| `IPS_TUNEL` | `127.0.0.1,::1` | Desde dónde llega `cloudflared`. Solo si el salto anterior es una de estas IP se cree `CF-Connecting-IP` para el límite de intentos de PIN. |
| `LOG_LEVEL` | `info` | Nivel de log de Fastify. |

### Rutas (todas relativas)
La app no sabe bajo qué prefijo está: funciona igual en `http://192.168.1.2/grimorio/` que en la raíz de un subdominio con HTTPS, sin tocar código.

| Ruta | |
|---|---|
| `/` | Portada |
| `/jugar` · `/jugar#libro` | Jugadores · libro de personajes |
| `/director` | Narrador |
| `/clasico/` | Versión clásica |
| `/ws/jugar` · `/ws/director` | WebSocket |
| `/api/entrar` · `/api/salir` · `/api/sesion` · `/api/salud` | API |

### Seguridad
- PIN: se compara en tiempo constante. 5 fallos en 10 minutos desde la misma IP la bloquean 10 minutos (respuesta 429).
- IP real: detrás de Caddy se usa la IP que ve Caddy (`X-Forwarded-For`). `CF-Connecting-IP` solo cuenta si la petición llega desde el túnel (`IPS_TUNEL`); si la manda un móvil de la LAN o de Tailscale, se ignora.
- Sesión del director: cookie `HttpOnly`, `SameSite=Strict` (y `Secure` si llega por HTTPS), con `Path` igual a la subruta que indique el proxy en `X-Forwarded-Prefix` (p. ej. `/juegos/grimorio/`; sin cabecera, `/`). Los WebSocket comprueban `Origin`.
- Cabeceras: CSP sin scripts en línea (salvo en `/clasico/`), `X-Frame-Options: DENY`, `nosniff`.
- Solo se sirven los archivos de una lista cerrada: nunca `server/`, `datos/`, `package.json` ni `.git`.

### PWA y service worker
`web/sw.js` guarda en caché fuentes e iconos. Páginas y scripts van siempre a la red primero, para que una actualización llegue a la vez a todo, y usan la caché solo si no hay conexión. `api/`, `ws/` y `/clasico/` (que tiene su propio service worker) nunca pasan por él. iOS solo activa el service worker con HTTPS; por HTTP la app se puede añadir a la pantalla de inicio igual, pero sin caché sin conexión.

### Despliegue en la Raspberry Pi
Está instalado así:

| Pieza | Dónde |
|---|---|
| Código | `/opt/grimorio` (copia de la rama desplegada) |
| Servicio | `grimorio.service` (`despliegue/grimorio.service`), usuario `raspberry` |
| Configuración y PIN | `/etc/grimorio.env` (root, 600). Ejemplo en `despliegue/grimorio.env.ejemplo`. |
| Estado | `/var/lib/grimorio/estado.json` |
| Proxy | Caddy `:80`, `/etc/caddy/sitios/grimorio.caddy` → `127.0.0.1:8002` |
| Acceso | `/grimorio/` abierto a la red local (192.168.1.0/24) y a Tailscale. El resto de webs, solo por Tailscale. |

Dirección para los jugadores en casa: **http://192.168.1.2/grimorio/jugar**

```bash
# Actualizar después de cambiar código (en la Pi, en ~/src/grimorio-medianoche)
git checkout dinamica && ./despliegue/desplegar.sh

# Cambiar el PIN
sudo nano /etc/grimorio.env && sudo systemctl restart grimorio

# Estado y logs
systemctl status grimorio
journalctl -u grimorio -f

# Empezar de cero (borra jugadores, partida y sesiones del director)
sudo systemctl stop grimorio && sudo rm /var/lib/grimorio/estado.json && sudo systemctl start grimorio
```

En internet se publica con Cloudflare Tunnel en **https://enriranjan.dev/juegos/grimorio/** (`URL_JUGADORES=https://enriranjan.dev/juegos/grimorio/jugar`). Caddy quita la subruta y envía `X-Forwarded-Prefix: /juegos/grimorio`. El antiguo `grimorio.enriranjan.dev` redirige (301) a la subruta, conservando la ruta. Para servirlo bajo otra ruta o dominio no hay que tocar código: solo el proxy y `URL_JUGADORES`.

---
Proyecto de aficionados con personajes originales, inspirado en la mecánica de Blood on the Clocktower. No está afiliado a The Pandemonium Institute.
