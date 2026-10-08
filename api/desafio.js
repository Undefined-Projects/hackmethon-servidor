/* GET /api/desafio?token=…&p=N — ¿toca una prueba del monitor en la
   válvula N? El navegador pregunta al cruzar cada válvula (desde la 6) y
   el servidor solo contesta que sí en las que le tocan a esa partida,
   con sus retos. Así un bot no puede calcular la
   partida perfecta de antemano: tiene que reaccionar en vivo.

   Sin base de datos: la firma del token basta. */

import { cors } from "../lib/cors.js";
import { leePartida, pruebasDe, motor, VIGENCIA_MS } from "../lib/bypass.js";

export default function handler(req, res){
  if (cors(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET"){
    res.setHeader("Allow", "GET");
    return res.status(405).json({ mensaje: "MÉTODO NO PERMITIDO." });
  }
  try {
    const partida = leePartida(req.query?.token);
    if (!partida || Date.now() - partida.t > VIGENCIA_MS)
      return res.status(400).json({ mensaje: "LA PARTIDA NO ES VÁLIDA." });
    const p = Number(req.query?.p);
    if (!Number.isInteger(p) || p < motor.PRUEBA.desde) return res.status(200).json({ ahora: false });
    const prueba = pruebasDe(partida.id).find(x => x.punto === p);
    if (!prueba) return res.status(200).json({ ahora: false });
    return res.status(200).json({ ahora: true, def: prueba.def });
  } catch (e) {
    console.error("desafio:", e);
    return res.status(500).json({ mensaje: "EL SERVIDOR NO PUDO PREPARAR LA PRUEBA." });
  }
}
