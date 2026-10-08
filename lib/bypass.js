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

/* La prueba del monitor de cada partida: en qué válvula aparece, qué
   reto es y sus parámetros. Sale de un HMAC con la llave del servidor y el
   id de la partida: para el navegador es azar puro —no depende de la
   semilla, que sí conoce— y se entera hasta llegar a esa válvula
   (GET /api/desafio). Al servidor le sirve para volver a saberla al
   validar sin tener que guardarla. Tiempos en pasos de 1/120 s. */
const TIPOS_PRUEBA = ["franja", "ritmo", "marcas", "verde"];
export function pruebaDe(id){
  const h = createHmac("sha256", llave()).update("prueba:" + id).digest();
  const { desde, hasta } = motor.PRUEBA;
  const S = motor.SUELO;
  const tipo = TIPOS_PRUEBA[h[1] % TIPOS_PRUEBA.length];
  const def = { tipo };
  // La franja y las marcas nunca bajo el recuadro de la instrucción
  // (que ocupa hasta y ≈ 30) ni pegadas al suelo.
  if (tipo === "franja") def.c = 46 + (h[2] % (S - 18 - 46 + 1));      // 46 a 88
  // Ritmo cerca del de flotar (~0.59 s): latiendo solo en los golpes el
  // pulso se queda más o menos a la misma altura. Más lento o más rápido
  // lo estrellaba contra el suelo o el techo en 4 golpes.
  if (tipo === "ritmo")  def.T = 66 + (h[3] % 13);                     // 0.55 a 0.65 s entre golpes
  if (tipo === "marcas"){
    const alto = 38 + (h[4] % 12), bajo = S - 16 - (h[5] % 14);       // 38–49 y 76–90
    [def.y1, def.y2] = h[6] % 2 ? [alto, bajo] : [bajo, alto];         // en qué orden
  }
  if (tipo === "verde"){ def.g1 = 60 + (h[7] % 110); def.g2 = 60 + (h[8] % 110); def.g3 = 60 + (h[9] % 110); }
  return { punto: desde + (h[0] % (hasta - desde + 1)), def };
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
