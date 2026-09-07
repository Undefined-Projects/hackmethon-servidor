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

/* Cuántos equipos caben. El servidor rechaza registros al llegar al tope. */
export const CUPO = Number(process.env.CUPO_EQUIPOS || 10);

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
  listo = true;
}

export const folio = id => "EQ-" + String(id).padStart(3, "0");
