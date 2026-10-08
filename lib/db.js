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

/* Cuántos equipos caben cuando nadie lo ha cambiado desde el panel.
   0 = SIN LÍMITE, que es lo de la 2.0: sin CUPO_EQUIPOS no hay tope. */
const cupoEnv = Number(process.env.CUPO_EQUIPOS);
export const CUPO_POR_DEFECTO = Number.isInteger(cupoEnv) && cupoEnv > 0 ? cupoEnv : 0;

/* Lugares que quedan, o null si no hay límite. */
export const quedan = (cupo, total) => cupo > 0 ? Math.max(cupo - total, 0) : null;

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
  /* Cambio de edición, una sola vez. La 2.0 se desplegó sobre el mismo
     servidor y la misma base que la 1ª, así que al primer arranque los
     equipos de la 1ª se copian a registros_1a_edicion, se comprueba que la
     copia tenga las mismas filas, y SOLO ENTONCES se vacía registros. También
     se olvida el cupo que guardó el panel de la 1ª (era un tope de 10; la
     2.0 no tiene límite). La marca 'edicion' = '2' hace que no se repita.
     Si dos instancias arrancan a la vez, la segunda encuentra la copia hecha
     y los conteos ya no cuadran, así que no vacía nada de más. */
  const [marca] = await q`select valor from ajustes where clave = 'edicion'`;
  if (marca?.valor !== "2"){
    const [{ n }] = await q`select count(*)::int as n from registros`;
    if (n > 0){
      await q`create table if not exists registros_1a_edicion as select * from registros`;
      const [{ copia }] = await q`select count(*)::int as copia from registros_1a_edicion`;
      if (copia === n) await q`truncate table registros restart identity`;
      else throw new Error(`La copia de la 1ª edición no cuadra (${copia} de ${n}); no se vació nada.`);
    }
    await q`delete from ajustes where clave = 'cupo'`;
    await q`
      insert into ajustes (clave, valor) values ('edicion', '2')
      on conflict (clave) do update set valor = excluded.valor, actualizado = now()`;
  }

  /* BYPASS, el minijuego. Una fila por partida registrada (el id de la
     partida es único: una semilla firmada solo se puede usar una vez) y
     una fila por correo con su mejor puntaje, que es lo que sale en la
     tabla. En empate gana quien lo logró primero. */
  await q`
    create table if not exists bypass_partidas (
      id          text        primary key,
      correo      text        not null,
      puntos      int         not null,
      pasos       int         not null,
      creado      timestamptz not null default now()
    )`;
  // la repetición de cada partida, para revisarla desde el panel
  await q`alter table bypass_partidas add column if not exists semilla   bigint`;
  await q`alter table bypass_partidas add column if not exists latidos   jsonb`;
  await q`alter table bypass_partidas add column if not exists aparicion int`;
  await q`
    create table if not exists bypass_puntajes (
      correo      text        primary key,
      alias       text        not null,
      puntos      int         not null,
      partida     text        not null,
      logrado     timestamptz not null default now()
    )`;
  listo = true;
}

/* Cupo vigente: lo que diga la tabla, y si nadie lo ha tocado, la variable
   de entorno. 0 = sin límite. */
export async function leeCupo(){
  const filas = await sql()`select valor from ajustes where clave = 'cupo'`;
  const n = Number(filas[0]?.valor);
  return filas.length && Number.isInteger(n) && n >= 0 ? n : CUPO_POR_DEFECTO;
}

export async function guardaCupo(n){
  await sql()`
    insert into ajustes (clave, valor) values ('cupo', ${String(n)})
    on conflict (clave) do update set valor = excluded.valor, actualizado = now()`;
}

/* Modo "próximamente": la portada solo enseña la primera pantalla (título,
   monitor y minijuego) y el registro de equipos no acepta altas. Vive en la
   misma tabla de ajustes que el cupo, así que se cambia en caliente desde el
   panel. Sin fila —nadie lo ha tocado todavía— está ACTIVO: la página
   arranca en "próximamente" y se abre a mano desde el panel. */
export async function leeProximamente(){
  const filas = await sql()`select valor from ajustes where clave = 'proximamente'`;
  return filas.length ? filas[0].valor === "1" : true;
}

export async function guardaProximamente(activo){
  await sql()`
    insert into ajustes (clave, valor) values ('proximamente', ${activo ? "1" : "0"})
    on conflict (clave) do update set valor = excluded.valor, actualizado = now()`;
}

export const folio = id => "EQ-" + String(id).padStart(3, "0");
