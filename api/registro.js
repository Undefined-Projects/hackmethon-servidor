/* POST /api/registro — alta de un equipo.
   Guarda en Postgres y, si hay llave de Resend, manda el aviso por correo.
   La validación de aquí es un espejo de la del navegador: el cliente valida
   para dar buenos mensajes, el servidor valida porque el cliente es
   modificable por quien sea. */

import { prepara, sql, leeCupo, leeProximamente, leeTamano, quedan, folio } from "../lib/db.js";
import { cors } from "../lib/cors.js";
import { limpiaCurp, curpValida, edadDe, limpiaTelefono } from "../lib/curp.js";

const TOPE = { equipo: 32, correo: 120, nombre: 80, escuela: 80 };
const EDAD = { min: 12, max: 99, mayor: 18 };
const limpia = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const CORREO_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const mal = (res, mensaje) => res.status(400).json({ mensaje });

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
    if (limpia(cuerpo.empresa, 40)) return mal(res, "REGISTRO RECHAZADO.");

    const equipo  = limpia(cuerpo.equipo, TOPE.equipo);
    const lider   = Number(cuerpo.lider);
    const emblema = String(cuerpo.emblema ?? "");
    const crudos  = Array.isArray(cuerpo.integrantes) ? cuerpo.integrantes.slice(0, 12) : [];
    const integrantes = crudos.map(i => ({
      nombre:   limpia(i?.nombre, TOPE.nombre),
      correo:   limpia(i?.correo, TOPE.correo).toLowerCase(),
      curp:     limpiaCurp(i?.curp).slice(0, 18),
      escuela:  limpia(i?.escuela, TOPE.escuela),
      edad:     Number(i?.edad),
      telefono: limpiaTelefono(i?.telefono),
    }));

    if (!equipo) return mal(res, "FALTA EL NOMBRE DEL EQUIPO.");
    if (cuerpo.privacidad !== true)
      return mal(res, "PARA REGISTRARTE HAY QUE ACEPTAR EL AVISO DE PRIVACIDAD.");
    if (!/^[0-4]{144}$/.test(emblema)) return mal(res, "EL EMBLEMA NO ES VÁLIDO.");

    // Cada integrante, con su número para que el mensaje diga a quién corregir.
    for (const [n, i] of integrantes.entries()){
      const quien = `INTEGRANTE ${n + 1}`;
      if (i.nombre.split(" ").length < 2) return mal(res, `${quien}: ESCRIBE EL NOMBRE COMPLETO.`);
      if (!CORREO_OK.test(i.correo))     return mal(res, `${quien}: EL CORREO NO ES VÁLIDO.`);
      if (!curpValida(i.curp))           return mal(res, `${quien}: LA CURP NO ES VÁLIDA.`);
      if (!Number.isInteger(i.edad) || i.edad < EDAD.min || i.edad > EDAD.max)
        return mal(res, `${quien}: LA EDAD DEBE IR DE ${EDAD.min} A ${EDAD.max} AÑOS.`);
      // la CURP trae la fecha de nacimiento: la edad escrita debe cuadrar
      if (Math.abs(edadDe(i.curp) - i.edad) > 1)
        return mal(res, `${quien}: LA EDAD NO COINCIDE CON LA CURP.`);
      if (!i.telefono) return mal(res, `${quien}: EL TELÉFONO DEBE TENER 10 DÍGITOS.`);
    }
    const repetida = (k) => new Set(integrantes.map(i => i[k])).size !== integrantes.length;
    if (repetida("curp"))   return mal(res, "DOS INTEGRANTES TIENEN LA MISMA CURP.");
    if (repetida("correo")) return mal(res, "DOS INTEGRANTES TIENEN EL MISMO CORREO.");
    // Menores de edad: hace falta la autorización de su madre, padre o tutor.
    const hayMenores = integrantes.some(i => i.edad < EDAD.mayor);
    if (hayMenores && cuerpo.tutor !== true)
      return mal(res, "HAY MENORES DE EDAD: FALTA CONFIRMAR LA AUTORIZACIÓN DE SU TUTOR.");

    await prepara();
    const q = sql();

    // En modo "próximamente" la portada ni enseña el formulario, pero el
    // servidor también lo cierra: el cliente es modificable.
    if (await leeProximamente())
      return res.status(409).json({ mensaje: "EL REGISTRO TODAVÍA NO ABRE.", lleno: true });

    // El tamaño lo decide el panel; el formulario lo lee de /api/cupo. Si
    // cambió mientras alguien llenaba el formulario, se le dice.
    const tamano = await leeTamano();
    if (integrantes.length !== tamano)
      return mal(res, `LOS EQUIPOS SON DE ${tamano} INTEGRANTE${tamano === 1 ? "" : "S"}. RECARGA LA PÁGINA.`);
    if (!(lider >= 1 && lider <= tamano)) return mal(res, "MARCA A UN LÍDER.");

    // Nadie puede estar en dos equipos.
    const curps = integrantes.map(i => i.curp);
    const [ya] = await q`
      select i->>'curp' as curp from registros, jsonb_array_elements(integrantes) i
      where i->>'curp' = any(${curps}) limit 1`;
    if (ya) return res.status(409).json({
      mensaje: `INTEGRANTE ${curps.indexOf(ya.curp) + 1}: ESA CURP YA ESTÁ REGISTRADA EN OTRO EQUIPO.` });

    const [{ total }] = await q`select count(*)::int as total from registros`;
    const cupo = await leeCupo();
    if (cupo > 0 && total >= cupo)                 // 0 = sin límite
      return res.status(409).json({ mensaje: `CUPO LLENO: LOS ${cupo} EQUIPOS YA ESTÁN REGISTRADOS.`, lleno: true });

    // el correo de contacto del equipo es el de su líder
    const correo = integrantes[lider - 1].correo;

    let fila;
    try {
      [fila] = await q`
        insert into registros (equipo, equipo_key, correo, lider, integrantes, emblema, privacidad, tutor)
        values (${equipo}, ${equipo.toLowerCase()}, ${correo}, ${lider},
                ${JSON.stringify(integrantes)}::jsonb, ${emblema}, now(), ${hayMenores})
        returning id, creado`;
    } catch (e) {
      // Los índices únicos de equipo_key y correo son la defensa real contra
      // dobles envíos: dos peticiones simultáneas no pueden colarse las dos.
      if (/duplicate key|unique constraint/i.test(String(e?.message)))
        return res.status(409).json({ mensaje: "ESE NOMBRE DE EQUIPO O EL CORREO DEL LÍDER YA ESTÁN REGISTRADOS." });
      throw e;
    }

    const clave = folio(fila.id);
    // El correo no debe hacer fallar el registro: ya quedó guardado.
    avisa({ folio: clave, equipo, correo, lider, integrantes, emblema }).catch(e =>
      console.error("No se pudo mandar el aviso por correo:", e?.message));

    return res.status(201).json({ ok: true, folio: clave, quedan: quedan(cupo, total + 1) });

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

  // La CURP no viaja por correo: se consulta en el panel.
  const filas = r.integrantes.map((i, n) =>
    `  0${n + 1} ${n + 1 === r.lider ? "[LÍDER]" : "       "} ${i.nombre} — ${i.edad} años — ${i.telefono} — ${i.correo}`
    + (i.escuela ? `\n             ${i.escuela}` : ""));

  const texto = [
    `REGISTRO HACK(ME)THON 2.0 — ${r.folio}`,
    "=".repeat(40),
    `EQUIPO ......... ${r.equipo}`,
    `CONTACTO ....... ${r.correo}`,
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
      subject: `Registro HACK(ME)THON 2.0 — ${r.equipo} (${r.folio})`,
      text: texto,
    }),
  });
  if (!resp.ok) throw new Error(`Resend respondió ${resp.status}: ${await resp.text()}`);
}
