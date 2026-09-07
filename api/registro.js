/* POST /api/registro — alta de un equipo.
   Guarda en Postgres y, si hay llave de Resend, manda el aviso por correo.
   La validación de aquí es un espejo de la del navegador: el cliente valida
   para dar buenos mensajes, el servidor valida porque el cliente es
   modificable por quien sea. */

import { prepara, sql, leeCupo, folio } from "../lib/db.js";
import { cors } from "../lib/cors.js";

const TOPE = { equipo: 32, correo: 120, nombre: 60, tel: 20 };
const limpia = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const CORREO_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res){
  if (cors(req, res)) return;   // respuesta previa del navegador
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST"){
    res.setHeader("Allow", "POST");
    return res.status(405).json({ mensaje: "MÉTODO NO PERMITIDO." });
  }

  try {
    const cuerpo = req.body || {};

    // Campo trampa: está oculto para las personas, así que si viene lleno
    // fue un bot. Se responde 400 sin decirle por qué.
    if (limpia(cuerpo.empresa, 40)) return res.status(400).json({ mensaje: "REGISTRO RECHAZADO." });

    const equipo  = limpia(cuerpo.equipo, TOPE.equipo);
    const correo  = limpia(cuerpo.correo, TOPE.correo).toLowerCase();
    const lider   = Number(cuerpo.lider);
    const emblema = String(cuerpo.emblema ?? "");
    const integrantes = Array.isArray(cuerpo.integrantes)
      ? cuerpo.integrantes.slice(0, 3).map(i => ({
          nombre:   limpia(i?.nombre, TOPE.nombre),
          telefono: limpia(i?.telefono, TOPE.tel),
        }))
      : [];

    if (!equipo)                    return res.status(400).json({ mensaje: "FALTA EL NOMBRE DEL EQUIPO." });
    if (!CORREO_OK.test(correo))    return res.status(400).json({ mensaje: "EL CORREO DE CONTACTO NO ES VÁLIDO." });
    if (integrantes.length !== 3 || integrantes.some(i => !i.nombre))
      return res.status(400).json({ mensaje: "EL EQUIPO DEBE IR COMPLETO: TRES INTEGRANTES." });
    if (!(lider >= 1 && lider <= 3))
      return res.status(400).json({ mensaje: "MARCA A UN LÍDER." });
    if (!integrantes[lider - 1].telefono)
      return res.status(400).json({ mensaje: "FALTA EL TELÉFONO DEL LÍDER." });
    if (!/^[0-3]{144}$/.test(emblema))
      return res.status(400).json({ mensaje: "EL EMBLEMA NO ES VÁLIDO." });

    await prepara();
    const q = sql();

    const [{ total }] = await q`select count(*)::int as total from registros`;
    const cupo = await leeCupo();
    if (total >= cupo)
      return res.status(409).json({ mensaje: `CUPO LLENO: LOS ${cupo} EQUIPOS YA ESTÁN REGISTRADOS.`, lleno: true });

    let fila;
    try {
      [fila] = await q`
        insert into registros (equipo, equipo_key, correo, lider, integrantes, emblema)
        values (${equipo}, ${equipo.toLowerCase()}, ${correo}, ${lider},
                ${JSON.stringify(integrantes)}::jsonb, ${emblema})
        returning id, creado`;
    } catch (e) {
      // Los índices únicos de equipo_key y correo son la defensa real contra
      // dobles envíos: dos peticiones simultáneas no pueden colarse las dos.
      if (/duplicate key|unique constraint/i.test(String(e?.message)))
        return res.status(409).json({ mensaje: "ESE NOMBRE DE EQUIPO O ESE CORREO YA ESTÁN REGISTRADOS." });
      throw e;
    }

    const clave = folio(fila.id);
    // El correo no debe hacer fallar el registro: ya quedó guardado.
    avisa({ folio: clave, equipo, correo, lider, integrantes, emblema }).catch(e =>
      console.error("No se pudo mandar el aviso por correo:", e?.message));

    return res.status(201).json({ ok: true, folio: clave, quedan: Math.max(cupo - total - 1, 0) });

  } catch (e) {
    console.error("registro:", e);
    return res.status(500).json({ mensaje: "EL SERVIDOR NO PUDO GUARDAR EL REGISTRO. INTENTA DE NUEVO." });
  }
}

/* Aviso por correo con la API REST de Resend. Sin SDK: es una sola petición
   y así hay una dependencia menos que mantener al día. */
async function avisa(r){
  const llave     = process.env.RESEND_API_KEY;
  const para      = process.env.CORREO_REGISTROS;
  const remitente = process.env.CORREO_REMITENTE;
  if (!llave || !para || !remitente) return;   // sin configurar: se omite

  const filas = r.integrantes.map((i, n) =>
    `  0${n + 1} ${n + 1 === r.lider ? "[LÍDER]" : "       "} ${i.nombre} — ${i.telefono || "sin teléfono"}`);

  const texto = [
    `REGISTRO HACK(ME)THON — ${r.folio}`,
    "=".repeat(40),
    `EQUIPO ......... ${r.equipo}`,
    `CORREO ......... ${r.correo}`,
    "",
    "INTEGRANTES:",
    ...filas,
    "",
    "EMBLEMA (12x12, 0=apagado 1=magenta 2=violeta 3=brillo):",
    r.emblema,
  ].join("\n");

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${llave}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: remitente,
      to: [para],
      reply_to: r.correo,
      subject: `Registro HACK(ME)THON — ${r.equipo} (${r.folio})`,
      text: texto,
    }),
  });
  if (!resp.ok) throw new Error(`Resend respondió ${resp.status}: ${await resp.text()}`);
}
