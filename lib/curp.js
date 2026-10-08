/* Validación de la CURP (y de los datos de cada integrante).

   La CURP se revisa en tres capas:
   1. Formato oficial: 4 letras, fecha AAMMDD válida, sexo (H, M o X),
      entidad de nacimiento, 3 consonantes internas, homoclave y dígito.
   2. Dígito verificador: el algoritmo de RENAPO (suma ponderada de los
      primeros 17 caracteres). Atrapa errores de dedo.
   3. Coherencia con la edad que se escribió (± 1 año, por el cumpleaños).

   La misma lógica está copiada en sitio/script.js para avisar antes de
   enviar; el servidor es el que manda. */

const ENTIDADES = "AS BC BS CC CL CM CS CH DF DG GT GR HG JC MC MN MS NT NL OC PL QT QR SP SL SR TC TS TL VZ YN ZS NE".split(" ");
const FORMATO = /^[A-Z][AEIOUX][A-Z]{2}(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HMX]([A-Z]{2})[B-DF-HJ-NP-TV-Z]{3}([A-Z\d])(\d)$/;
const DIC = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";

export const limpiaCurp = v => String(v ?? "").toUpperCase().replace(/\s+/g, "");

/* La fecha de nacimiento que trae la CURP. El penúltimo carácter dice el
   siglo: un dígito es 1900–1999, una letra es 2000 en adelante. */
export function nacimiento(curp){
  const m = FORMATO.exec(curp);
  if (!m) return null;
  const anio = (/\d/.test(m[5]) ? 1900 : 2000) + Number(m[1]);
  const f = new Date(Date.UTC(anio, Number(m[2]) - 1, Number(m[3])));
  // 31 de febrero y similares no existen
  return f.getUTCMonth() === Number(m[2]) - 1 ? f : null;
}

export function curpValida(curp){
  const m = FORMATO.exec(curp);
  if (!m || !ENTIDADES.includes(m[4]) || !nacimiento(curp)) return false;
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += DIC.indexOf(curp[i]) * (18 - i);
  return (10 - (suma % 10)) % 10 === Number(curp[17]);
}

export function edadDe(curp, hoy = new Date()){
  const f = nacimiento(curp);
  if (!f) return null;
  let e = hoy.getUTCFullYear() - f.getUTCFullYear();
  if (hoy.getUTCMonth() < f.getUTCMonth() || (hoy.getUTCMonth() === f.getUTCMonth() && hoy.getUTCDate() < f.getUTCDate())) e--;
  return e;
}

/* Teléfono mexicano: 10 dígitos. Se aceptan espacios, guiones y +52. */
export function limpiaTelefono(v){
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
  return d.length === 10 ? d : null;
}
