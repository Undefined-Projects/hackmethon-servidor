/* GET /api/cupo — cuántos lugares quedan y si la portada está en modo
   "próximamente". Público a propósito: lo consume la portada al cargar.
   No devuelve ningún dato personal. */

import { prepara, sql, leeCupo, leeProximamente, leeTamano, quedan, CUPO_POR_DEFECTO, TAMANO_POR_DEFECTO } from "../lib/db.js";
import { cors } from "../lib/cors.js";

export default async function handler(req, res){
  if (cors(req, res)) return;   // respuesta previa del navegador
  // Corto a propósito: al cambiar el modo desde el panel, la portada lo
  // nota en menos de 15 segundos.
  res.setHeader("Cache-Control", "public, max-age=15");

  if (req.method !== "GET"){
    res.setHeader("Allow", "GET");
    return res.status(405).json({ mensaje: "MÉTODO NO PERMITIDO." });
  }

  try {
    await prepara();
    const q = sql();
    const [{ total }] = await q`select count(*)::int as total from registros`;
    const cupo = await leeCupo();
    const proximamente = await leeProximamente();
    const tamano = await leeTamano();
    return res.status(200).json({ cupo, registrados: total, quedan: quedan(cupo, total), proximamente, tamano });
  } catch (e) {
    console.error("cupo:", e);
    // La portada funciona igual sin este dato, así que no se grita.
    // proximamente: null = "no sé", y la portada se queda como estaba.
    return res.status(200).json({ cupo: CUPO_POR_DEFECTO, registrados: null, quedan: null, proximamente: null, tamano: null });
  }
}
