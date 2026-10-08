/* GET /api/desafio?token=…&p=N — ¿toca la prueba del monitor en la
   válvula N? El navegador pregunta al cruzar cada válvula del rango
   (10 a 20) y el servidor solo contesta que sí en la que le toca a esa
   partida, con el tipo de prueba. Así un bot no puede calcular la
   partida perfecta de antemano: tiene que reaccionar en vivo.

   Sin base de datos: la firma del token basta. */

import { cors } from "../lib/cors.js";
import { leePartida, pruebaDe, motor, VIGENCIA_MS } from "../lib/bypass.js";

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
    const { desde, hasta } = motor.PRUEBA;
    if (!Number.isInteger(p) || p < desde || p > hasta) return res.status(200).json({ ahora: false });
    const prueba = pruebaDe(partida.id);
    if (p !== prueba.punto) return res.status(200).json({ ahora: false });
    return res.status(200).json({ ahora: true, tipo: prueba.tipo, verde: prueba.verde });
  } catch (e) {
    console.error("desafio:", e);
    return res.status(500).json({ mensaje: "EL SERVIDOR NO PUDO PREPARAR LA PRUEBA." });
  }
}
