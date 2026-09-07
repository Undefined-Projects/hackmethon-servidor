/* GET /api/registros — la lista completa, para el panel de participantes.
   Protegido con ADMIN_TOKEN: son nombres, teléfonos y correos de estudiantes. */

import { timingSafeEqual } from "node:crypto";
import { prepara, sql, CUPO, folio } from "../lib/db.js";
import { cors } from "../lib/cors.js";

/* Comparación de tiempo constante: comparar con === filtra información por
   cuánto tarda en fallar, y con eso se puede adivinar el token carácter
   por carácter. */
function iguales(a, b){
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export default async function handler(req, res){
  if (cors(req, res)) return;   // respuesta previa del navegador
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET"){
    res.setHeader("Allow", "GET");
    return res.status(405).json({ mensaje: "MÉTODO NO PERMITIDO." });
  }

  const esperado = process.env.ADMIN_TOKEN;
  if (!esperado)
    return res.status(500).json({ mensaje: "FALTA ADMIN_TOKEN EN EL SERVIDOR." });

  const dado = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!dado || !iguales(dado, esperado))
    return res.status(401).json({ mensaje: "TOKEN INCORRECTO." });

  try {
    await prepara();
    const q = sql();
    const filas = await q`
      select id, equipo, correo, lider, integrantes, emblema, creado
      from registros order by id asc`;

    return res.status(200).json({
      cupo: CUPO,
      registrados: filas.length,
      quedan: Math.max(CUPO - filas.length, 0),
      registros: filas.map(f => ({ ...f, folio: folio(f.id) })),
    });
  } catch (e) {
    console.error("registros:", e);
    return res.status(500).json({ mensaje: "NO SE PUDO LEER LA BASE DE DATOS." });
  }
}
