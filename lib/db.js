/* Conexión a Neon y esquema. Lo comparten las tres funciones de /api. */

import { neon } from "@neondatabase/serverless";

let conexion = null;

export function sql(){
  if (!conexion){
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL");
    conexion = neon(url);
  }
  return conexion;
}

/* Cuántos equipos caben cuando nadie lo ha cambiado desde el panel. */
export const CUPO_POR_DEFECTO = Number(process.env.CUPO_EQUIPOS || 10);

/* Crea la tabla si no existe. Se llama en cada invocación pero solo hace
   trabajo la primera vez de cada instancia: `create table if not exists`
   es barato y así no hay migraciones que correr a mano. */
let listo = false;
export async function prepara(){
  if (listo) return;
  const q = sql();
  await q`
    create table if not exists registros (
      id          bigserial   primary key,
      equipo      text        not null,
      equipo_key  text        not null unique,
      correo      text        not null unique,
      lider       int         not null,
      integrantes jsonb       not null,
      emblema     text        not null,
      creado      timestamptz not null default now()
    )`;
  /* Ajustes que se cambian desde el panel. El cupo vive aquí, no en la
     variable de entorno, porque una variable no se puede cambiar en caliente:
     habría que redesplegar cada vez. */
  await q`
    create table if not exists ajustes (
      clave       text        primary key,
      valor       text        not null,
      actualizado timestamptz not null default now()
    )`;
  listo = true;
}

/* Cupo vigente: lo que diga la tabla, y si nadie lo ha tocado, la variable
   de entorno. */
export async function leeCupo(){
  const filas = await sql()`select valor from ajustes where clave = 'cupo'`;
  const n = Number(filas[0]?.valor);
  return Number.isInteger(n) && n > 0 ? n : CUPO_POR_DEFECTO;
}

export async function guardaCupo(n){
  await sql()`
    insert into ajustes (clave, valor) values ('cupo', ${String(n)})
    on conflict (clave) do update set valor = excluded.valor, actualizado = now()`;
}

export const folio = id => "EQ-" + String(id).padStart(3, "0");
