/* ============================================================
   HACK(ME)THON 2.0 — BYPASS · el motor
   ────────────────────────────────────────────────────────────
   La física del minijuego, sin dibujo. Es determinista: con la
   misma semilla y los mismos latidos, la partida sale idéntica en
   cualquier navegador y en el servidor. Eso es lo que hace que el
   leaderboard sea confiable: el servidor no cree el puntaje que le
   mandan, vuelve a jugar la partida y cuenta él.

   Para que sea determinista de verdad:
   - Paso fijo de 1/120 s. El tiempo real nunca entra al motor.
   - Azar con semilla (mulberry32), nunca Math.random.
   - Nada de Math.sin, Math.sqrt ni Math.hypot: el estándar deja
     que cada navegador los aproxime a su manera, y una diferencia
     en el último decimal desvía la partida. Se usan seno() y raiz()
     de aquí, hechos solo con + − × ÷, que sí son exactos en todos.
   - Mundo de tamaño fijo (300 × 110), igual en cualquier pantalla.

   ⚠ ESTE ARCHIVO SE COPIA TAL CUAL AL SERVIDOR (lib/bypass-motor.cjs)
     con `python3 build.py`. Si cambias algo aquí y no lo copias, el
     servidor va a rechazar todas las partidas por no cuadrar.
   ============================================================ */
(function (raiz, fabrica){
  const motor = fabrica();
  if (typeof module === "object" && module.exports) module.exports = motor;
  else raiz.BypassMotor = motor;
})(typeof globalThis !== "undefined" ? globalThis : this, function (){

  const VERSION = 5;          // súbelo si cambia la física: invalida partidas viejas
                              // 2: calma al voltear y prueba sin obstáculos
                              // 3: 1.5 s para leer la prueba; ritmo con más margen
                              // 4: varias pruebas por partida, cada una con 2–3 retos
                              // 5: gravedad lenta en el reto verde/rojo, y en rojo el pulso flota

  /* ── el mundo ─────────────────────────────────────────────── */
  const W = 300, H = 110, SUELO = H - 4;
  const DT       = 1 / 120;
  const G        = 560;       // gravedad
  const LATIDO   = -165;      // velocidad hacia arriba al latir
  /* En el reto verde/rojo todo va más lento para que dé tiempo de ver el
     color: la mitad de gravedad y un latido √½ más suave. Cada latido
     sube lo mismo que siempre (v²/2g no cambia), pero tarda √2 ≈ 1.4
     veces más en subir y bajar. Y mientras el pulso está en rojo no hay
     gravedad y se va frenando: flota donde está. Así el rojo solo pide
     no latir, sin castigar con una caída al suelo. */
  const G_LENTA      = G * .5;
  const LATIDO_LENTO = LATIDO * .7071067811865476;
  const FRENO_ROJO   = .95;     // por paso: en ~0.1 s casi se detiene
  const ANCHO    = 14;        // ancho de una válvula
  const PULSO_X  = 72;
  const ESPACIO  = 96;        // separación entre válvulas
  const CARGA    = .45;       // aviso antes de cada disparo del gusano
  /* Cada GIRO válvulas el dibujo se voltea (gravedad y lado invertidos;
     ver bypass.js) y aquí se dan CALMA_GIRO pasos sin obstáculos para
     reaccionar. En esas válvulas no hay furia. */
  const GIRO = 20;
  const CALMA_GIRO = 360;           // 3 s
  const CALMA_TRAS_PRUEBA = 120;    // 1 s para volver a entrar en ritmo
  const FURIA = {
    cada:   10,               // válvulas entre una furia y otra
    aviso:  1.0,
    muros:  [1.0, 1.85, 2.7],
    fin:    3.3,
    hueco:  32,
    paso:   7,
  };

  /* ── matemáticas deterministas ────────────────────────────── */
  function azar(semilla){
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const PI = 3.141592653589793, DOS_PI = 6.283185307179586, MEDIO_PI = 1.5707963267948966;
  // Serie de Taylor hasta x¹¹ tras reducir a [−π/2, π/2]: error < 1e-6.
  function seno(x){
    x = x - Math.floor(x / DOS_PI) * DOS_PI;
    if (x > PI) x -= DOS_PI;
    if (x > MEDIO_PI) x = PI - x;
    else if (x < -MEDIO_PI) x = -PI - x;
    const x2 = x * x;
    return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110)))));
  }
  // Newton con número fijo de vueltas y punto de partida fijo.
  function raiz(v){
    if (!(v > 0)) return 0;
    let r = v > 1 ? v : 1;
    for (let i = 0; i < 40; i++) r = .5 * (r + v / r);
    return r;
  }
  const limita = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ── estado ───────────────────────────────────────────────── */
  function crea(semilla){
    return {
      r: azar(semilla),
      paso: 0, t: 0, vivo: true, motivo: null,
      puntos: 0, velocidad: 62, fondoX: 0,
      pulso:   { x: PULSO_X, y: H / 2, vy: 0 },
      valvulas: [],
      gusano:  { x: W - 13, y: H / 2, espera: 1.8, carga: 0 },
      virus:   [],
      furia:   null,
      calma:   0,                 // pasos que quedan sin obstáculos
      prueba:  null,              // la prueba del monitor en curso (o la última)
      pruebas: [],                // cómo terminó cada prueba: "ok" | "falla"
    };
  }

  // ¿se está en un tramo sin obstáculos?
  const tranquilo = e => e.calma > 0 || (e.prueba && e.prueba.estado === "activa");

  /* Despejar: se van las válvulas que faltan por cruzar y los virus, y el
     gusano deja lo que estaba haciendo. */
  function despeja(e, ev){
    const p = e.pulso;
    for (const v of e.valvulas) if (!v.pasada) ev.push({ tipo: "limpia", x: v.x + ANCHO / 2, y: v.centro });
    for (const z of e.virus) ev.push({ tipo: "limpia", x: z.x, y: z.y });
    e.valvulas = e.valvulas.filter(v => v.pasada || v.x + ANCHO < p.x - 3);
    e.virus = [];
    e.furia = null;
    e.gusano.carga = 0;
  }

  function nuevaValvula(e){
    const r = e.r;
    const hueco  = Math.max(36, 50 - e.puntos * .6);
    const centro = 18 + hueco / 2 + r() * (SUELO - 36 - hueco);
    const mueve  = e.puntos >= 8 && r() < .35;
    const hojas = [];
    for (let i = 0; i < 6; i++)
      hojas.push({ lado: r() < .5 ? -1 : 1, y: r(), arriba: r() < .5, hi: r() < .3 });
    e.valvulas.push({ x: W + 4, base: centro, centro, hueco, mueve, fase: r() * 6.28,
                      pasada: false, hojas, pista: 3 + Math.floor(r() * 6) });
  }

  function mueveGusano(e, dt){
    const g = e.gusano;
    const onda = H / 2 - 4 + seno(e.t * 1.1) * (SUELO / 2 - 14);
    const meta = onda * .55 + e.pulso.y * .45;
    g.y += (limita(meta, 14, SUELO - 14) - g.y) * Math.min(1, dt * 2.2);
  }

  function disparaGusano(e, dt, ev){
    const g = e.gusano;
    if (g.carga > 0){
      g.carga -= dt;
      if (g.carga <= 0){
        const ox = g.x - 12, oy = g.y;
        const v = 74 + Math.min(34, e.puntos * 1.6);
        let dx = e.pulso.x - ox, dy = e.pulso.y - oy;
        const L = raiz(dx * dx + dy * dy) || 1;
        dx /= L; dy /= L;
        if (dy > .6 || dy < -.6){ dy = dy > 0 ? .6 : -.6; dx = -raiz(1 - dy * dy); }
        e.virus.push({ x: ox, y: oy, vx: dx * v, vy: dy * v, t: 0, furia: false });
        g.espera = Math.max(.9, 2.3 - e.puntos * .07) * (.85 + e.r() * .3);
        ev.push({ tipo: "disparo", x: ox, y: oy });
      }
      return;
    }
    g.espera -= dt;
    if (g.espera <= 0) g.carga = CARGA;
  }

  function avanzaFuria(e, dt, ev){
    const f = e.furia;
    f.t += dt;
    while (f.hechos < FURIA.muros.length && f.t >= FURIA.muros[f.hechos]){
      const min = 6 + FURIA.hueco / 2, max = SUELO - 6 - FURIA.hueco / 2;
      let centro = f.hechos === 0 ? e.pulso.y
        : f.centro + (e.r() < .5 ? -1 : 1) * (14 + e.r() * 12);
      if (centro < min || centro > max) centro = f.centro - (centro - f.centro);
      f.centro = limita(centro, min, max);
      const ox = e.gusano.x - 12, v = e.velocidad + 16;
      for (let y = 4; y < SUELO - 2; y += FURIA.paso){
        const d = y - f.centro;
        if (d <= FURIA.hueco / 2 && d >= -FURIA.hueco / 2) continue;
        e.virus.push({ x: ox + (e.r() - .5) * 2, y, vx: -v, vy: 0, t: e.r(), furia: true });
      }
      ev.push({ tipo: "muro", x: ox, y: e.gusano.y });
      f.hechos++;
    }
    if (f.t >= FURIA.fin){
      e.furia = null;
      e.gusano.espera = 1.6;
      ev.push({ tipo: "finFuria" });
    }
  }

  function muere(e, motivo, ev){
    e.vivo = false;
    e.motivo = motivo;
    e.furia = null;
    ev.push({ tipo: "muerte", motivo });
  }

  /* ── un paso de 1/120 s ───────────────────────────────────────
     latio: si en este paso el jugador latió. Devuelve los eventos
     del paso para que el dibujo reaccione (chispas, sacudidas…). */
  function avanza(e, latio){
    const ev = [];
    if (!e.vivo) return ev;
    const dt = DT;
    e.paso++;
    e.t = e.paso * DT;
    const p = e.pulso;

    const lenta = activa(e) && e.prueba.tipo === "verde";
    const rojo  = lenta && e.prueba.ventanas.some(v => !v.verde && e.paso >= v.ini && e.paso <= v.fin);
    if (latio) p.vy = lenta ? LATIDO_LENTO : LATIDO;
    if (rojo) p.vy *= FRENO_ROJO;
    else p.vy += (lenta ? G_LENTA : G) * dt;
    p.y += p.vy * dt;
    e.fondoX += e.velocidad * dt;

    const ultima = e.valvulas[e.valvulas.length - 1];
    if (!e.furia && !tranquilo(e) && (!ultima || ultima.x < W - ESPACIO)) nuevaValvula(e);

    let volteo = false;
    for (const v of e.valvulas){
      v.x -= e.velocidad * dt;
      if (v.mueve) v.centro = v.base + seno(e.t * 1.7 + v.fase) * 9;
      if (!v.pasada && v.x + ANCHO < p.x - 3){
        v.pasada = true;
        e.puntos++;
        e.velocidad = Math.min(105, 62 + e.puntos * 2);
        ev.push({ tipo: "punto" });
        if (e.puntos % GIRO === 0){
          e.calma = CALMA_GIRO;
          volteo = true;
        } else if (e.puntos % FURIA.cada === 0 && !tranquilo(e)){
          e.furia = { t: 0, hechos: 0, centro: p.y };
          e.gusano.carga = 0;
          ev.push({ tipo: "furia" });
        }
      }
    }
    e.valvulas = e.valvulas.filter(v => v.x > -ANCHO - 4);
    if (volteo){ despeja(e, ev); ev.push({ tipo: "giro" }); }

    mueveGusano(e, dt);
    if (tranquilo(e)){
      // sin obstáculos: el gusano solo ronda, y al terminar espera un poco
      e.gusano.espera = Math.max(e.gusano.espera, 1);
      if (e.calma > 0) e.calma--;
    }
    else if (e.furia) avanzaFuria(e, dt, ev);
    else disparaGusano(e, dt, ev);

    for (const z of e.virus){ z.x += z.vx * dt; z.y += z.vy * dt; z.t += dt; }
    e.virus = e.virus.filter(z => {
      if (z.x < -6 || z.y < -6 || z.y > SUELO + 2) return false;
      for (const v of e.valvulas){
        if (z.x < v.x - 2 || z.x > v.x + ANCHO + 2) continue;
        if (z.y < v.centro - v.hueco / 2 || z.y > v.centro + v.hueco / 2){
          ev.push({ tipo: "absorbe", x: z.x, y: z.y });
          return false;
        }
      }
      return true;
    });

    // choques: caja de 5×5 en el centro del pulso
    const a = p.x - 2.5, b = p.x + 2.5, t = p.y - 2.5, u = p.y + 2.5;
    if (t < 0 || u > SUELO){ muere(e, "valvula", ev); return ev; }
    for (const v of e.valvulas){
      if (b < v.x - 1 || a > v.x + ANCHO + 1) continue;
      if (t < v.centro - v.hueco / 2 || u > v.centro + v.hueco / 2){ muere(e, "valvula", ev); return ev; }
    }
    for (const z of e.virus){
      const dx = z.x - p.x, dy = z.y - p.y;
      if (dx * dx + dy * dy < 4.2 * 4.2){ muere(e, z.furia ? "furia" : "virus", ev); return ev; }
    }
    if (activa(e)) evaluaPrueba(e, latio, ev);
    return ev;
  }

  /* ── volver a jugar una partida ───────────────────────────────
     latidos: los números de paso en que el jugador latió, en orden.
     Es lo que hace el servidor para contar los puntos él mismo.
     pruebas: [{ a, def }, …] — en qué paso apareció cada prueba del
     monitor y cuál era; se inyectan igual que las vio el jugador.
     pasoDePunto[n] = el paso en que se cruzó la válvula n. */
  function simula(semilla, latidos, tope, pruebas){
    const e = crea(semilla);
    const pasoDePunto = [0];
    const lista = pruebas || [];
    let i = 0, j = 0;
    while (e.vivo && e.paso < tope){
      // cada prueba entra en su paso; si llega con otra en curso, no entra
      // (y la partida no cuadra: el navegador nunca haría eso)
      while (j < lista.length && e.paso === lista[j].a){
        if (!activa(e)) iniciaPrueba(e, lista[j].def);
        j++;
      }
      const siguiente = e.paso + 1;
      let latio = false;
      while (i < latidos.length && latidos[i] === siguiente){ latio = true; i++; }
      for (const ev of avanza(e, latio)) if (ev.tipo === "punto") pasoDePunto[e.puntos] = e.paso;
    }
    // la que seguía en curso al morir cuenta como no superada
    const estados = e.pruebas.slice();
    if (activa(e)) estados.push("activa");
    return { puntos: e.puntos, pasos: e.paso, vivo: e.vivo, motivo: e.motivo, pasoDePunto,
             pruebas: estados };
  }

  /* ── la prueba del monitor ────────────────────────────────────
     Varias por partida, en válvulas al azar: las elige el servidor con
     una llave que el navegador no tiene, y el navegador se entera hasta
     cruzar esa válvula (GET /api/desafio). Al aparecer se despeja la
     pantalla y no sale nada hasta que termina: es control, no esquivar.
     Cada prueba encadena 2 o 3 retos distintos, cada uno con su tiempo
     de lectura. Fallar uno es fallar la prueba, y una partida con una
     prueba fallida (o sin ninguna) no entra a la tabla.

       franja — la franja sube y baja: hay que acumular 4 s dentro
       ritmo  — 6 golpes al compás del anillo; a la mitad cambia el ritmo
       marcas — tocar 4 alturas en orden
       verde  — latir cada vez que el pulso se pone verde y NUNCA cuando
                se pone rojo

     def (del servidor): { retos: [reto, …] } con
       { tipo: "franja", c, amp, per, sen } | { tipo: "ritmo", T1, T2 }
       { tipo: "marcas", ys: [y1, y2, y3, y4] }
       { tipo: "verde", s: [[color, espera], …] }   color 1 = verde, 0 = rojo
     El motor los evalúa paso a paso, igual en el navegador y en el
     servidor. Los tiempos van en pasos de 1/120 s. */
  const PRUEBA = {
    desde: 6,          // la primera, nunca antes de la válvula 6
    llega: 360,        // margen de red: aparecer hasta 3 s después de cruzar la válvula
    lectura: 180,      // 1.5 s para leer cada reto antes de que cuente
    franjaH: 16, franjaNecesita: 480, franjaDura: 1200,   // 4 s dentro, en 10 s
    ritmoGolpes: 6, ritmoEntrada: 90, ritmoTol: 24,       // ± 0.2 s por golpe
    marcaTol: 5, marcasDura: 1320,                        // 4 marcas en 11 s
    verdeVentana: 78, rojoVentana: 48,                    // 0.65 s y 0.4 s
  };

  const activa = e => !!(e.prueba && e.prueba.estado === "activa");

  // Pone en `pr` el reto número n, que empieza a leerse en el paso `desde`.
  function armaReto(pr, n, desde){
    for (const k of ["c", "amp", "per", "sen", "cy", "T1", "T2", "ys", "s", "golpes", "marcas", "ventanas"]) delete pr[k];
    const r = pr.retos[n];
    const ini = desde + PRUEBA.lectura;
    Object.assign(pr, r, { n, ini, avance: 0 });
    if (r.tipo === "franja"){
      pr.cy = r.c;
      pr.fin = ini + PRUEBA.franjaDura;
    }
    if (r.tipo === "ritmo"){
      pr.golpes = [];
      let t = ini + PRUEBA.ritmoEntrada;
      for (let k = 0; k < PRUEBA.ritmoGolpes; k++){
        pr.golpes.push({ en: t, ok: false });
        t += k < PRUEBA.ritmoGolpes / 2 - 1 ? r.T1 : r.T2;
      }
      pr.fin = pr.golpes[pr.golpes.length - 1].en + PRUEBA.ritmoTol + 1;
    }
    if (r.tipo === "marcas"){
      pr.marcas = r.ys.map(y => ({ y, ok: false }));
      pr.fin = ini + PRUEBA.marcasDura;
    }
    if (r.tipo === "verde"){
      pr.ventanas = [];
      let t = ini;
      for (const [color, espera] of r.s){
        t += espera;
        const largo = color ? PRUEBA.verdeVentana : PRUEBA.rojoVentana;
        pr.ventanas.push({ ini: t, fin: t + largo, verde: !!color, ok: false });
        t += largo;
      }
      pr.fin = t + 1;
    }
  }

  function iniciaPrueba(e, def){
    const ev = [];
    despeja(e, ev);
    const pr = { retos: def.retos, a: e.paso, estado: "activa" };
    armaReto(pr, 0, e.paso);
    e.prueba = pr;
    return ev;
  }

  function evaluaPrueba(e, latio, ev){
    const pr = e.prueba, paso = e.paso, y = e.pulso.y;
    if (paso < pr.ini) return;                     // todavía se está leyendo
    let lista = false, perdida = paso > pr.fin;
    if (pr.tipo === "franja"){
      // la franja se mueve: c + amp · sen(2π t / per)
      pr.cy = pr.c + pr.sen * pr.amp * seno((paso - pr.ini) * DOS_PI / pr.per);
      const d = y - pr.cy;
      if (d <= PRUEBA.franjaH && d >= -PRUEBA.franjaH) pr.avance++;
      lista = pr.avance >= PRUEBA.franjaNecesita;
    } else if (pr.tipo === "ritmo"){
      if (latio) for (const g of pr.golpes)
        if (!g.ok && paso >= g.en - PRUEBA.ritmoTol && paso <= g.en + PRUEBA.ritmoTol){ g.ok = true; ev.push({ tipo: "acierto" }); break; }
      pr.avance = pr.golpes.filter(g => g.ok).length;
      lista = pr.avance === pr.golpes.length;
      if (pr.golpes.some(g => !g.ok && paso > g.en + PRUEBA.ritmoTol)) perdida = true;
    } else if (pr.tipo === "marcas"){
      const m = pr.marcas.find(x => !x.ok);
      if (m && y - m.y <= PRUEBA.marcaTol && y - m.y >= -PRUEBA.marcaTol){ m.ok = true; ev.push({ tipo: "acierto" }); }
      pr.avance = pr.marcas.filter(x => x.ok).length;
      lista = pr.avance === pr.marcas.length;
    } else if (pr.tipo === "verde"){
      if (latio) for (const v of pr.ventanas){
        if (paso < v.ini || paso > v.fin) continue;
        if (!v.verde){ perdida = true; break; }     // latir en rojo es perder
        if (!v.ok){ v.ok = true; ev.push({ tipo: "acierto" }); }
        break;
      }
      const verdes = pr.ventanas.filter(v => v.verde);
      pr.avance = verdes.filter(v => v.ok).length;
      lista = pr.avance === verdes.length && paso > pr.fin - 1;
      if (verdes.some(v => !v.ok && paso > v.fin)) perdida = true;
    }
    if (perdida){
      pr.estado = "falla";
    } else if (lista){
      if (pr.n + 1 < pr.retos.length){
        armaReto(pr, pr.n + 1, paso);              // el siguiente, con su lectura
        ev.push({ tipo: "retoOk" });
        return;
      }
      pr.estado = "ok";
    } else return;
    e.pruebas.push(pr.estado);
    e.calma = CALMA_TRAS_PRUEBA;
    ev.push({ tipo: "pruebaFin", estado: pr.estado });
  }

  return { VERSION, W, H, SUELO, DT, ANCHO, CARGA, FURIA, PULSO_X, PRUEBA, GIRO,
           crea, avanza, simula, seno, iniciaPrueba, activa };
});
