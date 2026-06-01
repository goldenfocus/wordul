import { edition as defaultEdition } from "/editions/default.js";
import { edition as yangEdition } from "/editions/yang.js";

export const EDITIONS = [defaultEdition, yangEdition];

export function getEdition(id) {
  return EDITIONS.find((e) => e.id === id) ?? defaultEdition;
}
