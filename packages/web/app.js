"use strict";

/* Estela — dashboard local.
   Sin framework ni paso de compilación: es una página que lee tu propia
   base de datos a través del daemon en 127.0.0.1. */

const $ = (sel) => document.querySelector(sel);

const state = {
  view: "summary",
  date: localToday(),
  day: null,
  summary: null,
  period: "month",
  open: new Set(),
};

// ── Formato ────────────────────────────────────────────────────────────
// Las funciones puras viven en lib.js para poder probarlas sin navegador.

const KINDS = [
  ["development", "Desarrollo"], ["meeting", "Reunión"], ["research", "Investigación"],
  ["review", "Revisión"], ["travel", "Desplazamiento"], ["support", "Soporte"],
  ["other", "Otro"],
];

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

// ── Red ────────────────────────────────────────────────────────────────

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json();
  if (!res.ok) {
    // El cuerpo entero viaja con el error, no solo el mensaje: quien llama a
    // veces necesita distinguir un tipo de fallo de otro (por ejemplo,
    // "falta vincular cuenta" de "cuota agotada"), y con solo el texto no
    // hay forma fiable de hacerlo sin analizar frases.
    const error = new Error(body.error || `Error ${res.status}`);
    error.body = body;
    throw error;
  }
  return body;
}

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), 2600);
}

// ── Mi día ─────────────────────────────────────────────────────────────

async function loadDay() {
  state.day = await api(`/api/day?date=${state.date}`);
  renderDay();
}

function renderDay() {
  const day = state.day;
  const today = localToday();

  $("#day-title").textContent = fmtDayTitle(state.date);
  $("#go-today").hidden = state.date === today;
  $("#next-day").disabled = state.date >= today;

  const hasEntries = day.entries.length > 0;
  $("#hero").hidden = !hasEntries;

  if (hasEntries) {
    $("#day-hours").textContent = fmtDuration(day.totalSeconds);
    $("#day-blocks").textContent =
      day.entries.length === 1 ? "en 1 bloque" : `en ${day.entries.length} bloques`;

    // Con varias monedas se enseñan todas. Decir "sin tarifa" cuando las hay
    // manda a revisar una configuración que está bien.
    const totals = day.totals || [];
    const money = totals.length
      ? totals.map((t) => fmtMoney(t.amountMinor, t.currency)).join(" + ")
      : null;

    $("#day-amount").textContent = money || "—";
    $("#day-amount").parentElement.querySelector(".hero-label").textContent =
      totals.length > 1 ? "por facturar (por moneda)"
      : totals.length === 1 ? "por facturar"
      : day.missingRate ? "sin tarifa definida"
      : "sin trabajo facturable";
  } else {
    // Vaciar aunque esté oculto: una cifra vieja esperando en el DOM es un
    // número equivocado a la espera de que algo la muestre por accidente.
    $("#day-hours").textContent = "—";
    $("#day-amount").textContent = "—";
  }

  $("#day-body").innerHTML =
    (hasEntries ? renderRows(day.entries) : renderEmpty()) + renderAddForm(day);
  wireRows();
  wireAddForm();

  const pending = day.pendingApproval;
  $("#approve-bar").hidden = !hasEntries || pending === 0;
  if (pending > 0) {
    $("#approve-text").textContent = pending === 1
      ? "Queda 1 bloque por revisar — llévame a él"
      : `Quedan ${pending} bloques por revisar — llévame al primero`;
  }
}

function renderEmpty() {
  const today = localToday();
  if (state.date === today) {
    return `<div class="empty">
      <h2>Todavía nada por aquí</h2>
      <p>En cuanto trabajes con un agente en un repositorio configurado, aparecerá solo.
         Si ya trabajaste, trae lo de hoy:</p>
      <code>estela import</code>
    </div>`;
  }
  return `<div class="empty">
    <h2>Sin actividad este día</h2>
    <p>No hay ningún bloque de trabajo registrado.</p>
  </div>`;
}

function renderRows(entries) {
  return `<div class="rows">${entries.map(renderRow).join("")}</div>`;
}

function renderRow(entry) {
  const open = state.open.has(entry.id);
  const money = fmtMoney(entry.amountMinor, entry.currency);

  const classes = ["row"];
  if (open) classes.push("is-open");
  if (entry.approved) classes.push("is-approved");
  if (!entry.billable) classes.push("not-billable");
  if (entry.invoiced) classes.push("is-invoiced");

  const KIND_LABEL = Object.fromEntries(KINDS);
  const kindTag = entry.kind && entry.kind !== "development"
    ? `<span class="kindtag">${esc(KIND_LABEL[entry.kind] || entry.kind)}</span>` : "";

  const meta = [
    entry.projectName,
    entry.clientName,
    entry.source === "manual" ? "añadido a mano"
      : entry.source === "commit"
        ? `${fmtTime(entry.startedAt)}–${fmtTime(entry.endedAt)} · deducido de commits`
        : `${fmtTime(entry.startedAt)}–${fmtTime(entry.endedAt)}`,
  ].filter(Boolean).join(" · ");

  return `
<article class="${classes.join(" ")}" data-id="${esc(entry.id)}">
  <button type="button" class="row-head" data-toggle aria-expanded="${open}">
    <span class="check" aria-hidden="true">✓</span>
    <span class="row-text">
      <span class="row-title">${kindTag}${esc(entry.description)}</span>
      <span class="row-meta">${esc(meta)}</span>
    </span>
    <span class="row-figs">
      <span class="row-time">${fmtDuration(entry.seconds)}</span>
      <span class="row-money ${money ? "" : "none"}">${money || (entry.billable ? "sin tarifa" : "no facturable")}</span>
    </span>
    <span class="chev" aria-hidden="true">›</span>
  </button>
  ${open ? renderRowBody(entry) : ""}
</article>`;
}

function renderRowBody(entry) {
  const projects = (state.day.projects || [])
    .map((p) => `<option value="${esc(p.id)}"${p.id === entry.projectId ? " selected" : ""}>${esc(p.name)}</option>`)
    .join("");

  const commits = entry.commits.length
    ? `<div class="commits">${entry.commits.map((c) =>
        `<div class="commit"><code>${esc(c.hash)}</code><span>${esc(c.subject)}</span></div>`).join("")}</div>`
    : "";

  const ai = entry.aiMicroUsd > 0
    ? `<p class="detail-line">Consumo de IA: <b>$${(entry.aiMicroUsd / 1e6).toFixed(2)}</b> en tarifa API equivalente.</p>`
    : "";

  if (entry.invoiced) {
    return `<div class="row-body">
      <p class="detail-line">Este bloque ya está facturado, así que no se puede editar.</p>
      ${commits}${ai}
    </div>`;
  }

  return `
<div class="row-body">
  <div class="field">
    <label for="d-${esc(entry.id)}">Qué hiciste</label>
    <input id="d-${esc(entry.id)}" type="text" value="${esc(entry.description)}" data-field="description">
  </div>
  <div class="field-pair">
    <div class="field">
      <label for="p-${esc(entry.id)}">Proyecto</label>
      <select id="p-${esc(entry.id)}" data-field="projectId">${projects}</select>
    </div>
    <div class="field">
      <label for="m-${esc(entry.id)}">Minutos</label>
      <input id="m-${esc(entry.id)}" type="number" min="0" step="1"
             value="${Math.round(entry.seconds / 60)}" data-field="minutes">
    </div>
  </div>
  ${commits}${ai}
  <div class="row-actions">
    <button type="button" class="chip ${entry.billable ? "is-on" : ""}" data-billable>
      ${entry.billable ? "Facturable" : "No facturable"}
    </button>
  </div>
</div>`;
}

/* Registro de horas que no dejan rastro en Git.
   Sin esto el parte del día miente por omisión: enseña solo lo que tocó el
   repositorio y hace parecer que las reuniones y los viajes no ocurrieron. */

function renderAddForm(day) {
  if (!day.projects.length) return "";

  const projects = day.projects
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  const kinds = KINDS
    .map(([v, l]) => `<option value="${v}">${l}</option>`).join("");

  return `
<div class="addwrap">
  <button type="button" class="add-toggle" id="add-toggle">+ Añadir horas sin código</button>
  <form class="addform" id="add-form" hidden>
    <p class="addform-hint">Desarrollo sin agente, reuniones, desplazamientos, investigación.
      Un import nunca las toca.</p>
    <div class="addrow">
      <label class="field">
        <span>Tipo</span>
        <select id="add-kind">${kinds}</select>
      </label>
      <label class="field">
        <span>Minutos</span>
        <input id="add-minutes" type="number" min="5" step="5" value="60" required>
      </label>
    </div>
    <label class="field">
      <span>Qué hiciste</span>
      <input id="add-what" type="text" placeholder="Seguimiento semanal con el cliente">
    </label>
    <label class="field">
      <span>Proyecto</span>
      <select id="add-project">${projects}</select>
    </label>
    <div class="addactions">
      <button type="button" class="chip" id="add-cancel">Cancelar</button>
      <button type="submit" class="btn-main">Añadir</button>
    </div>
  </form>
</div>`;
}

function wireAddForm() {
  const toggle = $("#add-toggle");
  if (!toggle) return;
  const form = $("#add-form");

  const open = (yes) => {
    form.hidden = !yes;
    toggle.hidden = yes;
    if (yes) $("#add-what").focus();
  };

  toggle.addEventListener("click", () => open(true));
  $("#add-cancel").addEventListener("click", () => open(false));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/entry", {
        method: "POST",
        body: JSON.stringify({
          projectId: $("#add-project").value,
          minutes: Number($("#add-minutes").value),
          kind: $("#add-kind").value,
          description: $("#add-what").value,
          date: state.date,
        }),
      });
      await loadDay();
      toast("Horas añadidas");
    } catch (error) {
      toast(error.message);
    }
  });
}

function wireRows() {
  document.querySelectorAll(".row").forEach((row) => {
    const id = row.dataset.id;

    row.querySelector("[data-toggle]").addEventListener("click", () => {
      if (state.open.has(id)) state.open.delete(id);
      else state.open.add(id);
      renderDay();
    });

    row.querySelectorAll("[data-field]").forEach((input) => {
      input.addEventListener("change", async () => {
        const field = input.dataset.field;
        const patch = field === "minutes"
          ? { seconds: Math.max(0, Math.round(Number(input.value) * 60)) }
          : { [field]: input.value };
        await save(id, patch);
      });
    });

    const billableBtn = row.querySelector("[data-billable]");
    if (billableBtn) {
      billableBtn.addEventListener("click", async () => {
        const entry = state.day.entries.find((e) => e.id === id);
        await save(id, { billable: !entry.billable });
      });
    }
  });
}

async function save(id, patch) {
  try {
    await api(`/api/entry/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await loadDay();
    toast("Guardado");
  } catch (error) {
    toast(error.message);
  }
}

// ── Resumen: todos los proyectos a la vez ──────────────────────────────

async function loadSummary() {
  const { from, to } = periodRange(state.period === "all" ? "quarter" : state.period);
  state.summary = await api(`/api/summary?from=${from}&to=${to}`);
  renderSummary();
}

function renderSummary() {
  const s = state.summary;
  $("#summary-range").textContent =
    `${s.activeProjects} proyecto${s.activeProjects === 1 ? "" : "s"} con actividad · ` +
    `${s.activeDays} día${s.activeDays === 1 ? "" : "s"} trabajados`;

  // Con varias monedas se enseñan todas: un guion parecería que falta un dato.
  const money = (s.totals || []).length
    ? s.totals.map((t) => fmtMoney(t.amountMinor, t.currency)).join(" + ")
    : null;
  const moneyLabel = (s.totals || []).length > 1
    ? "valor del trabajo (por moneda)" : "valor del trabajo";

  $("#kpis").innerHTML = `
    ${kpi(fmtDuration(s.totalSeconds), "horas registradas")}
    ${kpi(money || "—", moneyLabel, "kpi-money")}
    ${s.billableSeconds !== s.totalSeconds
        ? kpi(fmtDuration(s.billableSeconds), "de ellas facturables", "kpi-quiet") : ""}
    ${kpi(String(s.pendingApproval), s.pendingApproval === 1 ? "bloque por revisar" : "bloques por revisar",
          s.pendingApproval > 0 ? "kpi-attention" : "")}
    ${kpi("$" + (s.aiMicroUsd / 1e6).toFixed(2), "consumo de IA", "kpi-quiet")}`;

  const parts = [];

  if (s.projects.length === 0) {
    parts.push(`<div class="empty">
      <h2>Sin actividad en este periodo</h2>
      <p>Prueba con un rango más amplio, o comprueba que tus repositorios estén
         asignados a un proyecto.</p>
      <code>estela status</code>
    </div>`);
  } else {
    if (s.pendingApproval > 0) {
      parts.push(`<div class="approve-all">
        <p>Hay <b>${s.pendingApproval}</b> bloques de trabajo <b>tuyo</b> sin revisar
           en este periodo. Al configurar un proyecto entra de golpe todo su
           histórico. Pulsa el aviso de cada proyecto para ir a ellos.</p>
        <button type="button" class="btn-main" id="approve-all">Aprobar el periodo</button>
      </div>`);
    }
    parts.push(renderSparkline(s.byDay));
    parts.push(`<h2 class="block-title">Proyectos</h2>`);
    parts.push(`<div class="plist">${s.projects.map(renderProjectRow).join("")}</div>`);
  }

  if (s.activity.length) {
    parts.push(`<h2 class="block-title">Actividad reciente</h2>`);
    parts.push(`<div class="feed">${s.activity.map(renderActivity).join("")}</div>`);
  }

  $("#summary-body").innerHTML = parts.join("");

  $("#approve-all")?.addEventListener("click", async () => {
    const { from, to } = periodRange(state.period === "all" ? "quarter" : state.period);
    try {
      const r = await api("/api/approve-range", {
        method: "POST", body: JSON.stringify({ from, to }),
      });
      await loadSummary();
      toast(`${r.approved} bloques aprobados`);
    } catch (error) { toast(error.message); }
  });

  // "N por revisar" lleva al día más reciente que los tiene. Se van visitando
  // de más nuevo a más viejo: cada vez que apruebas los de un día, el mismo
  // aviso te lleva al siguiente que queda.
  document.querySelectorAll("[data-pending]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const r = await api(`/api/pending-days?project=${encodeURIComponent(btn.dataset.pending)}`);
        if (!r.days.length) { toast("Ya no queda nada por revisar ahí"); return; }
        state.date = r.days[0].date;
        showView("day");
        const otros = r.days.length - 1;
        toast(otros > 0
          ? `${r.days[0].blocks} por revisar aquí · ${otros} ${otros === 1 ? "día más" : "días más"} con pendientes`
          : `${r.days[0].blocks} por revisar — es el último día pendiente`);
      } catch (error) { toast(error.message); }
    });
  });
}

function kpi(value, label, extra = "") {
  return `<div class="kpi ${extra}">
    <div class="kpi-value">${esc(value)}</div>
    <div class="kpi-label">${esc(label)}</div>
  </div>`;
}

/* Barras por día. Da el pulso del periodo de un vistazo: dónde hubo trabajo y
   dónde no, que es lo primero que mira quien lleva varios proyectos. */
function renderSparkline(byDay) {
  if (byDay.length < 2) return "";
  const max = Math.max(...byDay.map((d) => d.seconds));
  const bars = byDay.map((d) => {
    const pct = Math.max(4, Math.round((d.seconds / max) * 100));
    const label = `${d.date}: ${fmtDuration(d.seconds)}`;
    return `<div class="bar" style="height:${pct}%" title="${esc(label)}"></div>`;
  }).join("");
  return `<div class="chart"><div class="chart-bars">${bars}</div>
    <div class="chart-axis"><span>${esc(byDay[0].date.slice(5))}</span>
    <span>${esc(byDay[byDay.length - 1].date.slice(5))}</span></div></div>`;
}

/**
 * Las formas de hacer llegar el panel, y a quién ya se lo hiciste llegar.
 *
 * Copiar el enlace no basta: el correo es lo que deja constancia y lo que le
 * mete el panel en su cuenta de Estela, y WhatsApp es por donde de verdad se
 * mandan estas cosas. Se ofrecen las tres, y debajo quién lo tiene.
 */
function renderCompartir(projectId, pub) {
  const url = (pub.baseUrl || "https://getestela.dev") + "/e/" + pub.token + "/";
  const texto = encodeURIComponent("Te comparto el avance del proyecto: " + url);
  const clientes = state.panelClients?.[pub.token] || [];

  return `
<div class="share-ways" data-token="${esc(pub.token)}" data-url="${esc(url)}">
  <div class="share-row">
    <button type="button" class="chip" data-copy-url>Copiar enlace</button>
    <a class="chip" href="https://wa.me/?text=${texto}" target="_blank" rel="noopener">WhatsApp</a>
    <a class="chip" href="mailto:?subject=${encodeURIComponent("Avance del proyecto")}&body=${texto}">Correo</a>
  </div>
  <label class="share-label" for="cl-${esc(projectId)}">
    O dáselo por su correo y se lo mandamos nosotros — además le aparece en su cuenta
  </label>
  <div class="share-row">
    <input id="cl-${esc(projectId)}" class="share-mails" type="text"
           placeholder="cliente@empresa.com, otro@empresa.com"
           value="${esc(clientes.map((c) => c.email).join(", "))}">
    <button type="button" class="chip" data-save-clients>Guardar</button>
  </div>
  ${clientes.length ? `<ul class="share-who">${clientes.map((c) =>
    `<li>${esc(c.email)} — ${c.entrado
      ? "<b>ya tiene cuenta</b>, lo ve al entrar"
      : "aún no ha entrado en getestela.dev/app"}</li>`).join("")}</ul>` : ""}
  <div class="share-msg"></div>
</div>`;
}

function renderProjectRow(p) {
  const amount = fmtMoney(p.amountMinor, p.currency);
  // En nómina no se enseña tarifa: no existe, y un hueco invita a rellenarlo.
  const rate = p.kind === "client" ? fmtMoney(p.hourlyMinor, p.currency) : null;
  // Decir "7 por revisar" sin dar forma de llegar hasta ellos obliga a ir día
  // por día a ciegas. El aviso es el propio camino.
  const flag = p.pendingApproval > 0
    ? `<button type="button" class="tag tag-warn tag-go" data-pending="${esc(p.projectId)}"
        title="Ir al día más reciente con bloques sin revisar">${p.pendingApproval} por revisar →</button>` : "";
  const KIND_TAG = { employment: "nómina", internal: "interno" };
  const notBillable = KIND_TAG[p.kind] ? `<span class="tag">${KIND_TAG[p.kind]}</span>` : "";

  return `
<div class="prow">
  <div class="prow-text">
    <div class="prow-name">${esc(p.projectName)} ${flag}${notBillable}</div>
    <div class="prow-meta">${esc(p.clientName)}${rate ? ` · ${rate}/h` : ""} ·
      ${p.days} día${p.days === 1 ? "" : "s"} · última vez ${esc(p.lastDay)}</div>
  </div>
  <div class="prow-figs">
    <div class="prow-hours">${fmtDuration(p.seconds)}</div>
    <div class="prow-amount">${amount || "—"}</div>
  </div>
</div>`;
}

function renderActivity(c) {
  const when = new Date(c.at).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  return `
<div class="act">
  <code>${esc(c.hash)}</code>
  <span class="act-subject">${esc(c.subject)}</span>
  <span class="act-repo">${esc(c.repo)}</span>
  <span class="act-diff">+${c.linesAdded} −${c.linesDeleted}</span>
  <span class="act-when">${esc(when)}</span>
</div>`;
}

// ── Equipo ─────────────────────────────────────────────────────────────

/* Lo que arregla la dispersión del Resumen: ningún número va solo. Cada KPI
   lleva dentro su comparación, su denominador o su unidad, porque "138h" no
   dice nada y "138h, 11 más que el mes pasado" sí.

   Y la regla que gobierna la tabla de personas: esta pantalla responde "dónde
   está el trabajo y dónde está el riesgo", nunca "quién rinde más". Por eso se
   ordena por actividad reciente y no por horas, y por eso cada fila dice si sus
   horas están medidas o estimadas. */

const TEAM_ROWS = 8;

state.teamPeriod = "quarter";
state.teamAll = false;
state.teamProject = "";

async function loadTeam() {
  const { from, to } = periodRange(state.teamPeriod);
  state.team = await api(
    `/api/team?from=${from}&to=${to}` +
    (state.teamProject ? `&project=${encodeURIComponent(state.teamProject)}` : ""));
  renderTeam();
}

function renderTeam() {
  const t = state.team;
  const people = t.people.length;

  $("#team-sub").textContent =
    `${people} persona${people === 1 ? "" : "s"} · ` +
    `${t.activeDays} día${t.activeDays === 1 ? "" : "s"} con actividad`;

  fillProjectFilter(t.projects);
  $("#team-alerts").innerHTML = renderAlerts(t);
  $("#team-kpis").innerHTML = renderTeamKpis(t);

  const parts = [];
  if (t.projects.length) {
    parts.push(`<h2 class="block-title">Por proyecto</h2>`);
    parts.push(`<div class="tbl-wrap"><table class="tbl">
      <thead><tr>
        <th>Proyecto</th><th class="th-comp">Composición</th>
        <th class="num">Horas</th><th class="num">Coste IA</th>
        <th class="num">Valor</th><th>Estado</th>
      </tr></thead>
      <tbody>${t.projects.map(teamProjectRow).join("")}</tbody></table></div>`);
    parts.push(`<p class="legend">
      <span class="sw sw-agent"></span> medido con agente
      <span class="sw sw-commit"></span> estimado de commits
      <span class="sw sw-manual"></span> anotado a mano</p>`);
  }

  if (people) {
    // Sin proyecto elegido se mezclan las plantillas de todos tus clientes y la
    // tabla se va a treinta filas, que es volver a la dispersión que esto venía
    // a arreglar. Se enseñan las más recientes y se dice cuántas faltan.
    const shown = state.teamAll ? t.people : t.people.slice(0, TEAM_ROWS);
    const hidden = t.people.length - shown.length;

    // Las cifras de arriba y esta tabla NO suman lo mismo, y hay que decirlo:
    // los totales son tu trabajo imputado, y aquí hay horas estimadas de gente
    // que no usa Estela. Sin esta nota, el primer lector atento encuentra que
    // los números no cuadran y deja de creerse toda la pantalla.
    parts.push(`<h2 class="block-title">Personas
      <span class="block-note">por actividad reciente</span></h2>`);
    parts.push(`<p class="note-inline">Las horas de tus compañeros se estiman
      desde sus commits y <b>no entran</b> en los totales de arriba, que cuentan
      solo tu trabajo imputado. Si alguien instala Estela, su fila pasa a
      medida.</p>`);
    parts.push(`<div class="tbl-wrap"><table class="tbl">
      <thead><tr>
        <th>Persona</th><th class="num">Horas</th><th>Precisión</th>
        <th>Ramas</th><th class="num">Última vez</th>
      </tr></thead>
      <tbody>${shown.map(personRow).join("")}</tbody></table></div>`);

    if (hidden > 0) {
      parts.push(`<button type="button" class="more" id="team-more">
        Ver ${hidden} persona${hidden === 1 ? "" : "s"} más</button>`);
    } else if (state.teamAll && t.people.length > TEAM_ROWS) {
      parts.push(`<button type="button" class="more" id="team-more">Ver menos</button>`);
    }
  }

  if (!t.projects.length && !people) {
    parts.push(`<div class="empty"><h2>Sin actividad en este periodo</h2>
      <p>Prueba con un rango más amplio.</p></div>`);
  }

  $("#team-body").innerHTML = parts.join("");

  $("#team-more")?.addEventListener("click", () => {
    state.teamAll = !state.teamAll;
    renderTeam();
  });
}

/* Avisos accionables, no decorativos: cada uno dice qué pasa y qué hacer. */
function renderAlerts(t) {
  const out = [];

  for (const p of t.projects) {
    if (p.budgetPct !== null && p.budgetPct >= 80) {
      const over = p.budgetPct >= 100;
      out.push(alertBox(over ? "danger" : "warn",
        `${p.projectName} ha ${over ? "superado" : "consumido el " + p.budgetPct + "% de"} su presupuesto de IA`,
        `$${(p.aiMicroUsd / 1e6).toFixed(2)} de $${(p.budgetMicroUsd / 1e6).toFixed(2)} en este periodo.`));
    }
  }

  const stale = t.openWork.filter((w) => w.ageDays >= 14);
  if (stale.length) {
    out.push(alertBox("warn",
      `${stale.length} rama${stale.length === 1 ? "" : "s"} sin integrar desde hace más de dos semanas`,
      `La más antigua, ${stale[0].name}, lleva ${stale[0].ageDays} días. ` +
      `Puede ser trabajo parado o una revisión pendiente en el otro lado.`));
  }

  if (t.pendingApproval > 0) {
    out.push(alertBox("info", `${t.pendingApproval} bloques sin revisar`,
      "Hasta revisarlos no deberían salir en un informe."));
  }
  return out.join("");
}

function alertBox(kind, title, detail) {
  return `<div class="alert alert-${kind}">
    <div class="alert-t">${esc(title)}</div>
    <div class="alert-d">${esc(detail)}</div>
  </div>`;
}

function renderTeamKpis(t) {
  const hours = fmtDuration(t.totalSeconds);
  const delta = t.totalSeconds - t.previousSeconds;
  const deltaTxt = t.previousSeconds > 0
    ? `${delta >= 0 ? "+" : "−"}${fmtDuration(Math.abs(delta))} frente al periodo anterior`
    : "sin periodo anterior con el que comparar";

  const ai = t.aiMicroUsd / 1e6;
  const perHour = t.totalSeconds > 0 ? (ai / (t.totalSeconds / 3600)) : 0;

  const pct = t.totalSeconds > 0
    ? Math.round((t.billableSeconds / t.totalSeconds) * 100) : 0;

  const open = t.openWork.length;
  const oldest = open ? t.openWork[0] : null;

  return [
    teamKpi(hours, "horas del periodo", deltaTxt, delta >= 0 ? "up" : "down"),
    teamKpi("$" + ai.toFixed(2), "coste de IA",
            `$${perHour.toFixed(2)} por hora trabajada`),
    teamKpi(pct + "%", "facturable",
            `${fmtDuration(t.billableSeconds)} de ${hours}`),
    teamKpi(String(open), open === 1 ? "rama sin integrar" : "ramas sin integrar",
            oldest ? `la más antigua, ${oldest.ageDays} días` : "todo integrado",
            open > 0 ? "warn" : ""),
  ].join("");
}

function teamKpi(value, label, context, tone = "") {
  return `<div class="kpi kpi-ctx ${tone ? "kpi-" + tone : ""}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${esc(value)}</div>
    <div class="kpi-ctx-line">${esc(context)}</div>
  </div>`;
}

/* La barra de composición dice de qué está hecha la cifra de horas: cuánto se
   midió con un agente y cuánto se estimó desde los commits. Sin esto, 182h
   medidas y 182h estimadas se ven igual, y no valen lo mismo. */
function compositionBar(c) {
  const total = c.agent + c.commit + c.manual;
  if (!total) return "";
  const seg = (n, cls) => n > 0
    ? `<span class="seg ${cls}" style="width:${(n / total) * 100}%"></span>` : "";
  const title = `agente ${fmtDuration(c.agent)} · commits ${fmtDuration(c.commit)} · a mano ${fmtDuration(c.manual)}`;
  return `<div class="comp" title="${esc(title)}">
    ${seg(c.agent, "sw-agent")}${seg(c.commit, "sw-commit")}${seg(c.manual, "sw-manual")}
  </div>`;
}

function teamProjectRow(p) {
  const STATE = {
    employment: ["nómina", "tag"],
    internal: ["interno", "tag"],
  };
  const st = STATE[p.kind] ??
    (p.pendingApproval > 0 ? ["por revisar", "tag tag-warn"] : ["listo", "tag tag-ok"]);

  return `<tr>
    <td><div class="td-name">${esc(p.projectName)}</div>
        <div class="td-sub">${esc(p.clientName)}</div></td>
    <td class="th-comp">${compositionBar(p.composition)}</td>
    <td class="num">${fmtDuration(p.seconds)}</td>
    <td class="num money-ai">$${(p.aiMicroUsd / 1e6).toFixed(2)}</td>
    <td class="num">${p.amountMinor !== null ? fmtMoney(p.amountMinor, p.currency) : "—"}</td>
    <td><span class="${st[1]}">${esc(st[0])}</span></td>
  </tr>`;
}

function personRow(p) {
  const branches = p.branches.length
    ? p.branches.slice(0, 2).map((b) => `<code class="br">${esc(b)}</code>`).join(" ") +
      (p.branches.length > 2 ? ` <span class="td-sub">+${p.branches.length - 2}</span>` : "")
    : `<span class="td-sub">—</span>`;

  return `<tr>
    <td><div class="td-name">${esc(p.name)}${p.isMe ? ' <span class="tag">tú</span>' : ""}</div>
        <div class="td-sub">${esc(p.emails[0] || "")}</div></td>
    <td class="num">${fmtDuration(p.seconds)}</td>
    <td><span class="prec ${p.measured ? "prec-ok" : ""}">${p.measured ? "medido" : "estimado"}</span></td>
    <td>${branches}</td>
    <td class="num td-sub">${esc(p.lastDay || "—")}</td>
  </tr>`;
}

function fillProjectFilter(projects) {
  const sel = $("#team-project");
  if (sel.dataset.filled === String(projects.length) && sel.value === state.teamProject) return;
  const seen = state.team.projects.map((p) => [p.projectId, p.projectName]);
  sel.innerHTML = `<option value="">Todos los proyectos</option>` +
    seen.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join("");
  sel.value = state.teamProject;
  sel.dataset.filled = String(projects.length);
}

$("#team-project").addEventListener("change", (e) => {
  state.teamProject = e.target.value;
  state.teamAll = false;
  loadTeam();
});

document.querySelectorAll("[data-tperiod]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.teamPeriod = btn.dataset.tperiod;
    document.querySelectorAll("[data-tperiod]").forEach(
      (b) => b.classList.toggle("is-on", b === btn));
    loadTeam();
  });
});

// ── Proyectos ──────────────────────────────────────────────────────────

/** Con quién está compartido cada panel. Sin cuenta vinculada, vacío y ya. */
async function loadPanelClients() {
  try {
    const r = await api("/api/panel-clients");
    state.panelClients = Object.fromEntries((r.panels || []).map((p) => [p.token, p.clients || []]));
  } catch { state.panelClients = {}; }
}

async function loadProjects() {
  await loadPanelClients();
  const [data, orphans] = await Promise.all([
    api("/api/projects"),
    api("/api/unassigned"),
  ]);
  state.projects = data;
  renderProjects(data, orphans.repos);
}

function renderProjects(data, orphans) {
  const parts = [];
  const pubs = new Map((data.publications || []).map((p) => [p.projectId, p]));

  // Lo que envejece un panel no son los días: es que haya trabajo nuevo desde
  // que se publicó. Uno de hace una semana está al día si no tocaste el
  // proyecto en esa semana.
  const atrasados = (data.publications || []).filter((p) => p.staleBlocks > 0);
  if (atrasados.length) {
    parts.push(`<div class="stale">
      <p><b>${atrasados.length === 1 ? "Un panel compartido está" : atrasados.length + " paneles están"}
         desactualizado${atrasados.length === 1 ? "" : "s"}.</b>
         Tu cliente está viendo datos anteriores a tu último trabajo. Esto no
         tiene que ver con los bloques por revisar: aquí solo salen los
         proyectos que has compartido, y cuenta lo que cambió desde que lo
         publicaste, no lo que te falta por aprobar.</p>
      <ul>${atrasados.map((p) => {
        const nombre = (data.projects.find((x) => x.id === p.projectId) || {}).name || p.projectId;
        return `<li>${esc(nombre)} — ${p.staleBlocks}
          ${p.staleBlocks === 1 ? "bloque nuevo" : "bloques nuevos"}
          desde que lo publicaste ${p.daysAgo === 0 ? "hoy" :
            p.daysAgo === 1 ? "ayer" : "hace " + p.daysAgo + " días"}</li>`;
      }).join("")}</ul>
      <p class="stale-fix">Pulsa <b>Compartir con el cliente</b> en cada uno y vuelve a subirlo.</p>
    </div>`);
  }

  for (const p of data.projects) {
    // En nómina no se enseña tarifa: no existe, y un hueco invita a rellenarlo.
  const rate = p.kind === "client" ? fmtMoney(p.hourlyMinor, p.currency) : null;
    const history = p.rateHistory.length > 1
      ? `<div class="rate-hist">${p.rateHistory.map((r) =>
          `<span>${esc(fmtMoney(r.minor, r.currency))}/h desde ${esc(r.from)}</span>`).join("")}</div>`
      : "";

    parts.push(`
<div class="pcard" data-project="${esc(p.id)}">
  <div class="pcard-head">
    <div>
      <div class="pcard-name">${esc(p.name)}</div>
      <div class="pcard-meta">${esc(p.clientName)} · ${fmtDuration(p.seconds)} en ${p.blocks} bloques</div>
    </div>
    <div class="pcard-rate">
      <div class="pcard-rate-v">${rate ? esc(rate) + "/h" : "sin tarifa"}</div>
    </div>
  </div>
  ${p.repoPaths.length
    ? `<div class="repos">${p.repoPaths.map((r) => `<code>${esc(r)}</code>`).join("")}</div>`
    : `<div class="pcard-warn">
         <p>Sin repositorio: no se le imputa nada todavía.</p>
         ${orphans.length
           ? `<div class="row-inline">
                <select class="repo-pick" data-project="${esc(p.id)}">
                  ${orphans.slice(0, 40).map((r) =>
                    `<option value="${esc(r.path)}">${esc(r.name)} — ${esc(r.turns)} turnos, hasta ${esc(r.lastAt)}</option>`).join("")}
                </select>
                <button type="button" class="chip repo-link" data-project="${esc(p.id)}">Vincular</button>
              </div>`
           : `<p class="addform-hint">No hemos detectado ningún repositorio sin asignar.
                Trabaja un rato con tu agente y vuelve, o vincúlalo con
                <code>estela team repo --project ${esc(p.id)} --add &lt;ruta&gt;</code>.</p>`}
       </div>`}
  ${history}
  <div class="share-block">
    <button type="button" class="chip share-btn${pubs.get(p.id) && pubs.get(p.id).staleBlocks > 0 ? " is-stale" : ""}">
      ${pubs.has(p.id) ? "Actualizar lo compartido" : "Compartir con el cliente"}
    </button>
    <span class="share-hint">${
      !pubs.has(p.id) ? "Genera un panel de solo lectura con enlace no adivinable."
      : pubs.get(p.id).staleBlocks > 0
        ? `<b class="stale-mark">${pubs.get(p.id).staleBlocks} bloques nuevos</b> desde que lo publicaste.`
        : `Publicado ${
            pubs.get(p.id).daysAgo === 0 ? "hoy" :
            pubs.get(p.id).daysAgo === 1 ? "ayer" :
            "hace " + pubs.get(p.id).daysAgo + " días"} · al día.`
    }</span>
    <div class="share-out" hidden></div>
    ${pubs.has(p.id) ? renderCompartir(p.id, pubs.get(p.id)) : ""}
  </div>
  <form class="rateform">
    <span>Cambiar tarifa a</span>
    <input type="number" class="rate-new" min="0" step="0.5"
           value="${p.hourlyMinor ? (p.hourlyMinor / 100) : ""}" placeholder="45">
    <span>${esc(p.currency)}/h desde</span>
    <input type="date" class="rate-from" value="${localToday()}">
    <button type="submit" class="chip">Guardar</button>
  </form>
</div>`);
  }

  if (!data.projects.length) {
    parts.push(`<div class="empty"><h2>Todavía no hay proyectos</h2>
      <p>Crea el primero abajo y asígnale el repositorio donde trabajas.</p></div>`);
  }

  // Repos con trabajo capturado que no pertenecen a nadie. Es la lista más
  // útil de la pantalla: son horas que ya tienes pero no puedes facturar.
  // Se presentan como tarjetas y no como un desplegable porque rellenar un
  // formulario por repositorio, con cuarenta pendientes, no lo hace nadie.
  const orphanCards = orphans.slice(0, 12).map((r) => `
    <button type="button" class="orphan" data-path="${esc(r.path)}" data-name="${esc(r.name)}">
      <span class="orphan-name">${esc(r.name)}</span>
      <span class="orphan-meta">${r.turns} turnos · hasta ${esc(r.lastAt)}</span>
    </button>`).join("");

  const orphanOptions = orphans.slice(0, 40)
    .map((r) => `<option value="${esc(r.path)}">${esc(r.name)} — ${r.turns} turnos, hasta ${esc(r.lastAt)}</option>`)
    .join("");

  const clientOptions = data.clients
    .map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.currency)})</option>`).join("");

  parts.push(`
<h2 class="block-title">Nuevo proyecto</h2>
<form class="newproject" id="new-project">
  ${orphans.length ? `<p class="addform-hint">Tienes ${orphans.length} repositorios con trabajo
     capturado y sin proyecto. Son horas que ya registraste pero todavía no puedes informar.
     Pulsa uno para empezar:</p>
     <div class="orphans">${orphanCards}</div>` : ""}
  <label class="field">
    <span>Repositorio</span>
    <select id="np-repo">
      <option value="">— elegir uno de los detectados —</option>
      ${orphanOptions}
    </select>
  </label>
  <div class="addrow">
    <label class="field"><span>Nombre del proyecto</span>
      <input id="np-name" type="text" placeholder="App de Acme" required></label>
    <label class="field"><span>Tarifa por hora</span>
      <input id="np-rate" type="number" min="0" step="0.5" placeholder="45"></label>
  </div>
  <div class="addrow">
    <label class="field"><span>Cliente existente</span>
      <select id="np-client"><option value="">— cliente nuevo —</option>${clientOptions}</select></label>
    <label class="field"><span>…o cliente nuevo</span>
      <input id="np-clientname" type="text" placeholder="Acme S.L."></label>
    <label class="field np-cur"><span>Moneda</span>
      <select id="np-currency">
        <option>EUR</option><option>USD</option><option>GBP</option>
        <option>MXN</option><option>COP</option><option>BRL</option>
      </select></label>
  </div>
  <div class="addactions"><button type="submit" class="btn-main">Crear proyecto</button></div>
</form>
<p class="note">Tras crear el proyecto, ejecuta <code>estela import</code> para que el
   trabajo ya capturado de ese repositorio se impute.</p>`);

  $("#projects-body").innerHTML = parts.join("");
  wireProjects();
}

/**
 * Pregunta con qué correo commiteas, listando los autores reales del repo.
 * Adivinarlo por la configuración de git captura los commits de otro, o ninguno.
 */
async function askAuthor(projectId, repoPath) {
  const { authors } = await api(`/api/authors?repo=${encodeURIComponent(repoPath)}`);
  if (!authors.length) return;

  const card = document.querySelector(`.pcard[data-project="${CSS.escape(projectId)}"]`);
  if (!card) return;

  const box = document.createElement("div");
  box.className = "authorbox";
  box.innerHTML =
    `<p class="addform-hint">¿Con cuál de estos correos commiteas tú en este repositorio?
      Si eliges mal, se capturarán los commits de otra persona.</p>` +
    authors.slice(0, 8).map((a) =>
      `<button type="button" class="chip author-pick" data-email="${esc(a.email)}">
        ${esc(a.email)} <span class="author-n">${a.commits}</span>
      </button>`).join("");
  card.appendChild(box);
  box.scrollIntoView({ behavior: "smooth", block: "center" });

  box.querySelectorAll(".author-pick").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/authors", {
        method: "POST",
        body: JSON.stringify({ projectId, emails: btn.dataset.email }),
      });
      await loadProjects();
      toast("Identidad guardada — ejecuta estela import");
    });
  });
}

function wireProjects() {
  // El nombre del proyecto se rellena solo con el del repo elegido: teclear dos
  // veces lo mismo es la clase de fricción que hace que nadie configure nada.
  const repo = $("#np-repo");
  repo?.addEventListener("change", () => {
    const name = $("#np-name");
    if (repo.value && !name.value) {
      name.value = repo.selectedOptions[0].textContent.split(" — ")[0].trim();
    }
  });

  // Un clic en la tarjeta rellena el formulario y baja hasta él.
  document.querySelectorAll(".orphan").forEach((card) => {
    card.addEventListener("click", () => {
      $("#np-repo").value = card.dataset.path;
      $("#np-name").value = card.dataset.name.replace(/[-_]+/g, " ");
      document.querySelectorAll(".orphan").forEach((c) => c.classList.remove("is-on"));
      card.classList.add("is-on");
      $("#np-name").focus();
      $("#new-project").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  $("#new-project")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rate = Number($("#np-rate").value);
    try {
      const nuevo = await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: $("#np-name").value,
          repoPath: $("#np-repo").value,
          clientId: $("#np-client").value,
          clientName: $("#np-clientname").value,
          currency: $("#np-currency").value,
          hourlyMinor: rate > 0 ? Math.round(rate * 100) : undefined,
        }),
      });
      await loadProjects();
      toast("Proyecto creado");
      // El correo de commit es lo primero que hay que configurar: sin él se
      // capturan los commits equivocados, o casi ninguno.
      if ($("#np-repo").value) await askAuthor(nuevo.id, $("#np-repo").value);
    } catch (error) { toast(error.message); }
  });

  // Copiar el enlace, sin salir de aquí.
  // Vincular un repositorio ya detectado a un proyecto que existe. Es lo que
  // le faltaba a quien acepta una invitación: el proyecto queda creado pero
  // vacío, y la única salida era la terminal.
  document.querySelectorAll(".repo-link").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const projectId = btn.dataset.project;
      const sel = document.querySelector(`.repo-pick[data-project="${CSS.escape(projectId)}"]`);
      btn.disabled = true;
      try {
        const r = await api("/api/project-repo", {
          method: "POST",
          body: JSON.stringify({ projectId, repoPath: sel.value }),
        });
        toast(r.importing
          ? "Vinculado · importando, aparecerá en unos segundos"
          : (r.blocks ? `Vinculado · ${r.blocks} bloques imputados` : "Repositorio vinculado"));
        await loadProjects();
      } catch (error) { toast(error.message); btn.disabled = false; }
    });
  });

  document.querySelectorAll("[data-copy-url]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.closest(".share-ways").dataset.url;
      try { await navigator.clipboard.writeText(url); toast("Enlace copiado"); }
      catch {
        const ta = document.createElement("textarea");
        ta.value = url; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); toast("Enlace copiado"); }
        catch { toast("No se pudo copiar"); }
        document.body.removeChild(ta);
      }
    });
  });

  // Dar el correo del cliente: se lo mandamos nosotros y le queda en su cuenta.
  document.querySelectorAll("[data-save-clients]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const caja = btn.closest(".share-ways");
      const msg = caja.querySelector(".share-msg");
      const clients = caja.querySelector(".share-mails").value
        .split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
      btn.disabled = true;
      msg.textContent = "";
      try {
        await api("/api/panel-clients", {
          method: "POST",
          body: JSON.stringify({ token: caja.dataset.token, clients }),
        });
        toast(clients.length ? "Compartido — le llega un correo" : "Ya no se comparte con nadie");
        await loadProjects();
      } catch (error) {
        msg.textContent = error.body?.needsLogin
          ? "Hace falta vincular una cuenta: estela login --email tu@correo.com"
          : error.message;
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll(".share-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest(".pcard");
      const projectId = card.dataset.project;
      const out = card.querySelector(".share-out");
      btn.disabled = true;
      try {
        // El token ya vive en la base de datos local (una fila por proyecto,
        // se lee de state.projects.publications): guardarlo también en
        // localStorage sería una segunda copia que puede desincronizarse de
        // la real, y lo hizo — un token de una prueba vieja en el navegador
        // pisó el que de verdad estaba publicado.
        const known = state.projects?.publications?.find((p) => p.projectId === projectId);
        const r = await api("/api/publish", {
          method: "POST",
          body: JSON.stringify({ projectId, token: known?.token || "" }),
        });

        out.hidden = false;
        out.innerHTML =
          '<p class="share-line"><b>' + (r.adopted ? "Panel vinculado" : "Panel publicado") +
          '</b></p>' +
          '<p class="share-line">Enlace: <code>' + esc(r.url) + '</code></p>' +
          '<p class="share-warn">Quien tenga el enlace, entra: no hay contraseña.</p>';
        toast(r.adopted ? "Vinculado a tu cuenta" : "Panel publicado");

        // Publicar pone a cero los "bloques nuevos desde que lo publicaste",
        // pero ese número vive en `state`, que se quedaba con el valor de
        // antes: el aviso seguía ahí después de resolverlo, y solo se iba
        // recargando la página a mano. Se vuelve a pedir el estado y se
        // repinta, conservando el mensaje del enlace recién generado.
        const recien = out.innerHTML;
        await loadProjects();
        const card2 = document.querySelector(`.pcard[data-project="${CSS.escape(projectId)}"]`);
        const out3 = card2?.querySelector(".share-out");
        if (out3) { out3.hidden = false; out3.innerHTML = recien; }
      } catch (error) {
        const out2 = card.querySelector(".share-out");
        // "Sin cuenta" no es un error cualquiera: se enseña con el comando
        // exacto para resolverlo, no como un aviso genérico que hay que
        // interpretar. `needsLogin` viaja en el cuerpo desde /api/publish.
        if (error.body?.needsLogin) {
          out2.hidden = false;
          out2.innerHTML =
            '<p class="share-line"><b>Hace falta vincular una cuenta</b></p>' +
            '<p class="share-line">Publicar aloja el panel en getestela.dev, y eso exige sesión:</p>' +
            '<code class="cmd">estela login --email tu@correo.com</code>' +
            '<p class="share-warn">Se ejecuta una vez, en la terminal. Luego vuelve a pulsar aquí.</p>';
        } else {
          toast(error.message);
        }
      } finally { btn.disabled = false; }
    });
  });

  document.querySelectorAll(".rateform").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const projectId = form.closest(".pcard").dataset.project;
      const value = Number(form.querySelector(".rate-new").value);
      if (!(value > 0)) { toast("Escribe una tarifa"); return; }
      try {
        await api("/api/rate", {
          method: "POST",
          body: JSON.stringify({
            projectId,
            hourlyMinor: Math.round(value * 100),
            from: form.querySelector(".rate-from").value,
          }),
        });
        await loadProjects();
        toast("Tarifa guardada — lo ya trabajado conserva la anterior");
      } catch (error) { toast(error.message); }
    });
  });
}

// ── Informes ───────────────────────────────────────────────────────────

/* Plegado por defecto: fecha y botón de descarga solo aparecen al pulsar el
   proyecto, igual que un bloque de Mi día. Con muchos proyectos, la lista
   entera desplegada era una columna larga sin forma de encontrar nada. */
const REPORT_ROWS = 5;
state.reportsQuery = "";
state.reportsAll = false;
state.reportsOpen = new Set();

async function loadReports() {
  // Mismo periodo que Resumen: si las dos pantallas contestan a la misma
  // pregunta, tienen que dar el mismo número.
  const { from, to } = periodRange(state.period);
  state.reportsOverview = await api(`/api/overview?from=${from}&to=${to}`);
  renderReports();
}

function renderReports() {
  const overview = state.reportsOverview;
  const parts = [];

  parts.push(`<div class="filters" id="rep-periods">
    <button type="button" class="period${state.period === "week" ? " is-on" : ""}" data-period="week">Esta semana</button>
    <button type="button" class="period${state.period === "month" ? " is-on" : ""}" data-period="month">Este mes</button>
    <button type="button" class="period${state.period === "quarter" ? " is-on" : ""}" data-period="quarter">3 meses</button>
    <button type="button" class="period${state.period === "all" ? " is-on" : ""}" data-period="all">Todo lo pendiente</button>
  </div>`);

  const fuera = overview.outsideRange;
  if (fuera && fuera.blocks > 0) {
    parts.push(`<p class="note">Hay además <b>${fmtDuration(fuera.seconds)}</b> pendientes
      fuera de este periodo, en ${fuera.blocks} bloques. Pulsa
      <b>Todo lo pendiente</b> para incluirlos.</p>`);
  }

  if (overview.warning) parts.push(`<div class="warn">${esc(overview.warning)}</div>`);

  if (overview.unbilled.length === 0) {
    parts.push(`<div class="empty">
      <h2>Nada que informar todavía</h2>
      <p>Aquí aparecerán los proyectos con horas aprobadas y sin informar.</p>
      <code>estela status</code>
    </div>`);
  } else {
    // Filtra en el propio navegador: ya se tiene la lista entera cargada, y
    // un buscador que hiciera una petición por letra tecleada sería más lento
    // que no tenerlo.
    const q = state.reportsQuery.trim().toLowerCase();
    const matches = !q ? overview.unbilled : overview.unbilled.filter((row) =>
      row.projectName.toLowerCase().includes(q) || row.clientName.toLowerCase().includes(q));

    if (overview.unbilled.length > REPORT_ROWS || q) {
      parts.push(`<input type="search" class="search" id="rep-search"
        placeholder="Buscar proyecto o cliente…" value="${esc(state.reportsQuery)}">`);
    }

    if (q && matches.length === 0) {
      parts.push(`<p class="note">Ningún proyecto coincide con «${esc(state.reportsQuery)}».</p>`);
    }

    const shown = state.reportsAll ? matches : matches.slice(0, REPORT_ROWS);

    for (const row of shown) {
      const amount = fmtMoney(row.amountMinor, row.currency);
      const open = state.reportsOpen.has(row.projectId);
      parts.push(`
<div class="report${open ? " is-open" : ""}">
  <button type="button" class="report-head" data-toggle-report="${esc(row.projectId)}" aria-expanded="${open}">
    <div class="report-text">
      <div class="report-name">${esc(row.projectName)}</div>
      <div class="report-client">${esc(row.clientName)} · ${row.blocks} bloques ·
        todo lo pendiente desde ${esc(row.firstDay)}</div>
    </div>
    <div class="report-figs">
      <div class="report-hours">${fmtDuration(row.seconds)}</div>
      <div class="report-amount">${amount || "—"}</div>
    </div>
    <span class="chev">›</span>
  </button>
  ${open ? `
  <form class="report-actions" data-project="${esc(row.projectId)}">
    <label class="field"><span>Desde</span>
      <input type="date" class="rep-from" value="${esc(row.firstDay)}"></label>
    <label class="field"><span>Hasta</span>
      <input type="date" class="rep-to" value="${localToday()}"></label>
    <label class="field"><span>Tu nombre</span>
      <input type="text" class="rep-author" placeholder="Jonathan León"></label>
    <label class="checkline"><input type="checkbox" class="rep-amounts">
      <span>Incluir importes</span></label>
    <button type="submit" class="btn-main">Descargar informe</button>
  </form>` : ""}
</div>`);
    }

    if (!state.reportsAll && matches.length > REPORT_ROWS) {
      parts.push(`<button type="button" class="more" id="reports-more">
        Ver ${matches.length - REPORT_ROWS} proyecto${matches.length - REPORT_ROWS === 1 ? "" : "s"} más</button>`);
    } else if (state.reportsAll && matches.length > REPORT_ROWS) {
      parts.push(`<button type="button" class="more" id="reports-more">Ver menos</button>`);
    }

    parts.push(`<p class="note">El informe recoge horas y commits. No es una factura:
      Estela no emite documentos fiscales, adjunta este respaldo a la tuya.</p>`);
  }

  $("#reports-body").innerHTML = parts.join("");

  document.querySelectorAll("#rep-periods .period").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.period = btn.dataset.period; state.reportsAll = false; loadReports();
    });
  });

  const search = $("#rep-search");
  search?.addEventListener("input", () => {
    state.reportsQuery = search.value;
    state.reportsAll = false;
    renderReports();
    // renderReports() reconstruye el input entero: sin esto, el foco salta
    // fuera de la caja de búsqueda con cada letra que se escribe.
    const again = $("#rep-search");
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  });

  $("#reports-more")?.addEventListener("click", () => {
    state.reportsAll = !state.reportsAll;
    renderReports();
  });

  document.querySelectorAll("[data-toggle-report]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.toggleReport;
      if (state.reportsOpen.has(id)) state.reportsOpen.delete(id);
      else state.reportsOpen.add(id);
      renderReports();
    });
  });

  document.querySelectorAll(".report-actions").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = new URLSearchParams({
        project: form.dataset.project,
        from: form.querySelector(".rep-from").value,
        to: form.querySelector(".rep-to").value,
        author: form.querySelector(".rep-author").value,
        amounts: form.querySelector(".rep-amounts").checked ? "1" : "0",
      });
      // El servidor lo devuelve con Content-Disposition, así que el navegador
      // lo descarga en vez de abrirlo.
      window.location.href = `/api/report?${q}`;
      toast("Informe descargado");
    });
  });
}

// ── Navegación ─────────────────────────────────────────────────────────

function moveDay(days) {
  state.date = shiftDay(state.date, days);
  state.open.clear();
  loadDay();
}

/**
 * Sincronizar sin terminal. El botón solo aparece si hay algo que sincronizar
 * — enseñárselo a quien no ha activado ningún proyecto es ofrecer un botón
 * que no puede hacer nada.
 */
async function wireSync() {
  const btn = document.getElementById("sync-now");
  try {
    const data = await api("/api/projects");
    const hay = (data.publications || []).length > 0 || (data.projects || []).some((p) => p.syncScope);
    btn.hidden = !hay;
  } catch { btn.hidden = true; }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const antes = btn.textContent;
    btn.textContent = "Sincronizando…";
    try {
      const r = await api("/api/sync", { method: "POST" });
      const bien = r.projects.filter((p) => p.ok).length;
      const mal = r.projects.filter((p) => !p.ok);
      toast(mal.length
        ? `${bien} sincronizados · ${mal[0].projectId}: ${mal[0].detalle}`
        : (bien ? `${bien} ${bien === 1 ? "proyecto sincronizado" : "proyectos sincronizados"}`
                : "No hay proyectos con sync activado"));
      if (state.view === "projects") await loadProjects();
    } catch (error) {
      toast(error.body?.needsLogin
        ? "Hace falta vincular una cuenta: estela login --email tu@correo.com"
        : error.message);
    }
    btn.textContent = antes;
    btn.disabled = false;
  });
}

function showView(name) {
  state.view = name;
  document.querySelector("main").classList.toggle("wide", name === "team");
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-on", t.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-on", v.id === `view-${name}`));
  if (name === "summary") loadSummary();
  if (name === "day") loadDay();
  if (name === "team") loadTeam();
  if (name === "reports") loadReports();
  if (name === "projects") loadProjects();
}

document.querySelectorAll(".period").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.period = btn.dataset.period;
    document.querySelectorAll(".period").forEach((b) => b.classList.toggle("is-on", b === btn));
    loadSummary();
  });
});

$("#prev-day").addEventListener("click", () => moveDay(-1));
$("#next-day").addEventListener("click", () => moveDay(1));
$("#go-today").addEventListener("click", () => {
  state.date = localToday();
  state.open.clear();
  loadDay();
});

/* "Queda 1 bloque por revisar" sin decir cuál obliga a buscarlo a ojo. El
   aviso es el propio botón que te lleva hasta él y lo resalta. */
$("#approve-text").addEventListener("click", () => {
  const first = state.day?.entries.find((e) => !e.approved && !e.invoiced);
  if (!first) return;

  if (!state.open.has(first.id)) {
    state.open.add(first.id);
    renderDay();
  }

  const row = document.querySelector(`.row[data-id="${CSS.escape(first.id)}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("is-target");
  setTimeout(() => row.classList.remove("is-target"), 1600);
});

$("#approve-btn").addEventListener("click", async () => {
  try {
    const { approved } = await api("/api/approve-day", {
      method: "POST",
      body: JSON.stringify({ date: state.date }),
    });
    await loadDay();
    toast(approved === 1 ? "1 bloque aprobado" : `${approved} bloques aprobados`);
  } catch (error) {
    toast(error.message);
  }
});

/* ── Mantenerse al día ──────────────────────────────────────────────────

   El servidor reimporta cada cinco minutos, pero la pestaña abierta no se
   entera: se cargaba una vez y ya. Commiteabas, mirabas Mi día y no estaba,
   sin saber si el problema era el sistema o tu commit.

   Tres piezas, por orden de importancia:

    - Volver a la pestaña actualiza. Es el momento natural: vienes del editor
      de hacer el commit. No hay que acordarse de nada.
    - El botón fuerza un import. Acabas de commitear y lo quieres AHORA, no
      dentro de cinco minutos.
    - Si el import falla, se dice. Estuvo nueve horas fallando en silencio y
      la web enseñaba datos viejos como si fueran buenos: en una herramienta
      de tiempo, ese es el peor fallo posible.  */

function reloadView() {
  if (state.view === "summary") return loadSummary();
  if (state.view === "day") return loadDay();
  if (state.view === "team") return loadTeam();
  if (state.view === "reports") return loadReports();
  if (state.view === "projects") return loadProjects();
}

function showSync(status) {
  const warn = $("#sync-warn");
  if (status && status.ok === false) {
    warn.textContent = "No se pudo actualizar";
    warn.title = status.error || "";
    warn.hidden = false;
  } else {
    warn.hidden = true;
  }
}

let syncing = false;

async function sync({ force }) {
  if (syncing) return;
  syncing = true;
  const btn = $("#sync");
  const label = $("#sync-label");
  btn.classList.add("is-busy");
  label.textContent = "Buscando…";
  try {
    // force = el botón: pide un import nuevo. Sin force solo se consulta cómo
    // fue el último, que es lo que basta al volver a la pestaña.
    const status = force
      ? await api("/api/import", { method: "POST" })
      : await api("/api/import-status");
    showSync(status);
    await reloadView();
  } catch (error) {
    showSync({ ok: false, error: String(error) });
  } finally {
    btn.classList.remove("is-busy");
    label.textContent = "Actualizar";
    syncing = false;
  }
}

$("#sync").addEventListener("click", () => sync({ force: true }));

/* Al volver a la pestaña. Con margen: alternar entre ventanas mientras
   trabajas no debe disparar un import en cada cambio. */
let leftAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { leftAt = Date.now(); return; }
  if (Date.now() - leftAt > 30_000) sync({ force: true });
});

document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey && !e.altKey &&
      !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) {
    e.preventDefault();
    sync({ force: true });
  }
});

// Al abrir: saber si el último import fue bien, sin forzar uno.
api("/api/import-status").then(showSync).catch(() => {});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea")) return;
  if (e.key === "ArrowLeft") moveDay(-1);
  if (e.key === "ArrowRight" && !$("#next-day").disabled) moveDay(1);
});

// ── Upgrade y banner de ofertas ───────────────────────────────────────

async function loadAccountUpgrade() {
  try {
    const account = await api("/api/account");
    $("#upgrade-wrap").hidden = account.plan === "pro" || account.plan === "teams";
  } catch {
    // Si no se puede saber el plan, mejor no ofrecer un botón que no va a
    // completar la compra.
    $("#upgrade-wrap").hidden = true;
  }
}

$("#upgrade-btn").addEventListener("click", () => {
  $("#upgrade-menu").hidden = !$("#upgrade-menu").hidden;
});

// Mensual/anual: un solo estado, leído por el toggle y por el botón de
// compra — no hay servidor de por medio aquí, es puro estado de la vista.
let cicloElegido = "monthly";
document.querySelectorAll(".upgrade-ciclo button").forEach((btn) => {
  btn.addEventListener("click", () => {
    cicloElegido = btn.dataset.ciclo;
    document.querySelectorAll(".upgrade-ciclo button").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.ciclo === cicloElegido);
    });
    document.querySelectorAll(".upgrade-option").forEach((opt) => {
      opt.querySelector("span").textContent = opt.dataset[cicloElegido];
    });
  });
});

document.querySelectorAll(".upgrade-option").forEach((btn) => {
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const { url } = await api("/api/billing/checkout", {
        method: "POST", body: JSON.stringify({ plan: btn.dataset.plan, interval: cicloElegido }),
      });
      window.open(url, "_blank", "noopener");
      $("#upgrade-menu").hidden = true;
    } catch (error) {
      // needsLogin viaja en el cuerpo desde /api/billing/checkout, mismo
      // criterio que ya usa /api/publish para distinguir "hace falta
      // vincular cuenta" de un error genérico.
      toast(error.body?.needsLogin
        ? "Vincula tu cuenta primero: estela login --email tu@correo.com"
        : error.message);
    } finally {
      btn.disabled = false;
    }
  });
});

async function loadBanner() {
  try {
    const banner = await api("/api/banner");
    if (!banner.enabled || !banner.text) return;
    // Recordado por texto, no por un id: si el admin cambia el mensaje,
    // vuelve a aparecer aunque el anterior ya se hubiera cerrado.
    if (localStorage.getItem("estela.bannerDismissed") === banner.text) return;

    $("#banner-text").textContent = banner.text;
    const link = $("#banner-link");
    if (banner.link) { link.href = banner.link; link.hidden = false; } else { link.hidden = true; }
    $("#banner-promo").hidden = false;
  } catch {
    // Sin conexión, o getestela.dev caído: el banner simplemente no sale.
  }
}

$("#banner-close").addEventListener("click", () => {
  localStorage.setItem("estela.bannerDismissed", $("#banner-text").textContent);
  $("#banner-promo").hidden = true;
});

// ── Arranque ───────────────────────────────────────────────────────────

/* Arranca en el resumen: la primera pregunta al abrir es "¿cómo va todo?",
   no "¿qué hice hoy?". El día concreto está a un clic. */
(async function boot() {
  loadAccountUpgrade();
  loadBanner();
  wireSync();
  await loadSummary();

  /* Si hoy no tiene actividad, "Mi día" apunta al último día con trabajo:
     abrir una pantalla en blanco no dice nada. */
  const overview = await api("/api/overview");
  if (overview.days.length > 0) {
    const today = localToday();
    const hasToday = overview.days.some((d) => d.date === today);
    if (!hasToday) state.date = overview.days[0].date;
  }
})();
