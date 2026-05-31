import { edition as defaultEdition } from "/editions/default.js";

export const EDITIONS = [defaultEdition];

export function getEdition(id) {
  return EDITIONS.find((e) => e.id === id) ?? defaultEdition;
}
