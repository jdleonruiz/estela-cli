/**
 * Quién es quién en un repositorio.
 *
 * Git no tiene identidades, tiene pares (nombre, correo) escritos a mano en
 * cada máquina. En un repositorio de cliente, una sola persona aparecía así:
 *
 *   Nerea Vidal <nerea.vidal@estudio.es>     79 commits
 *   Nerea Vidal <nerea.vidal@contrata.com>  134 commits
 *   nvidal      <nerea.vidal@estudio.es>     11 commits
 *
 * Agrupar por correo la parte en dos. Agrupar por nombre también. Una vista de
 * equipo que enseñe a Nerea tres veces no se la cree nadie, y con razón: si
 * falla en lo que el lector puede comprobar de un vistazo, deja de creerse
 * también lo que no puede comprobar.
 *
 * La regla: **dos identidades son la misma persona si comparten el correo, o si
 * comparten un nombre que de verdad identifique a alguien**, y esa relación se
 * propaga. Es el problema de las componentes conexas de un grafo, y resuelve el
 * caso de arriba en un paso: `nvidal` entra por el correo que comparte con
 * `Nerea Vidal`, y arrastra consigo el segundo correo de esa persona.
 *
 * El matiz del nombre no es teórico. Unir por cualquier nombre fusionaba a dos
 * compañeros distintos porque ambos habían commiteado alguna vez como "MB": un
 * alias de dos letras hacía de puente entre `mb-soler@` y `mb-ortega@`. Por
 * eso solo une un nombre con apellido, y los alias sueltos se agrupan por
 * correo, que es el vínculo fuerte.
 *
 * El sesgo es deliberado: ante la duda, partir antes que fundir. Una persona
 * partida en dos filas se ve en pantalla y se entiende; dos personas fundidas
 * atribuyen el trabajo de alguien a otro sin que nadie lo note.
 */

export interface AuthorRow {
  readonly name: string;
  readonly email: string;
  readonly commits: number;
}

export interface Person {
  /** Nombre para enseñar: el más humano de los que usa. */
  readonly name: string;
  readonly emails: readonly string[];
  readonly names: readonly string[];
  readonly commits: number;
}

/** Une identidades de git que pertenecen a la misma persona. */
export function mergeIdentities(rows: readonly AuthorRow[]): Person[] {
  // Union-find sobre los índices de las filas.
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i]! !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const byName = new Map<string, number>();
  const byEmail = new Map<string, number>();

  rows.forEach((row, i) => {
    const name = row.name.trim().toLowerCase();
    const email = row.email.trim().toLowerCase();

    // Solo une por nombre si el nombre identifica a alguien. Un alias corto no
    // lo hace, y fundir a dos personas es mucho peor que partir a una en dos:
    // partirla se ve en pantalla y se entiende, fundirlas atribuye el trabajo
    // de alguien a otra persona sin que nadie lo note.
    //
    // Pasó de verdad: "MB" se usó con mb-soler@ y con mb-ortega@, y ese alias
    // de dos letras unió a dos personas distintas en una sola fila.
    if (isFullName(name)) {
      const seen = byName.get(name);
      if (seen !== undefined) union(i, seen); else byName.set(name, i);
    }
    if (email) {
      const seen = byEmail.get(email);
      if (seen !== undefined) union(i, seen); else byEmail.set(email, i);
    }
  });

  const groups = new Map<number, AuthorRow[]>();
  rows.forEach((row, i) => {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(row); else groups.set(root, [row]);
  });

  return [...groups.values()]
    .map((bucket) => ({
      name: displayName(bucket),
      emails: [...new Set(bucket.map((r) => r.email).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      names: [...new Set(bucket.map((r) => r.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      commits: bucket.reduce((sum, r) => sum + r.commits, 0),
    }))
    .sort((a, b) => b.commits - a.commits);
}

/**
 * Si un nombre identifica a una persona o es solo el alias de una cuenta.
 *
 * El criterio es tener nombre y apellido. No es infalible, pero separa bien lo
 * que hay en un historial de git real: "Nerea Vidal" identifica, "nvidal" y
 * "MB" no. Un alias suelto sigue uniéndose por correo, que es el vínculo
 * fuerte, así que no se pierde nada por ser estricto aquí.
 */
function isFullName(name: string): boolean {
  return name.includes(" ") && name.length >= 5;
}

/**
 * El nombre que se enseña.
 *
 * Se prefiere el que parece un nombre de persona ("Nerea Vidal") al alias de
 * la cuenta ("nvidal"), porque quien lee el panel conoce a sus compañeros por
 * el primero. A igualdad, manda el que más commits tiene.
 */
function displayName(bucket: readonly AuthorRow[]): string {
  const candidates = bucket.filter((r) => r.name.trim());
  if (candidates.length === 0) return bucket[0]?.email ?? "desconocido";

  return [...candidates].sort((a, b) => {
    const humanA = a.name.includes(" ") ? 1 : 0;
    const humanB = b.name.includes(" ") ? 1 : 0;
    if (humanA !== humanB) return humanB - humanA;
    return b.commits - a.commits;
  })[0]!.name;
}
