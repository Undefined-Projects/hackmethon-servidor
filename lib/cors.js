/* Permite que la portada viva en otro dominio que la API.
   Hace falta si el sitio se sirve desde GitHub Pages
   (undefinedclub.org/hackmethon) y solo las funciones están en Vercel.

   Sin ORIGENES_PERMITIDOS no se manda ninguna cabecera y la API queda
   restringida a su propio origen, que es lo correcto por defecto. */

export function cors(req, res){
  const permitidos = String(process.env.ORIGENES_PERMITIDOS || "")
    .split(",").map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);

  const origen = req.headers.origin;
  if (origen && permitidos.includes(origen.replace(/\/+$/, ""))){
    res.setHeader("Access-Control-Allow-Origin", origen);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  // El navegador pregunta antes de mandar el POST de verdad.
  if (req.method === "OPTIONS"){ res.status(204).end(); return true; }
  return false;
}
