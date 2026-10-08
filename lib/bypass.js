/* BYPASS — firma de partidas y reglas del torneo.

   Cada partida oficial empieza con una semilla que da el servidor,
   firmada con HMAC para que nadie pueda inventarse una. Al registrar,
   el servidor revisa la firma, que la partida no se haya usado antes,
   que no se haya jugado más rápido que el tiempo real, y la vuelve a
   jugar con el mismo motor que el navegador para contar los puntos. */

import { createHmac, randomBytes, timingSafeEqual, scryptSync } from "node:crypto";
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

/* Las pruebas del monitor de cada partida: en qué válvulas aparecen y qué
   retos trae cada una. Salen de HMACs con la llave del servidor y el id
   de la partida: para el navegador son azar puro —no dependen de la
   semilla, que sí conoce— y se entera de cada una hasta llegar a su
   válvula (GET /api/desafio). Al servidor le sirve para volver a saberlas
   al validar sin guardarlas.

   - La primera cae entre la válvula 6 y la 12; cada siguiente, de 8 a 15
     válvulas después. Nunca en una múltiplo de 10 (furia o volteo).
   - La primera trae 2 retos; las demás, 2 o 3. Nunca el mismo dos veces
     en una prueba.
   Tiempos en pasos de 1/120 s. */
const TIPOS_PRUEBA = ["franja", "ritmo", "marcas", "verde"];
const TOPE_PUNTO = 400;
const bytes = (...partes) => createHmac("sha256", llave()).update(partes.join(":")).digest();

function reto(tipo, h){
  const S = motor.SUELO;
  if (tipo === "franja"){
    // La franja (±16) con su vaivén nunca bajo el recuadro de la
    // instrucción (y ≈ 30) ni pegada al suelo.
    const amp = 6 + (h[0] % 9);                                  // 6 a 14
    const lo = 50 + amp, hi = S - 22 - amp;
    return { tipo, c: lo + (h[1] % (hi - lo + 1)), amp,
             per: 420 + (h[2] % 301),                            // una vuelta cada 3.5 a 6 s
             sen: h[3] % 2 ? 1 : -1 };
  }
  if (tipo === "ritmo"){
    // Cerca del ritmo de flotar (~0.59 s), y a la mitad cambia: el segundo
    // compás difiere del primero en al menos 0.07 s.
    // Más rápido que 0.53 s el pulso sube solo hasta el techo; más lento
    // que 0.67 s cae al suelo antes del tercer golpe.
    const T1 = 64 + (h[0] % 17);                                 // 0.53 a 0.67 s
    let T2 = 64 + (h[1] % 17);
    if (Math.abs(T2 - T1) < 8) T2 = T1 < 72 ? Math.min(80, T1 + 8 + (h[2] % 3)) : Math.max(64, T1 - 8 - (h[2] % 3));
    return { tipo, T1, T2 };
  }
  if (tipo === "marcas"){
    // cuatro alturas alternando arriba y abajo; empieza por cualquiera
    const alto = k => 38 + (h[k] % 14), bajo = k => S - 16 - (h[k] % 16);   // 38–51 · 75–90
    const ys = h[0] % 2 ? [alto(1), bajo(2), alto(3), bajo(4)] : [bajo(1), alto(2), bajo(3), alto(4)];
    return { tipo, ys };
  }
  // verde: 5 verdes y 2 rojos revueltos; ni el primero ni dos rojos seguidos
  const s = [1, 1, 1, 1, 1];
  const r1 = 1 + (h[0] % 5);
  let r2 = 1 + (h[1] % 5); if (r2 === r1) r2 = r1 === 5 ? 1 : r1 + 1;
  for (const r of [r1, r2].sort((a, b) => b - a)) s.splice(r, 0, 0);
  for (let k = 1; k < s.length; k++) if (!s[k] && !s[k - 1]){ s.splice(k, 1); s.push(0); }
  return { tipo, s: s.map((color, k) => [color, 36 + (h[2 + k] % 85)]) };   // 0.3 a 1 s antes de cada señal
}

export function pruebasDe(id){
  const lista = [];
  let punto = 0;
  for (let k = 0; ; k++){
    const h = bytes("prueba", id, k);
    punto = k === 0 ? motor.PRUEBA.desde + (h[0] % 7) : punto + 8 + (h[0] % 8);
    if (punto % 10 === 0) punto++;
    if (punto > TOPE_PUNTO) break;
    const n = k === 0 ? 2 : 2 + (h[1] % 2);
    const tipos = TIPOS_PRUEBA.slice();
    for (let i = tipos.length - 1; i > 0; i--){ const j = h[2 + i] % (i + 1); [tipos[i], tipos[j]] = [tipos[j], tipos[i]]; }
    const retos = tipos.slice(0, n).map((t, j) => reto(t, bytes("reto", id, k, j)));
    lista.push({ punto, def: { retos } });
  }
  return lista;
}

/* La contraseña de cada jugador (estilo when2meet): la elige la primera vez
   que registra con su correo y después la necesita para volver a registrar
   con ese correo. Se guarda como "sal:hash" con scrypt, nunca en texto. */
export function cifraClave(clave){
  const sal = randomBytes(16).toString("base64url");
  return sal + ":" + scryptSync(String(clave), sal, 32).toString("base64url");
}
export function claveCorrecta(clave, guardada){
  const [sal, hash] = String(guardada || "").split(":");
  if (!sal || !hash) return false;
  const a = scryptSync(String(clave), sal, 32), b = Buffer.from(hash, "base64url");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* Alias que nadie puede usar: los de la organización. Se compara por
   contenido, así "ADMIN 2" o "XSTARTUPX" tampoco pasan. */
const RESERVADOS = ["ADMIN", "STARTUP", "UNDEFINED", "HACKMETHON", "ORGANIZA", "STAFF", "MODERADOR"];
export const aliasReservado = alias => {
  const plano = alias.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");
  return RESERVADOS.some(r => plano.includes(r));
};

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
