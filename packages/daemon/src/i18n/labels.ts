import type { WorkKind } from "@estela/shared";

import { tr } from "./index.js";

/**
 * Nombre de un tipo de trabajo en el idioma en curso (el de la terminal, o el
 * del documento si se genera dentro de `withLang`).
 *
 * `WORK_KIND_LABELS` vive en `shared` y está en español; se traduce aquí, sin
 * tocar ese paquete. Vive en su propio fichero, no en `cli.ts`, porque también
 * lo necesitan el panel compartido y las métricas — y esos no pueden importar
 * el CLI entero solo por una etiqueta.
 */
export function kindLabel(kind: WorkKind): string {
  switch (kind) {
    case "development": return tr`Desarrollo`;
    case "meeting":     return tr`Reunión`;
    case "research":    return tr`Investigación`;
    case "review":      return tr`Revisión`;
    case "travel":      return tr`Desplazamiento`;
    case "support":     return tr`Soporte`;
    case "other":       return tr`Otro`;
  }
}
