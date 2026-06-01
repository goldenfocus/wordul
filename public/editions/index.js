import { edition as defaultEdition } from "/editions/default.js";
import { edition as yangEdition } from "/editions/yang.js";
import { edition as jackpotEdition } from "/editions/jackpot.js";

export const EDITIONS = [defaultEdition, yangEdition, jackpotEdition];

export function getEdition(id) {
  return EDITIONS.find((e) => e.id === id) ?? defaultEdition;
}
