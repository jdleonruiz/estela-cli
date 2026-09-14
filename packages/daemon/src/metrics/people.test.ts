import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeIdentities, type AuthorRow } from "./people.js";

/**
 * Un equipo tal y como sale de `git shortlog`: la misma persona repartida
 * entre varios correos y alias.
 *
 * Los casos vienen de repositorios reales, pero los nombres y correos son
 * inventados a propósito — la plantilla de un cliente y cuánto commitea cada
 * uno no es algo que deba viajar en un repositorio público. Lo que sí se ha
 * conservado es la forma del lío, que es lo que estos tests comprueban.
 */
const EQUIPO: AuthorRow[] = [
  { name: "Nerea Vidal", email: "nerea.vidal@estudio.es", commits: 79 },
  { name: "Nerea Vidal", email: "nerea.vidal@contrata.com", commits: 134 },
  { name: "nvidal", email: "nerea.vidal@estudio.es", commits: 11 },
  { name: "Iván Salgado Pons", email: "ivan.salgado@estudio.es", commits: 256 },
  { name: "Iván Salgado Pons", email: "ivansalgado@estudio.es", commits: 25 },
  { name: "i-salgado4", email: "ivan.salgado@estudio.es", commits: 1 },
  { name: "Marta Quiroga Elías", email: "marta.quiroga@estudio.es", commits: 523 },
  { name: "aperez", email: "adrian.perez@ext.estudio.es", commits: 69 },
];

test("une a una persona repartida entre varios correos y alias", () => {
  const people = mergeIdentities(EQUIPO);

  // Nerea entra por dos vías a la vez: `nvidal` comparte correo con una de
  // sus filas, y esa fila comparte nombre con la otra. Sin propagar la
  // relación, se quedaría fuera uno de los dos correos.
  const nerea = people.find((p) => p.name === "Nerea Vidal");
  assert.ok(nerea, "no se encontró a Nerea");
  assert.equal(nerea.commits, 79 + 134 + 11);
  assert.deepEqual(nerea.emails,
    ["nerea.vidal@contrata.com", "nerea.vidal@estudio.es"]);
});

test("prefiere el nombre de persona al alias de la cuenta", () => {
  const people = mergeIdentities(EQUIPO);
  // "Nerea Vidal" y no "nvidal": quien lee el panel conoce a sus
  // compañeros por su nombre, no por su usuario.
  assert.ok(people.some((p) => p.name === "Nerea Vidal"));
  assert.ok(!people.some((p) => p.name === "nvidal"));
});

test("no funde a personas que no comparten nada", () => {
  const people = mergeIdentities(EQUIPO);
  assert.equal(people.length, 4, people.map((p) => p.name).join(", "));
  assert.ok(people.some((p) => p.name === "Marta Quiroga Elías"));
  assert.ok(people.some((p) => p.name === "aperez"));
});

test("un nombre vacío no une a media plantilla", () => {
  // Commitear sin nombre configurado es común. Si el vacío uniera, todas esas
  // personas se fundirían en una sola fila inventada.
  const people = mergeIdentities([
    { name: "", email: "ana@empresa.com", commits: 5 },
    { name: "", email: "luis@empresa.com", commits: 3 },
  ]);
  assert.equal(people.length, 2);
});

test("ordena por volumen y suma bien", () => {
  const people = mergeIdentities(EQUIPO);
  assert.equal(people[0]!.name, "Marta Quiroga Elías");
  assert.equal(people.reduce((s, p) => s + p.commits, 0),
    EQUIPO.reduce((s, r) => s + r.commits, 0));
});

test("un alias corto no hace de puente entre dos personas", () => {
  // El caso real: dos compañeros distintos habían commiteado alguna vez como
  // "MB". Uniendo por cualquier nombre, ese alias de dos letras los fundía y
  // uno se llevaba el trabajo del otro.
  const people = mergeIdentities([
    { name: "MB Soler", email: "mb-soler@empresa.com", commits: 475 },
    { name: "MB", email: "mb-soler@empresa.com", commits: 21 },
    { name: "MB", email: "mb-ortega@empresa.com", commits: 2 },
    { name: "MB Ortega", email: "mb-ortega@empresa.com", commits: 64 },
  ]);

  assert.equal(people.length, 2, "son dos personas distintas");
  const soler = people.find((p) => p.emails.includes("mb-soler@empresa.com"))!;
  const ortega = people.find((p) => p.emails.includes("mb-ortega@empresa.com"))!;

  // Cada alias "MB" se agrupa por su correo, con quien le corresponde.
  assert.equal(soler.commits, 475 + 21);
  assert.equal(ortega.commits, 64 + 2);
  assert.ok(!soler.emails.includes("mb-ortega@empresa.com"));
});

test("un nombre con apellido sí une dos correos", () => {
  // Lo contrario también tiene que seguir funcionando, o Nerea vuelve a salir
  // partida en dos filas.
  const people = mergeIdentities([
    { name: "Nerea Vidal", email: "n@estudio.es", commits: 79 },
    { name: "Nerea Vidal", email: "n@contrata.com", commits: 134 },
  ]);
  assert.equal(people.length, 1);
});
