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

  const VERSION = 1;          // súbelo si cambia la física: invalida partidas viejas

  /* ── el mundo ─────────────────────────────────────────────── */
  const W = 300, H = 110, SUELO = H - 4;
  const DT       = 1 / 120;
  const G        = 560;       // gravedad
  const LATIDO   = -165;      // velocidad hacia arriba al latir
  const ANCHO    = 14;        // ancho de una válvula
  const PULSO_X  = 72;
  const ESPACIO  = 96;        // separación entre válvulas
  const CARGA    = .45;       // aviso antes de cada disparo del gusano
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
    };
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

    if (latio) p.vy = LATIDO;
    p.vy += G * dt;
    p.y += p.vy * dt;
    e.fondoX += e.velocidad * dt;

    const ultima = e.valvulas[e.valvulas.length - 1];
    if (!e.furia && (!ultima || ultima.x < W - ESPACIO)) nuevaValvula(e);

    for (const v of e.valvulas){
      v.x -= e.velocidad * dt;
      if (v.mueve) v.centro = v.base + seno(e.t * 1.7 + v.fase) * 9;
      if (!v.pasada && v.x + ANCHO < p.x - 3){
        v.pasada = true;
        e.puntos++;
        e.velocidad = Math.min(105, 62 + e.puntos * 2);
        ev.push({ tipo: "punto" });
        if (e.puntos % FURIA.cada === 0){
          e.furia = { t: 0, hechos: 0, centro: p.y };
          e.gusano.carga = 0;
          ev.push({ tipo: "furia" });
        }
      }
    }
    e.valvulas = e.valvulas.filter(v => v.x > -ANCHO - 4);

    mueveGusano(e, dt);
    if (e.furia) avanzaFuria(e, dt, ev); else disparaGusano(e, dt, ev);

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
    return ev;
  }

  /* ── volver a jugar una partida ───────────────────────────────
     latidos: los números de paso en que el jugador latió, en orden.
     Es lo que hace el servidor para contar los puntos él mismo. */
  function simula(semilla, latidos, tope){
    const e = crea(semilla);
    let i = 0;
    while (e.vivo && e.paso < tope){
      const siguiente = e.paso + 1;
      let latio = false;
      while (i < latidos.length && latidos[i] === siguiente){ latio = true; i++; }
      avanza(e, latio);
    }
    return { puntos: e.puntos, pasos: e.paso, vivo: e.vivo, motivo: e.motivo };
  }

  return { VERSION, W, H, SUELO, DT, ANCHO, CARGA, FURIA, PULSO_X,
           crea, avanza, simula, seno };
});
