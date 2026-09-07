/* /api/registros — el listado del panel y el borrado de equipos.
   Todo protegido con ADMIN_TOKEN: son nombres, teléfonos y correos
   de estudiantes.

     GET                → lista completa
     DELETE ?id=7       → borra ese equipo */

import { prepara, sql, leeCupo, folio } from "../lib/db.js";
import { cors } from "../lib/cors.js";
import { revisaToken } from "../lib/auth.js";

export default async function handler(req, res){
  if (cors(req, res)) return;   // respuesta previa del navegador
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "DELETE"){
    res.setHeader("Allow", "GET, DELETE");
    return res.status(405).json({ mensaje: "MÉTODO NO PERMITIDO." });
  }

  const mal = revisaToken(req);
  if (mal) return res.status(mal.code).json({ mensaje: mal.mensaje });

  try {
    await prepara();
    const q = sql();

    if (req.method === "DELETE"){
      const id = Number(new URL(req.url, "http://x").searchParams.get("id"));
      if (!Number.isInteger(id) || id < 1)
        return res.status(400).json({ mensaje: "FALTA EL ID DEL EQUIPO." });

      const [fila] = await q`delete from registros where id = ${id} returning id, equipo`;
      if (!fila)
        return res.status(404).json({ mensaje: "ESE EQUIPO YA NO EXISTE." });

      const [{ total }] = await q`select count(*)::int as total from registros`;
      const cupo = await leeCupo();
      return res.status(200).json({
        ok: true, borrado: folio(fila.id), equipo: fila.equipo,
        cupo, registrados: total, quedan: Math.max(cupo - total, 0),
      });
    }

    const filas = await q`
      select id, equipo, correo, lider, integrantes, emblema, creado
      from registros order by id asc`;
    const cupo = await leeCupo();

    return res.status(200).json({
      cupo,
      registrados: filas.length,
      quedan: Math.max(cupo - filas.length, 0),
      registros: filas.map(f => ({ ...f, folio: folio(f.id) })),
    });

  } catch (e) {
    console.error("registros:", e);
    return res.status(500).json({ mensaje: "NO SE PUDO LEER LA BASE DE DATOS." });
  }
}
