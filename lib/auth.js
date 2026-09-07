/* Comprobación del ADMIN_TOKEN, compartida por las rutas del panel. */

import { timingSafeEqual } from "node:crypto";

/* Comparar con === filtra información por cuánto tarda en fallar, y con eso
   se puede adivinar el token carácter por carácter. */
function iguales(a, b){
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/* Devuelve null si pasa, o un objeto {code, mensaje} si no. */
export function revisaToken(req){
  const esperado = process.env.ADMIN_TOKEN;
  if (!esperado) return { code: 500, mensaje: "FALTA ADMIN_TOKEN EN EL SERVIDOR." };

  const dado = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!dado || !iguales(dado, esperado)) return { code: 401, mensaje: "TOKEN INCORRECTO." };

  return null;
}
