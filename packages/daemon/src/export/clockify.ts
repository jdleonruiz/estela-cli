import type { Client, Project, TimeEntry } from "@estela/shared";
import { formatWorkItem } from "@estela/shared";

import { localizeDescription } from "../billing/localize.js";

/**
 * Export para el importador de Clockify (Settings → Import → Timesheets).
 *
 * Clockify pide las cabeceras en inglés y escritas exactamente así, sea cual
 * sea el idioma de la cuenta; obligatorias Email, Start Date, Start Time y
 * Duration. Y lee la fecha y la hora **en el formato del perfil de quien
 * importa**, no en uno fijo: por eso se pueden elegir, con los de Clockify por
 * defecto (MM/DD/YYYY y 12 horas).
 *
 * Sin BOM, a diferencia del CSV normal: el BOM se pegaría a la primera
 * cabecera ("﻿Project") y Clockify no la reconocería.
 *
 * El ticket va al principio de la descripción y no en Task: una tarea que no
 * existe en el proyecto de Clockify haría fallar la fila, y el texto siempre
 * entra.
 */

export type ClockifyDateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" | "DD.MM.YYYY" | "DD-MM-YYYY";
export const CLOCKIFY_DATE_FORMATS: readonly ClockifyDateFormat[] =
  ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "DD.MM.YYYY", "DD-MM-YYYY"];

export interface ClockifyOptions {
  /** El correo del usuario en Clockify: tiene que coincidir con el de su cuenta allí. */
  readonly email: string;
  readonly dateFormat: ClockifyDateFormat;
  readonly timeFormat: "12h" | "24h";
}

const HEADER = ["Project", "Client", "Description", "Task", "Email", "Tags", "Billable",
                "Start Date", "Start Time", "Duration (h)"];

function cell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** En hora local: es la que ve quien importa en su Clockify. */
export function clockifyDate(d: Date, format: ClockifyDateFormat): string {
  const y = String(d.getFullYear()), m = pad(d.getMonth() + 1), day = pad(d.getDate());
  switch (format) {
    case "MM/DD/YYYY": return `${m}/${day}/${y}`;
    case "DD/MM/YYYY": return `${day}/${m}/${y}`;
    case "YYYY-MM-DD": return `${y}-${m}-${day}`;
    case "DD.MM.YYYY": return `${day}.${m}.${y}`;
    case "DD-MM-YYYY": return `${day}-${m}-${y}`;
  }
}

export function clockifyTime(d: Date, format: "12h" | "24h"): string {
  const h = d.getHours(), min = pad(d.getMinutes());
  if (format === "24h") return `${pad(h)}:${min}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${min} ${h < 12 ? "AM" : "PM"}`;
}

/** `h:mm`, redondeado al minuto. Clockify acepta también decimales, pero así se lee igual que en su pantalla. */
export function clockifyDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

export function timeEntriesToClockifyCsv(
  entries: readonly TimeEntry[], project: Project, client: Client, options: ClockifyOptions,
): string {
  const lines = [HEADER.join(",")];
  for (const e of entries) {
    // Un bloque de menos de medio minuto sale como 0:00, y Clockify lo rechaza.
    if (Math.round(e.seconds / 60) === 0) continue;
    const tickets = (e.workItems ?? []).map(formatWorkItem);
    const description = (tickets.length ? `[${tickets.join(" ")}] ` : "") + localizeDescription(e);
    lines.push([
      project.name, client.name, description, "", options.email, "",
      e.billable ? "Yes" : "No",
      clockifyDate(e.startedAt, options.dateFormat),
      clockifyTime(e.startedAt, options.timeFormat),
      clockifyDuration(e.seconds),
    ].map(cell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
