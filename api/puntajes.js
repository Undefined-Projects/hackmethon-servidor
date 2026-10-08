/* /api/puntajes — la tabla de BYPASS.

   GET ?pagina=N            público: una página de 5 (lugar, alias, puntos),
                            cuántos hay en total, cuántos pasan a la
                            dinámica (los 8 primeros) y el cierre.
   GET ?completo=1          panel: todas las filas, con correo. Pide token.
   GET ?repeticion=ID       panel: la repetición de una partida (semilla,
                            latidos y su prueba) para verla. Pide token.
   DELETE ?correo=…         panel: quita a alguien de la tabla. Pide token.
                            Sus partidas quedan registradas, así que no
                            puede volver a usar las mismas. */

import { prepara, sql } from "../lib/db.js";
import { cors } from "../lib/cors.js";
import { revisaToken } from "../lib/auth.js";
import { cierre, abierto, pruebaDe, POR_PAGINA, FINALISTAS } from "../lib/bypass.js";

export default async function handler(req, res){
  if (cors(req, res)) return;

  try {
    if (req.method === "GET" && !req.query?.completo && !req.query?.repeticion){
      res.setHeader("Cache-Control", "public, max-age=15");
      await prepara();
      const q = sql();
      const [{ total }] = await q`select count(*)::int as total from bypass_puntajes`;
      const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
      const pedida = Number.parseInt(req.query?.pagina, 10);
      const pagina = Math.min(paginas, Math.max(1, Number.isFinite(pedida) ? pedida : 1));
      const desde = (pagina - 1) * POR_PAGINA;
      const filas = await q`
        select alias, puntos from bypass_puntajes
        order by puntos desc, logrado asc
        limit ${POR_PAGINA} offset ${desde}`;
      return res.status(200).json({
        filas: filas.map((f, i) => ({ lugar: desde + i + 1, alias: f.alias, puntos: f.puntos })),
        total, pagina, paginas, porPagina: POR_PAGINA, finalistas: FINALISTAS,
        cierre: cierre(), abierto: abierto(),
      });
    }

    res.setHeader("Cache-Control", "no-store");
    const fallo = revisaToken(req);
    if (fallo) return res.status(fallo.code).json({ mensaje: fallo.mensaje });
    await prepara();
    const q = sql();

    if (req.method === "GET" && req.query?.repeticion){
      const id = String(req.query.repeticion);
      const [f] = await q`
        select p.id, p.puntos, p.pasos, p.semilla, p.latidos, p.aparicion, p.creado,
               coalesce(t.alias, '—') as alias
        from bypass_partidas p left join bypass_puntajes t on t.partida = p.id
        where p.id = ${id}`;
      if (!f) return res.status(404).json({ mensaje: "ESA PARTIDA NO EXISTE." });
      if (!f.latidos) return res.status(404).json({ mensaje: "ESA PARTIDA ES DE ANTES DE QUE SE GUARDARAN LAS REPETICIONES." });
      return res.status(200).json({ ...f, semilla: Number(f.semilla), prueba: pruebaDe(f.id) });
    }

    if (req.method === "GET"){
      const filas = await q`
        select correo, alias, puntos, partida, logrado from bypass_puntajes
        order by puntos desc, logrado asc`;
      const [{ partidas }] = await q`select count(*)::int as partidas from bypass_partidas`;
      return res.status(200).json({ filas, partidas, finalistas: FINALISTAS, cierre: cierre(), abierto: abierto() });
    }

    if (req.method === "DELETE"){
      const correo = String(req.query?.correo || "").trim().toLowerCase();
      if (!correo) return res.status(400).json({ mensaje: "FALTA EL CORREO." });
      const borradas = await q`delete from bypass_puntajes where correo = ${correo} returning correo`;
      if (!borradas.length) return res.status(404).json({ mensaje: "ESE CORREO NO ESTÁ EN LA TABLA." });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, DELETE");
    return res.status(405).json({ mensaje: "MÉTODO NO PERMITIDO." });

  } catch (e) {
    console.error("puntajes:", e);
    return res.status(500).json({ mensaje: "EL SERVIDOR NO PUDO LEER LA TABLA." });
  }
}
