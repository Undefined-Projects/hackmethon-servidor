/* POST /api/ajustes — cambiar el cupo desde el panel.
   Protegido con ADMIN_TOKEN. */

import { prepara, sql, leeCupo, guardaCupo } from "../lib/db.js";
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
    const cupo = Number((req.body || {}).cupo);
    if (!Number.isInteger(cupo) || cupo < 1 || cupo > TOPE)
      return res.status(400).json({ mensaje: `EL CUPO DEBE SER UN ENTERO ENTRE 1 Y ${TOPE}.` });

    await prepara();
    await guardaCupo(cupo);

    const [{ total }] = await sql()`select count(*)::int as total from registros`;
    return res.status(200).json({
      ok: true,
      cupo: await leeCupo(),
      registrados: total,
      quedan: Math.max(cupo - total, 0),
      // Bajar el cupo por debajo de lo ya registrado cierra el registro.
      // No se impide: es una forma legítima de cerrarlo antes de tiempo.
      cerrado: total >= cupo,
    });

  } catch (e) {
    console.error("ajustes:", e);
    return res.status(500).json({ mensaje: "NO SE PUDO GUARDAR EL CUPO." });
  }
}
