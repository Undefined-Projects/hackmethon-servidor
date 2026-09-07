/* GET /api/cupo — cuántos lugares quedan. Público a propósito: lo consume
   la portada para mostrar "QUEDAN N". No devuelve ningún dato personal. */

import { prepara, sql, CUPO } from "../lib/db.js";
import { cors } from "../lib/cors.js";

export default async function handler(req, res){
  if (cors(req, res)) return;   // respuesta previa del navegador
  res.setHeader("Cache-Control", "public, max-age=30");

  if (req.method !== "GET"){
    res.setHeader("Allow", "GET");
    return res.status(405).json({ mensaje: "MÉTODO NO PERMITIDO." });
  }

  try {
    await prepara();
    const q = sql();
    const [{ total }] = await q`select count(*)::int as total from registros`;
    return res.status(200).json({ cupo: CUPO, registrados: total, quedan: Math.max(CUPO - total, 0) });
  } catch (e) {
    console.error("cupo:", e);
    // La portada funciona igual sin este dato, así que no se grita.
    return res.status(200).json({ cupo: CUPO, registrados: null, quedan: null });
  }
}
