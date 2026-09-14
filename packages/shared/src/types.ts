import type { AiCost, Currency, Money } from "./money.js";

// ---------------------------------------------------------------------------
// Captura: lo que leemos de las herramientas
// ---------------------------------------------------------------------------

/** Agentes de los que sabemos leer. */
export type AgentKind = "claude-code" | "codex" | "cursor" | "gemini-cli";

/**
 * Un turno de agente ya normalizado.
 *
 * Es la frontera con el formato externo: por encima de este tipo nadie sabe que
 * existe un `.jsonl`, ni un `cache_creation_input_tokens`. Cuando Anthropic
 * cambie su formato, cambia el adaptador y nada más.
 */
export interface AgentTurn {
  readonly agent: AgentKind;
  /** Identidad del turno en el origen. Es la clave de deduplicación. */
  readonly turnId: string;
  readonly sessionId: string;
  readonly at: Date;
  readonly model: string;
  /** Ruta del proyecto donde ocurrió (`cwd` en el transcript). */
  readonly repoPath: string | null;
  readonly branch: string | null;
  readonly tokens: TokenUsage;
  /** Versión de la herramienta que escribió el registro. Para diagnóstico de deriva. */
  readonly producerVersion: string | null;
}

/**
 * Uso de tokens. Los cuatro campos son obligatorios porque los cuatro cuestan
 * dinero: en sesiones reales la caché representa la mayoría del gasto, y
 * omitirla no infravalora un poco el coste, lo infravalora varias veces.
 */
export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  /** Escritura de caché con TTL de 5 minutos (multiplicador 1.25x). */
  readonly cacheWrite5m: number;
  /** Escritura de caché con TTL de 1 hora (multiplicador 2x). */
  readonly cacheWrite1h: number;
}

export const EMPTY_USAGE: TokenUsage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0,
};

/** Un commit leído de git. Nunca lo escribimos nosotros: solo observamos. */
export interface CommitRecord {
  readonly repoPath: string;
  readonly hash: string;
  readonly at: Date;
  readonly authorEmail: string;
  /**
   * Nombre del autor tal y como lo escribe git.
   *
   * Hace falta porque una misma persona commitea con varios correos — en un
   * repositorio de cliente, Nerea aparecía con @estudio.es y con @contrata.com.
   * Sin
   * el nombre, la vista de equipo lo cuenta dos veces y deja de ser creíble.
   */
  readonly authorName: string;
  readonly branch: string | null;
  readonly subject: string;
  readonly linesAdded: number;
  readonly linesDeleted: number;
  /** Ficheros tocados. Habilita medir reescritura. */
  readonly files: readonly string[];
}

// ---------------------------------------------------------------------------
// Diagnóstico de deriva de formato
// ---------------------------------------------------------------------------

/**
 * Resultado de leer una fuente externa.
 *
 * `unknownRecords` es el canario: si un día se dispara, el formato cambió y hay
 * que avisar en la interfaz. Un número de facturación nunca debe degradarse en
 * silencio.
 */
export interface ParseReport {
  readonly filesRead: number;
  readonly recordsSeen: number;
  readonly turnsAccepted: number;
  /** Turnos descartados por ser repetición de un `turnId` ya visto. */
  readonly duplicatesDropped: number;
  /** Registros cuyo `type` no reconocemos. Esperado y benigno mientras sea estable. */
  readonly unknownRecords: number;
  /** Registros que sí deberíamos entender pero venían malformados. Esto sí es alarma. */
  readonly malformedRecords: number;
  readonly producerVersions: readonly string[];
  readonly warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Facturación
// ---------------------------------------------------------------------------

/**
 * Cómo se paga la IA. Cambia por completo qué significa el número.
 *
 *  - "api"          : pagas por token. El coste calculado es tu gasto exacto.
 *  - "subscription" : pagas una cuota fija. Lo calculado por token es solo una
 *                     señal de consumo; el gasto real es la cuota, repartida
 *                     entre proyectos en proporción a lo que consumió cada uno.
 */
export type AiCostBasis = "api" | "subscription";

/**
 * Quién paga la IA. Determina quién puede verla.
 *
 * No es un permiso configurable, es una consecuencia. Si la pagas tú, el gasto
 * es tuyo y nadie más tiene por qué verlo: un cliente que descubre qué parte
 * del trabajo generó una IA tiene un argumento nuevo para negociar tu tarifa, y
 * eso no es evidencia de tu trabajo. Si la paga la empresa para su equipo, es su
 * dinero y le corresponde verlo.
 *
 * Al seguir al dinero en vez de a una casilla, la regla no se puede activar por
 * error ni por presión de un cliente.
 *
 * ## Tres consecuencias para la vista de equipo
 *
 * **1. Nunca por persona, siempre por proyecto.** La pregunta que una empresa
 * puede responder es "cuánto nos cuesta este proyecto en IA"; "cuánto gasta
 * Ana" no lo es. Un coste por persona es una divulgación del gasto de alguien y
 * un proxy para juzgarle: quien más consume puede estar en el código más
 * difícil, no siendo peor. Mismo error que ordenar a la gente por horas.
 *
 * **2. El agregado excluye a quien se la paga él, o se despeja restando.** Si
 * el total del proyecto incluyera al colaborador externo, el cliente conoce lo
 * que paga de los suyos y obtiene el del externo con una resta. El agregado
 * protege tan poco como el detalle si mezcla pagadores.
 *
 * **3. Se declara, nunca se detecta.** El demonio lee los transcripts: ve el
 * modelo y los tokens, jamás de quién es la tarjeta. Inferir que la empresa
 * paga porque alguien está en su espacio de trabajo expondría el gasto personal
 * de quien lleva su propia suscripción. Por eso el valor por defecto es `self`:
 * equivocarse hacia ahí no revela nada de nadie.
 */
export type AiPayer = "self" | "organization";

/** Una suscripción de precio fijo (Claude Max, Cursor, ChatGPT Plus...). */
export interface Subscription {
  readonly id: string;
  readonly name: string;
  readonly monthlyFee: Money;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

/**
 * Reparto de una cuota fija entre proyectos, para un mes concreto.
 *
 * Es un valor **derivado**, nunca almacenado en la imputación: si mañana
 * importas más trabajo de ese mismo mes, el reparto cambia. Se congela solo al
 * emitir una factura.
 */
export interface AmortizedShare {
  readonly projectId: string;
  /** Mes al que corresponde, en formato YYYY-MM. */
  readonly month: string;
  /** Consumo del proyecto en tarifa API equivalente. */
  readonly consumption: AiCost;
  /** Consumo de todos los proyectos ese mes. El denominador del reparto. */
  readonly monthTotal: AiCost;
  /** Fracción de la cuota que le toca a este proyecto. */
  readonly share: number;
  /** Parte de la cuota imputable al proyecto. Esto sí es dinero real. */
  readonly amount: Money;
}

export interface Client {
  readonly id: string;
  readonly name: string;
  /** Moneda en la que se le factura a este cliente. */
  readonly currency: Currency;
  readonly taxId?: string;
  readonly email?: string;
  readonly address?: string;
}

/**
 * Un proyecto: la unidad que se pacta con un cliente.
 *
 * La tarifa vive aquí y no en el cliente porque el mismo cliente puede pactar
 * precios distintos por proyecto, y porque una tarifa cambia con el tiempo sin
 * que deban recalcularse las facturas ya emitidas (ver `RatePeriod`).
 */
/**
 * Qué relación tienes con el trabajo de un proyecto.
 *
 * No es lo mismo un cliente sin tarifa que un empleo: en el primero falta un
 * dato, en el segundo el dato no existe. Confundirlos hace que el panel enseñe
 * un "valor del trabajo" que nadie te va a pagar, y una cifra falsa delante de
 * un cliente vale menos que ninguna.
 *
 *  - "client"     : le facturas por horas. Tiene tarifa y va en los informes.
 *  - "employment" : trabajo por nómina. Se mide el tiempo y el consumo de IA,
 *                   pero no hay importe ni informe que mandar.
 *  - "internal"   : cosas tuyas. Ni importe ni informe.
 */
export type ProjectKind = "client" | "employment" | "internal";

export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = {
  client: "Cliente",
  employment: "Nómina",
  internal: "Interno",
};

export interface Project {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  /** Rutas locales de repositorio que pertenecen a este proyecto. */
  readonly repoPaths: readonly string[];
  readonly billable: boolean;
  /** Bloque mínimo de facturación en minutos. 0 = al segundo exacto. */
  readonly roundingMinutes: number;
  /**
   * Cómo se trata el coste de IA frente al cliente:
   *  - "absorbed"     : lo asumes tú. La factura no lo menciona. (Por defecto.)
   *  - "passthrough"  : se repercute como línea aparte, convertido a la moneda
   *                     del cliente con el tipo de cambio del día de emisión.
   */
  readonly aiCostPolicy: "absorbed" | "passthrough";
  readonly kind: ProjectKind;
}

/**
 * Una tarifa con vigencia. Subir el precio a mitad de proyecto no puede
 * reescribir lo ya trabajado, así que las tarifas se apilan por fecha en vez de
 * sobrescribirse.
 */
export interface RatePeriod {
  readonly projectId: string;
  readonly hourlyRate: Money;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

/**
 * De dónde salió una imputación.
 *
 * Importa porque reimportar rehace lo deducido de los agentes, y no puede
 * llevarse por delante lo que escribiste a mano.
 */
/**
 * De donde salio una entrada de tiempo.
 *
 *  - `agent`:  deducida de los turnos de un agente. La mas precisa.
 *  - `commit`: deducida solo de los commits, para trabajo hecho sin agente. El
 *              tiempo anterior al primer commit de cada tanda es una estimacion,
 *              asi que es menos fiable y conviene que se distinga.
 *  - `manual`: la escribiste tu. Un import nunca la toca.
 */
export type EntrySource = "agent" | "commit" | "manual";

export const ENTRY_SOURCE_LABELS: Record<EntrySource, string> = {
  agent: "con agente", commit: "deducido de commits", manual: "anadido a mano",
};

/**
 * Tipo de trabajo.
 *
 * Un proyecto no son solo commits. Las reuniones, los viajes, la investigación
 * y los spikes son horas reales que se facturan igual, y sin poder registrarlas
 * el parte del día miente por defecto: enseña solo la parte que dejó rastro en
 * Git y hace parecer que el resto no ocurrió.
 */
export type WorkKind =
  | "development"   // deducido de los agentes y de git
  | "meeting"       // reuniones, dailies, seguimiento con cliente
  | "research"      // investigación, documentación, spikes
  | "review"        // revisión de código de otros
  | "travel"        // desplazamientos
  | "support"       // incidencias, soporte
  | "other";

export const WORK_KIND_LABELS: Record<WorkKind, string> = {
  development: "Desarrollo",
  meeting: "Reunión",
  research: "Investigación",
  review: "Revisión",
  travel: "Desplazamiento",
  support: "Soporte",
  other: "Otro",
};

/** Un bloque de trabajo imputado. Es lo que acaba en una línea de informe. */
export interface TimeEntry {
  readonly id: string;
  readonly projectId: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly seconds: number;
  readonly description: string;
  readonly billable: boolean;
  /** `null` mientras no se haya emitido factura. */
  readonly invoiceId: string | null;
  readonly aiCost: AiCost;
  readonly agentSeconds: number;
  readonly commitHashes: readonly string[];
  readonly agents: readonly AgentKind[];
  readonly source: EntrySource;
  readonly kind: WorkKind;
  /** Rama del trabajo. Permite agrupar el esfuerzo por funcionalidad. */
  readonly branch: string | null;
}

export interface InvoiceLine {
  readonly description: string;
  readonly seconds: number;
  readonly hourlyRate: Money;
  readonly amount: Money;
}

/**
 * Una factura emitida.
 *
 * Es un documento **inmutable**. Guarda su propio tipo de cambio y sus propias
 * tarifas: si mañana cambia el euro o subes el precio por hora, esta factura
 * debe seguir dando exactamente el mismo total.
 */
export interface Invoice {
  readonly id: string;
  readonly number: string;
  readonly clientId: string;
  readonly projectId: string;
  readonly issuedAt: Date;
  /** Fecha de corte: se incluye todo lo trabajado hasta aquí, inclusive. */
  readonly cutoffAt: Date;
  readonly periodStart: Date;
  readonly currency: Currency;
  readonly lines: readonly InvoiceLine[];
  readonly subtotal: Money;
  readonly total: Money;
  readonly totalSeconds: number;
  /** Coste de IA del periodo, en USD, siempre registrado aunque no se repercuta. */
  readonly aiCost: AiCost;
  /** Tipo de cambio USD -> moneda de la factura, capturado al emitir. */
  readonly usdFxRate: number | null;
  readonly aiCostBilled: Money | null;
  /**
   * Parte de la cuota de suscripción imputable a este periodo, congelada al
   * emitir.
   *
   * Sin congelarla, reimprimir un informe de agosto en diciembre daría otra
   * cifra: el reparto se recalcula con todo el consumo conocido, y en
   * diciembre se conoce más. Un documento que cambia solo no es un documento.
   */
  readonly aiAmortized: Money | null;
  readonly notes?: string;
}

// ---------------------------------------------------------------------------

/**
 * Tu propio plan, no el de un equipo al que te hayan invitado.
 *
 * `free` es 100% local, como siempre. `pro` sincroniza tu propio historial a
 * tu propia nube para tener el mismo dashboard en varias máquinas — sigue
 * siendo solo tuyo, nadie más lo ve.
 */
export type CloudPlan = "free" | "pro";

/**
 * Qué sale de esta máquina para un proyecto, y por qué.
 *
 *  - "personal": es tu cuenta Pro sincronizando tu propio trabajo.
 *  - "team"    : te invitaron a un proyecto de un equipo. Solo ESE proyecto
 *                sincroniza, nunca el resto de tu trabajo, aunque también
 *                seas Pro por tu cuenta.
 *
 * Un proyecto tiene un único alcance a la vez: nunca los dos scopes compiten
 * por la misma fila.
 */
export type ProjectSyncScope = "personal" | "team";

/**
 * Tu decisión sobre compartir tu uso de IA en un proyecto de equipo.
 *
 * Solo existe cuando quien invitó lo pidió explícitamente y tú eres empleado
 * de esa organización, nunca para un freelance (ver `InviteeKind`). Aceptar
 * el proyecto y conceder esto son decisiones separadas: puedes aceptar el
 * primero y declinar la segunda, y esa combinación es válida y se comunica
 * como tal, no como un dato que falta.
 */
export type AiConsentDecision = "pending" | "granted" | "declined";

/**
 * Cómo clasifica quien invita a la persona que invita a un proyecto.
 *
 * Cambia el trato posible, no es cosmético: un freelance nunca puede exponer
 * su consumo de IA a quien le paga la factura (`requestsAiVisibility` es
 * estructuralmente imposible para "freelancer"); un empleado de la propia
 * empresa sí puede, porque el gasto sale del bolsillo del empleador, no del
 * suyo — pero solo si además consiente (`AiConsentDecision`).
 */
export type InviteeKind = "freelancer" | "employee";

/** La cuenta cloud vinculada a esta máquina. Si no existe, todo es local. */
export interface CloudAccount {
  readonly accountId: string;
  readonly email: string;
  readonly plan: CloudPlan;
  readonly deviceToken: string;
  readonly apiBaseUrl: string;
  readonly linkedAt: Date;
}

/** Qué proyecto local corresponde a qué proyecto remoto, y bajo qué alcance. */
export interface ProjectSync {
  readonly projectId: string;
  readonly scope: ProjectSyncScope;
  readonly remoteProjectId: string;
  /** Solo cuando `scope` es "team". */
  readonly remoteOrgId: string | null;
  readonly inviteToken: string | null;
}

/** Tu consentimiento de IA para un proyecto de equipo concreto. */
export interface AiConsentRecord {
  readonly projectId: string;
  readonly requested: boolean;
  readonly decision: AiConsentDecision;
  readonly decidedAt: Date | null;
}
