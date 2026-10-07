/* BYPASS — firma de partidas y reglas del torneo.

   Cada partida oficial empieza con una semilla que da el servidor,
   firmada con HMAC para que nadie pueda inventarse una. Al registrar,
   el servidor revisa la firma, que la partida no se haya usado antes,
   que no se haya jugado más rápido que el tiempo real, y la vuelve a
   jugar con el mismo motor que el navegador para contar los puntos. */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";

// El motor es el mismo archivo que usa la portada (sitio/bypass-motor.js),
// copiado aquí como .cjs por build.py.
const require = createRequire(import.meta.url);
export const motor = require("./bypass-motor.cjs");

/* La llave para firmar. Si no hay una propia, se deriva del ADMIN_TOKEN
   para que el juego funcione sin configurar nada más. */
function llave(){
  const propia = process.env.BYPASS_SECRETO;
  if (propia) return propia;
  const admin = process.env.ADMIN_TOKEN;
  if (admin) return "bypass:" + admin;
  throw new Error("Falta BYPASS_SECRETO (o ADMIN_TOKEN) para firmar partidas");
}

const b64 = buf => Buffer.from(buf).toString("base64url");
const firma = datos => createHmac("sha256", llave()).update(datos).digest("base64url");

export function nuevaPartida(){
  const datos = {
    id: randomBytes(12).toString("hex"),
    s:  randomBytes(4).readUInt32BE(0),
    t:  Date.now(),
    v:  motor.VERSION,
  };
  const cuerpo = b64(JSON.stringify(datos));
  return { token: cuerpo + "." + firma(cuerpo), semilla: datos.s };
}

/* Devuelve los datos de la partida o null si la firma no cuadra. */
export function leePartida(token){
  const [cuerpo, sello] = String(token || "").split(".");
  if (!cuerpo || !sello) return null;
  const esperado = Buffer.from(firma(cuerpo));
  const dado = Buffer.from(sello);
  if (esperado.length !== dado.length || !timingSafeEqual(esperado, dado)) return null;
  try { return JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")); }
  catch { return null; }
}

/* El torneo cierra en TORNEO_CIERRE (fecha ISO, con zona horaria). Sin
   la variable, queda abierto. */
export function cierre(){
  const v = String(process.env.TORNEO_CIERRE || "").trim().replace(/^["']|["']$/g, "");
  const f = v ? new Date(v) : null;
  return f && !Number.isNaN(f.getTime()) ? f : null;
}
export const abierto = () => { const c = cierre(); return !c || Date.now() < c.getTime(); };

/* La tabla pública va de 5 en 5, y los 8 primeros al cierre pasan a la
   dinámica del día del evento. */
export const POR_PAGINA  = 5;
export const FINALISTAS  = 8;

export const VIGENCIA_MS = 6 * 3600e3;        // una semilla vale 6 horas
export const TOPE_PASOS  = 120 * 60 * 30;     // 30 minutos de partida, de sobra
