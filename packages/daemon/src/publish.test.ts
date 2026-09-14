import assert from "node:assert/strict";
import { test } from "node:test";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { NoAccountError, publishPanel } from "./publish.js";

/**
 * Sin cuenta vinculada o sin proyecto, `publishPanel()` falla ANTES de tocar
 * la red — son las dos rutas que se pueden probar sin un servidor real
 * detrás. El resto (subir de verdad, la cuota) ya lo cubren los tests de
 * `packages/api`, que es donde vive esa lógica.
 */

function fresh() {
  const db = openDatabase(":memory:");
  store.upsertClient(db, { id: "acme", name: "ACME", currency: "EUR" });
  store.upsertProject(db, {
    id: "web", clientId: "acme", name: "Web de ACME", repoPaths: [],
    billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client",
  });
  return db;
}

test("sin proyecto, falla con un mensaje claro y no llega a la cuenta", async () => {
  // `finally` tiene que esperar a la promesa: cerrar la base antes de que
  // `publishPanel` termine su primer `await` la deja a medio trabajar sobre
  // una conexión ya cerrada, y el fallo que sale ya no es el que se prueba.
  const db = fresh();
  try {
    await assert.rejects(
      publishPanel(db, { projectId: "no-existe" }),
      (error: unknown) => {
        assert.match((error as Error).message, /No existe el proyecto/);
        return true;
      });
  } finally { db.close(); }
});

test("sin cuenta vinculada, pide login con el comando exacto", async () => {
  // El mismo mensaje debe servir tanto a quien lo ve en la terminal como a
  // quien lo ve en el panel local: es lo que permite que ambos lo reutilicen
  // sin reescribirlo cada uno a su manera, que es como se desincronizaron
  // antes.
  const db = fresh();
  try {
    await assert.rejects(
      publishPanel(db, { projectId: "web" }),
      (error: unknown) => {
        assert.ok(error instanceof NoAccountError);
        assert.match(error.message, /estela login --email/);
        return true;
      });
  } finally { db.close(); }
});

test("getPublicationToken: null sin publicación previa, y el token real cuando la hay", () => {
  // El fallo real que esto cierra: `cmdPublish` en cli.ts generaba un token
  // nuevo cada vez que --token no se pasaba a mano, aunque el proyecto ya se
  // hubiera publicado desde esta misma máquina — el servidor veía un token
  // que nunca había visto, lo trataba como panel nuevo de verdad, y en plan
  // Free podía rechazar de plano una republicación legítima. Esta es la
  // fuente de verdad que cli.ts debe consultar antes de inventar uno.
  const db = fresh();
  try {
    assert.equal(store.getPublicationToken(db, "web"), null);

    store.recordPublication(db, "web", "tok_primera_vez", "https://getestela.dev");
    assert.equal(store.getPublicationToken(db, "web"), "tok_primera_vez");

    // Publicar de nuevo con OTRO token (lo que hace hoy un `--token` explícito,
    // o una versión sin este arreglo) tiene que dejar el más reciente, no los
    // dos: `project_id` es único en `publications`.
    store.recordPublication(db, "web", "tok_republicado", "https://getestela.dev");
    assert.equal(store.getPublicationToken(db, "web"), "tok_republicado");
  } finally { db.close(); }
});
