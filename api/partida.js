/* GET /api/partida — una semilla firmada para jugar una partida oficial
   de BYPASS. Pública y sin base de datos: la firma es lo que la hace
   válida, así que no cuesta nada darla. La portada la pide por
   adelantado para que empezar a jugar nunca espere a la red. */

import { cors } from "../lib/cors.js";
import { nuevaPartida, abierto, cierre } from "../lib/bypass.js";

export default function handler(req, res){
  if (cors(req, res)) return;
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET"){
    res.setHeader("Allow", "GET");
    return res.status(405).json({ mensaje: "MÉTODO NO PERMITIDO." });
  }
  if (!abierto()) return res.status(200).json({ cerrado: true, cierre: cierre() });

  try {
    return res.status(200).json(nuevaPartida());
  } catch (e) {
    console.error("partida:", e);
    return res.status(500).json({ mensaje: "EL SERVIDOR NO PUDO PREPARAR LA PARTIDA." });
  }
}
