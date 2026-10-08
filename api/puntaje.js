/* POST /api/puntaje — registrar una partida de BYPASS en la tabla.

   No se cree el puntaje que manda el navegador: se vuelve a jugar la
   partida con el mismo motor, la misma semilla y los mismos latidos, y
   se cuentan los puntos aquí. Antes se revisa que:
   - la semilla la haya firmado este servidor,
   - la partida no se haya registrado antes (una semilla, un registro),
   - no tenga más de 6 horas,
   - no se haya jugado más rápido que el tiempo real (un bot que
     simule la partida tiene que esperar lo mismo que una persona),
   - los latidos sean una lista sana: enteros, en orden, dentro de la
     partida y no más de 20 por segundo,
   - y la partida haya pasado la prueba del monitor: llegó a la válvula
     secreta, la prueba apareció a tiempo y se respondió como pedía.

   Se guarda la repetición (semilla, latidos, aparición de la prueba)
   para poder verla desde el panel.

   Cada correo tiene una sola fila con su mejor puntaje. */

import { prepara, sql } from "../lib/db.js";
import { cors } from "../lib/cors.js";
import { motor, leePartida, pruebaDe, abierto, VIGENCIA_MS, TOPE_PASOS } from "../lib/bypass.js";

const limpia = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const ALIAS_OK  = /^[A-Z0-9ÁÉÍÓÚÜÑ _.\-]{2,14}$/;
const CORREO_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res){
  if (cors(req, res)) return;
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST"){
    res.setHeader("Allow", "POST");
    return res.status(405).json({ mensaje: "MÉTODO NO PERMITIDO." });
  }

  try {
    const cuerpo = req.body || {};
    if (limpia(cuerpo.empresa, 40)) return res.status(400).json({ mensaje: "PARTIDA RECHAZADA." });
    if (!abierto()) return res.status(403).json({ mensaje: "EL TORNEO YA CERRÓ." });

    const alias  = limpia(cuerpo.alias, 14).toUpperCase();
    const correo = limpia(cuerpo.correo, 120).toLowerCase();
    if (!ALIAS_OK.test(alias))   return res.status(400).json({ mensaje: "EL ALIAS VA DE 2 A 14 LETRAS, NÚMEROS O ESPACIOS." });
    if (!CORREO_OK.test(correo)) return res.status(400).json({ mensaje: "EL CORREO NO ES VÁLIDO." });

    const partida = leePartida(cuerpo.token);
    if (!partida) return res.status(400).json({ mensaje: "LA PARTIDA NO ES VÁLIDA." });
    if (partida.v !== motor.VERSION)
      return res.status(409).json({ mensaje: "ESA PARTIDA ES DE UNA VERSIÓN ANTERIOR DEL JUEGO. JUEGA OTRA." });

    const edad = Date.now() - partida.t;
    if (edad > VIGENCIA_MS) return res.status(400).json({ mensaje: "LA PARTIDA CADUCÓ. JUEGA OTRA." });

    const pasos = Number(cuerpo.pasos);
    if (!Number.isInteger(pasos) || pasos < 1 || pasos > TOPE_PASOS)
      return res.status(400).json({ mensaje: "LA PARTIDA NO ES VÁLIDA." });

    const latidos = cuerpo.latidos;
    if (!Array.isArray(latidos) || latidos.length > pasos / 6 + 10)
      return res.status(400).json({ mensaje: "LA PARTIDA NO ES VÁLIDA." });
    for (let i = 0; i < latidos.length; i++){
      const n = latidos[i];
      if (!Number.isInteger(n) || n < 1 || n > pasos || (i && n <= latidos[i - 1]))
        return res.status(400).json({ mensaje: "LA PARTIDA NO ES VÁLIDA." });
    }

    // no más rápido que el tiempo real (con 3 % de holgura por relojes)
    if (edad < pasos * motor.DT * 1000 * .97)
      return res.status(400).json({ mensaje: "LA PARTIDA DURÓ MENOS DE LO QUE DICE." });

    // y se vuelve a jugar
    const r = motor.simula(partida.s, latidos, pasos);
    if (r.vivo || r.pasos !== pasos)
      return res.status(400).json({ mensaje: "LA PARTIDA NO CUADRA CON LA SIMULACIÓN." });
    const puntos = r.puntos;
    if (puntos <= 0) return res.status(400).json({ mensaje: "UNA PARTIDA SIN PUNTOS NO ENTRA A LA TABLA." });

    // la prueba del monitor
    const prueba = pruebaDe(partida.id);
    const sP = r.pasoDePunto[prueba.punto];
    const a = Number(cuerpo.prueba?.aparicion);
    if (sP === undefined)
      return res.status(400).json({ mensaje: `PARA ENTRAR A LA TABLA HAY QUE LLEGAR A LA PRUEBA DEL MONITOR (ENTRE LA VÁLVULA ${motor.PRUEBA.desde} Y LA ${motor.PRUEBA.hasta}).` });
    if (!Number.isInteger(a) || a < sP || a > sP + motor.PRUEBA.llega
        || !motor.cumplePrueba(prueba.tipo, prueba.verde, a, latidos))
      return res.status(400).json({ mensaje: "LA PARTIDA NO PASÓ LA PRUEBA DEL MONITOR." });

    await prepara();
    const q = sql();
    try {
      await q`insert into bypass_partidas (id, correo, puntos, pasos, semilla, latidos, aparicion)
              values (${partida.id}, ${correo}, ${puntos}, ${pasos}, ${partida.s},
                      ${JSON.stringify(latidos)}::jsonb, ${a})`;
    } catch (e) {
      if (/duplicate key|unique constraint/i.test(String(e?.message)))
        return res.status(409).json({ mensaje: "ESA PARTIDA YA SE REGISTRÓ." });
      throw e;
    }

    // solo se sobrescribe si mejora
    await q`
      insert into bypass_puntajes (correo, alias, puntos, partida)
      values (${correo}, ${alias}, ${puntos}, ${partida.id})
      on conflict (correo) do update
        set alias = excluded.alias, puntos = excluded.puntos,
            partida = excluded.partida, logrado = now()
        where bypass_puntajes.puntos < excluded.puntos`;
    const [mio] = await q`select puntos, logrado from bypass_puntajes where correo = ${correo}`;
    const [{ n }] = await q`
      select count(*)::int as n from bypass_puntajes
      where puntos > ${mio.puntos} or (puntos = ${mio.puntos} and logrado < ${mio.logrado})`;

    return res.status(201).json({ ok: true, puntos, mejor: mio.puntos, posicion: n + 1 });

  } catch (e) {
    console.error("puntaje:", e);
    return res.status(500).json({ mensaje: "EL SERVIDOR NO PUDO REGISTRAR LA PARTIDA. INTENTA DE NUEVO." });
  }
}
