/* POST /api/ajustes — cambiar ajustes desde el panel. Protegido con
   ADMIN_TOKEN. Acepta cualquiera de los dos, o los dos:
     { cupo: 12 }               cuántos equipos caben (0 = sin límite)
     { proximamente: true }     la portada solo enseña la primera pantalla
                                y el registro no acepta altas */

import { prepara, sql, leeCupo, guardaCupo, leeProximamente, guardaProximamente, quedan } from "../lib/db.js";
import { cors } from "../lib/cors.js";
import { revisaToken } from "../lib/auth.js";

const TOPE = 500;   // por si alguien teclea de más

export default async function handler(req, res){
  if (cors(req, res)) return;
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST"){
    res.setHeader("Allow", "POST");
    return res.status(405).json({ mensaje: "MÉTODO NO PERMITIDO." });
  }

  const mal = revisaToken(req);
  if (mal) return res.status(mal.code).json({ mensaje: mal.mensaje });

  try {
    const cuerpo = req.body || {};
    const traeCupo = cuerpo.cupo !== undefined;
    const traeModo = cuerpo.proximamente !== undefined;
    if (!traeCupo && !traeModo)
      return res.status(400).json({ mensaje: "NO HAY NADA QUE GUARDAR." });

    const cupoNuevo = Number(cuerpo.cupo);
    if (traeCupo && (!Number.isInteger(cupoNuevo) || cupoNuevo < 0 || cupoNuevo > TOPE))
      return res.status(400).json({ mensaje: `EL CUPO DEBE SER UN ENTERO ENTRE 0 (SIN LÍMITE) Y ${TOPE}.` });
    if (traeModo && typeof cuerpo.proximamente !== "boolean")
      return res.status(400).json({ mensaje: "EL MODO PRÓXIMAMENTE ES SÍ O NO." });

    await prepara();
    if (traeCupo) await guardaCupo(cupoNuevo);
    if (traeModo) await guardaProximamente(cuerpo.proximamente);

    const [{ total }] = await sql()`select count(*)::int as total from registros`;
    const cupo = await leeCupo();
    return res.status(200).json({
      ok: true,
      cupo,
      registrados: total,
      quedan: quedan(cupo, total),
      // Bajar el cupo por debajo de lo ya registrado cierra el registro.
      // No se impide: es una forma legítima de cerrarlo antes de tiempo.
      cerrado: cupo > 0 && total >= cupo,
      proximamente: await leeProximamente(),
    });

  } catch (e) {
    console.error("ajustes:", e);
    return res.status(500).json({ mensaje: "NO SE PUDIERON GUARDAR LOS AJUSTES." });
  }
}
