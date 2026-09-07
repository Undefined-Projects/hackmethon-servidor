/* Permite que la portada viva en otro dominio que la API: la portada está en
   GitHub Pages (undefinedclub.org/hackmethon) y las funciones en Vercel.

   Sin ORIGENES_PERMITIDOS no se manda ninguna cabecera y la API queda
   restringida a su propio origen, que es lo correcto por defecto. */

/* El valor lo escribe una persona en el panel de Vercel, así que se acepta
   como venga: con comillas alrededor (el error más común, porque en un
   archivo .env sí se ponen y ahí el parser las quita), con espacios, con
   barra final o con mayúsculas. */
function normaliza(texto){
  return String(texto ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")        // comillas alrededor de todo el valor
    .split(",")
    .map(s => s.trim()
               .replace(/^["']|["']$/g, "")   // comillas alrededor de una entrada
               .replace(/\/+$/, "")           // barra final
               .toLowerCase())
    .filter(Boolean);
}

export function cors(req, res){
  const permitidos = normaliza(process.env.ORIGENES_PERMITIDOS);
  const origen = req.headers.origin;
  const limpio = String(origen ?? "").trim().replace(/\/+$/, "").toLowerCase();

  if (origen && permitidos.includes(limpio)){
    res.setHeader("Access-Control-Allow-Origin", origen);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  } else if (origen){
    /* Diagnóstico para cuando algo no cuadra. No revela los valores, solo
       cuántos hay configurados, que es lo que hace falta para saber si el
       problema es la variable o el dominio. Se ve con:
         curl -I -H "Origin: https://tu-dominio" .../api/cupo   */
    res.setHeader("X-Cors", permitidos.length
      ? `origen-no-listado; ${permitidos.length} configurados`
      : "sin-configurar");
  }

  // El navegador pregunta antes de mandar el POST de verdad.
  if (req.method === "OPTIONS"){ res.status(204).end(); return true; }
  return false;
}
