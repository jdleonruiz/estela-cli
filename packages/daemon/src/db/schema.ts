import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Esquema local. Todo vive en `~/.estela/estela.db`, en el disco del usuario.
 *
 * Del agente se guardan solo metadatos: duración, modelo y tokens. Nunca el
 * contenido de los prompts ni del código. No hay ninguna columna donde quepan,
 * y eso es deliberado: la garantía tiene que ser estructural, no una promesa.
 */

export const DEFAULT_DB_PATH = join(homedir(), ".estela", "estela.db");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS clients (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  currency  TEXT NOT NULL,
  tax_id    TEXT,
  email     TEXT,
  address   TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  billable          INTEGER NOT NULL DEFAULT 1,
  rounding_minutes  INTEGER NOT NULL DEFAULT 0,
  ai_cost_policy    TEXT NOT NULL DEFAULT 'absorbed',
  -- client | employment | internal. Un empleo no es un cliente sin tarifa:
  -- ahí el importe no falta, es que no existe.
  kind              TEXT NOT NULL DEFAULT 'client',
  -- Presupuesto mensual de IA en micro-USD. NULL es "no vigilar", que no es lo
  -- mismo que un presupuesto de cero.
  ai_budget_micro_usd INTEGER
);

-- Con qué identidad commiteas en cada proyecto.
--
-- No se puede deducir de la configuración de git: en el repositorio de un
-- cliente sueles commitear con el correo que te dio el cliente, mientras que la
-- configuración global tiene el tuyo. Adivinarlo hace que se capturen 3 commits
-- de 1697, o peor, que se te imputen los de tus compañeros.
CREATE TABLE IF NOT EXISTS project_authors (
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_email  TEXT NOT NULL,
  PRIMARY KEY (project_id, author_email)
);

-- Un proyecto puede abarcar varios repositorios (monorepo, front + back).
CREATE TABLE IF NOT EXISTS project_repos (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_path   TEXT NOT NULL,
  PRIMARY KEY (project_id, repo_path)
);

-- Las tarifas se apilan por fecha en vez de sobrescribirse: subir el precio no
-- puede reescribir lo ya trabajado.
CREATE TABLE IF NOT EXISTS rate_periods (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hourly_minor    INTEGER NOT NULL,
  currency        TEXT NOT NULL,
  effective_from  TEXT NOT NULL,
  effective_to    TEXT
);
CREATE INDEX IF NOT EXISTS idx_rates_project ON rate_periods(project_id, effective_from);

-- Turnos de agente ya deduplicados. turn_id es PRIMARY KEY: la deduplicación
-- que hace el parser queda además garantizada por la base de datos.
CREATE TABLE IF NOT EXISTS agent_turns (
  turn_id           TEXT PRIMARY KEY,
  agent             TEXT NOT NULL,
  session_id        TEXT NOT NULL,
  at                TEXT NOT NULL,
  model             TEXT NOT NULL,
  repo_path         TEXT,
  branch            TEXT,
  tok_input         INTEGER NOT NULL DEFAULT 0,
  tok_output        INTEGER NOT NULL DEFAULT 0,
  tok_cache_read    INTEGER NOT NULL DEFAULT 0,
  tok_cache_w5m     INTEGER NOT NULL DEFAULT 0,
  tok_cache_w1h     INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd    INTEGER,
  producer_version  TEXT
);
CREATE INDEX IF NOT EXISTS idx_turns_at ON agent_turns(at);
CREATE INDEX IF NOT EXISTS idx_turns_repo ON agent_turns(repo_path, at);

CREATE TABLE IF NOT EXISTS commits (
  repo_path      TEXT NOT NULL,
  hash           TEXT NOT NULL,
  at             TEXT NOT NULL,
  author_email   TEXT NOT NULL,
  author_name    TEXT NOT NULL DEFAULT '',
  branch         TEXT,
  subject        TEXT NOT NULL,
  lines_added    INTEGER NOT NULL DEFAULT 0,
  lines_deleted  INTEGER NOT NULL DEFAULT 0,
  -- Ficheros tocados, separados por saltos de línea. Sin esto no se puede
  -- medir reescritura, que es la métrica que más respeto gana ante un líder
  -- técnico porque es diagnóstica y no autocomplaciente.
  files          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (repo_path, hash)
);
CREATE INDEX IF NOT EXISTS idx_commits_at ON commits(at);

CREATE TABLE IF NOT EXISTS time_entries (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  started_at      TEXT NOT NULL,
  -- Fecha local de quien trabaja, no la UTC. Sin esta columna, en UTC-5 todo
  -- lo trabajado después de las 19:00 caería en el día siguiente y partiría
  -- la jornada en dos.
  local_date      TEXT NOT NULL DEFAULT '',
  ended_at        TEXT NOT NULL,
  seconds         INTEGER NOT NULL,
  description     TEXT NOT NULL,
  billable        INTEGER NOT NULL DEFAULT 1,
  approved        INTEGER NOT NULL DEFAULT 0,
  invoice_id      TEXT REFERENCES invoices(id),
  ai_micro_usd    INTEGER NOT NULL DEFAULT 0,
  agent_seconds   INTEGER NOT NULL DEFAULT 0,
  commit_hashes   TEXT NOT NULL DEFAULT '',
  agents          TEXT NOT NULL DEFAULT '',
  -- 'agent' se rehace al reimportar; 'manual' nunca se toca.
  source          TEXT NOT NULL DEFAULT 'agent',
  kind            TEXT NOT NULL DEFAULT 'development',
  -- Rama en la que se hizo el trabajo. Un gestor piensa en funcionalidades,
  -- no en días: sin esta columna no se puede decir "18h en el informe de
  -- servicios", que es la frase que él entiende.
  branch          TEXT,
  -- Cuándo se escribió esta fila, no cuándo ocurrió el trabajo. Es lo que
  -- decide si un panel publicado se ha quedado atrás: lo que envejece es que
  -- los datos cambien, y una reunión anotada hoy lleva fecha de esta mañana.
  updated_at      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_entries_project ON time_entries(project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_entries_day ON time_entries(local_date);
CREATE INDEX IF NOT EXISTS idx_entries_invoice ON time_entries(invoice_id);

-- Documento inmutable: guarda su propio tipo de cambio y sus propios importes.
CREATE TABLE IF NOT EXISTS invoices (
  id               TEXT PRIMARY KEY,
  number           TEXT NOT NULL UNIQUE,
  client_id        TEXT NOT NULL REFERENCES clients(id),
  project_id       TEXT NOT NULL REFERENCES projects(id),
  issued_at        TEXT NOT NULL,
  cutoff_at        TEXT NOT NULL,
  period_start     TEXT NOT NULL,
  currency         TEXT NOT NULL,
  subtotal_minor   INTEGER NOT NULL,
  total_minor      INTEGER NOT NULL,
  total_seconds    INTEGER NOT NULL,
  ai_micro_usd     INTEGER NOT NULL DEFAULT 0,
  usd_fx_rate      REAL,
  ai_billed_minor  INTEGER,
  -- Cuota de IA imputada al periodo, congelada al emitir. Ver Invoice.aiAmortized.
  ai_amort_minor   INTEGER,
  ai_amort_cur     TEXT,
  notes            TEXT,
  lines_json       TEXT NOT NULL
);

-- Suscripciones de precio fijo. Con cuota fija, el gasto real no es la suma por
-- token: es esta cuota, repartida entre proyectos según lo que consumió cada uno.
CREATE TABLE IF NOT EXISTS subscriptions (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  fee_minor       INTEGER NOT NULL,
  currency        TEXT NOT NULL,
  effective_from  TEXT NOT NULL,
  effective_to    TEXT
);

-- Cuándo se publicó por última vez el panel de cada proyecto.
--
-- Sirve para saber si lo que ve el cliente sigue siendo cierto. Lo que importa
-- no son los días transcurridos: es que haya trabajo nuevo desde entonces. Un
-- panel de hace una semana está al día si esa semana no tocaste el proyecto.
CREATE TABLE IF NOT EXISTS publications (
  project_id    TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  token         TEXT NOT NULL,
  published_at  TEXT NOT NULL,
  base_url      TEXT
);

-- Trazabilidad del parser: qué se leyó, cuántos duplicados cayeron y si el
-- canario de deriva de formato saltó.
CREATE TABLE IF NOT EXISTS scan_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at              TEXT NOT NULL,
  source              TEXT NOT NULL,
  files_read          INTEGER NOT NULL,
  records_seen        INTEGER NOT NULL,
  turns_accepted      INTEGER NOT NULL,
  duplicates_dropped  INTEGER NOT NULL,
  unknown_records     INTEGER NOT NULL,
  malformed_records   INTEGER NOT NULL,
  producer_versions   TEXT NOT NULL,
  warnings            TEXT NOT NULL
);

-- Si esta fila no existe, esta máquina es 100% local. Punto.
CREATE TABLE IF NOT EXISTS cloud_account (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  email         TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free',
  device_token  TEXT NOT NULL,
  api_base_url  TEXT NOT NULL DEFAULT 'https://api.getestela.dev',
  linked_at     TEXT NOT NULL
);

-- El único sitio que decide qué proyecto sale de esta máquina y con qué
-- alcance. Sin fila aquí, ese project_id nunca sincroniza, sea cual sea el
-- plan de la cuenta.
CREATE TABLE IF NOT EXISTS project_sync (
  project_id         TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  scope              TEXT NOT NULL,
  remote_project_id  TEXT NOT NULL,
  remote_org_id      TEXT,
  invite_token       TEXT,
  synced_up_to       TEXT NOT NULL DEFAULT '',
  last_synced_at     TEXT
);

-- Tu consentimiento de compartir IA en un proyecto de equipo. Vive local
-- porque el demonio decide sin preguntarle al servidor si mete ai_micro_usd
-- al subir una fila.
CREATE TABLE IF NOT EXISTS ai_consent (
  project_id    TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  requested     INTEGER NOT NULL DEFAULT 0,
  decision      TEXT NOT NULL DEFAULT 'pending',
  decided_at    TEXT
);

CREATE TABLE IF NOT EXISTS personal_sync_state (
  entity_type   TEXT PRIMARY KEY,
  synced_up_to  TEXT NOT NULL DEFAULT ''
);
`;

/**
 * Migraciones.
 *
 * `CREATE TABLE IF NOT EXISTS` crea tablas nuevas pero **no añade columnas a una
 * tabla que ya existe**: la sentencia no hace nada y la aplicación revienta al
 * primer INSERT. Por eso todo cambio de forma sobre una tabla viva pasa por
 * aquí, en orden y una sola vez.
 *
 * La base de datos guarda el trabajo de meses de alguien. Borrarla y volver a
 * empezar no es una opción de mantenimiento.
 */
const MIGRATIONS: readonly { version: number; describe: string; run: (db: DatabaseSync) => void }[] = [
  {
    version: 11,
    describe: "cuenta cloud, alcance de sincronización y consentimiento de IA",
    run: (db) => {
      // Si esta fila no existe, esta máquina es 100% local. Punto. El id fijo
      // 'local' fuerza que solo pueda haber una.
      db.exec(`CREATE TABLE IF NOT EXISTS cloud_account (
        id            TEXT PRIMARY KEY,
        account_id    TEXT NOT NULL,
        email         TEXT NOT NULL,
        plan          TEXT NOT NULL DEFAULT 'free',
        device_token  TEXT NOT NULL,
        api_base_url  TEXT NOT NULL DEFAULT 'https://api.getestela.dev',
        linked_at     TEXT NOT NULL
      )`);
      // El único sitio que decide qué proyecto sale de esta máquina y con qué
      // alcance. Sin fila aquí, ese project_id nunca sincroniza, sea cual sea
      // el plan de la cuenta.
      db.exec(`CREATE TABLE IF NOT EXISTS project_sync (
        project_id         TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        scope              TEXT NOT NULL,
        remote_project_id  TEXT NOT NULL,
        remote_org_id      TEXT,
        invite_token       TEXT,
        synced_up_to       TEXT NOT NULL DEFAULT '',
        last_synced_at     TEXT
      )`);
      // Tu consentimiento de compartir IA en un proyecto de equipo. Vive local
      // porque el demonio decide sin preguntarle al servidor si mete
      // ai_micro_usd al subir una fila.
      db.exec(`CREATE TABLE IF NOT EXISTS ai_consent (
        project_id    TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        requested     INTEGER NOT NULL DEFAULT 0,
        decision      TEXT NOT NULL DEFAULT 'pending',
        decided_at    TEXT
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS personal_sync_state (
        entity_type   TEXT PRIMARY KEY,
        synced_up_to  TEXT NOT NULL DEFAULT ''
      )`);
    },
  },
  {
    version: 10,
    describe: "nombre del autor y presupuesto de IA",
    run: (db) => {
      // El nombre permite juntar los varios correos de una misma persona.
      addColumn(db, "commits", "author_name", "TEXT NOT NULL DEFAULT ''");
      // Sin presupuesto declarado no hay aviso: null significa "no vigilar",
      // que no es lo mismo que un presupuesto de cero.
      addColumn(db, "projects", "ai_budget_micro_usd", "INTEGER");
    },
  },
  {
    version: 9,
    describe: "marca de escritura en las imputaciones",
    run: (db) => {
      addColumn(db, "time_entries", "updated_at", "TEXT NOT NULL DEFAULT ''");
      db.exec("UPDATE time_entries SET updated_at = ended_at WHERE updated_at = ''");
    },
  },
  {
    version: 8,
    describe: "registro de publicaciones del panel",
    run: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS publications (
        project_id    TEXT PRIMARY KEY,
        token         TEXT NOT NULL,
        published_at  TEXT NOT NULL,
        base_url      TEXT
      )`);
    },
  },
  {
    version: 7,
    describe: "cuota de IA congelada en el informe",
    run: (db) => {
      addColumn(db, "invoices", "ai_amort_minor", "INTEGER");
      addColumn(db, "invoices", "ai_amort_cur", "TEXT");
    },
  },
  {
    version: 6,
    describe: "tipo de proyecto: cliente, nómina o interno",
    run: (db) => addColumn(db, "projects", "kind", "TEXT NOT NULL DEFAULT 'client'"),
  },
  {
    version: 5,
    describe: "rama de trabajo en las imputaciones",
    run: (db) => addColumn(db, "time_entries", "branch", "TEXT"),
  },
  {
    version: 4,
    describe: "ficheros tocados por commit",
    run: (db) => addColumn(db, "commits", "files", "TEXT NOT NULL DEFAULT ''"),
  },
  {
    version: 3,
    describe: "identidad de commit por proyecto",
    run: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS project_authors (
        project_id    TEXT NOT NULL,
        author_email  TEXT NOT NULL,
        PRIMARY KEY (project_id, author_email)
      )`);
    },
  },
  {
    version: 2,
    describe: "origen y tipo de trabajo en las imputaciones",
    run: (db) => {
      addColumn(db, "time_entries", "source", "TEXT NOT NULL DEFAULT 'agent'");
      addColumn(db, "time_entries", "kind", "TEXT NOT NULL DEFAULT 'development'");
    },
  },
];

const CURRENT_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 1);

/** Añade una columna solo si falta. Repetirlo no debe romper nada. */
function addColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function openDatabase(path: string = DEFAULT_DB_PATH): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec(SCHEMA);

  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
    { version: number } | undefined;

  if (!row) {
    // Base nueva: SCHEMA ya la dejó al día.
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(CURRENT_VERSION);
    return db;
  }

  if (row.version > CURRENT_VERSION) {
    db.close();
    throw new Error(
      `La base de datos usa el esquema v${row.version} y esta versión de Estela entiende hasta ` +
      `v${CURRENT_VERSION}. Actualiza Estela antes de continuar.`);
  }

  // Cada migración va en su transacción: si una falla, la base queda en la
  // última versión que sí se aplicó entera, nunca a medias.
  for (const migration of MIGRATIONS) {
    if (migration.version <= row.version) continue;
    db.exec("BEGIN");
    try {
      migration.run(db);
      db.prepare("UPDATE schema_version SET version = ?").run(migration.version);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      db.close();
      throw new Error(
        `Falló la migración v${migration.version} (${migration.describe}): ` +
        `${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return db;
}
