import assert from "node:assert/strict";
import { test } from "node:test";

import { CloudError } from "./client.js";

/**
 * El CLI imprime `CloudError` como un mensaje limpio y cualquier otro error
 * como un volcado de pila. Por eso importa QUÉ tipo se propaga: envolver un
 * 402 en un `Error` pelado convertía "sincronizar es de Pro" —que es una
 * respuesta perfectamente normal— en algo que parecía un programa roto.
 *
 * Estas pruebas fijan el contrato del tipo. Que sync.ts y publish.ts lo
 * respeten se ve en que ya no construyen `new Error(...)` con el mensaje.
 */

test("CloudError conserva el status para poder distinguir el motivo", () => {
  const sinPlan = new CloudError("Sincronizar entre máquinas es una función de Pro.", 402);
  const sinSesion = new CloudError("No autorizado.", 401);

  assert.equal(sinPlan.status, 402);
  assert.equal(sinSesion.status, 401);
  assert.ok(sinPlan instanceof Error, "sigue siendo un Error para quien no distinga");
});

test("un fallo de red no afirma de quién es la culpa", () => {
  // Decir "¿tienes internet?" cuando el servidor está caído manda a mirar
  // donde no es. No se puede distinguir desde aquí, así que no se afirma.
  const caido = new CloudError(
    "Sin respuesta de https://getestela.dev. Puede ser tu conexión o que el servicio esté caído; " +
    "en ambos casos, nada de lo tuyo se ha perdido: vuelve a intentarlo.");

  assert.equal(caido.status, undefined, "sin respuesta no hay status que interpretar");
  assert.match(caido.message, /tu conexión o que el servicio/);
  assert.match(caido.message, /nada de lo tuyo se ha perdido/);
});
