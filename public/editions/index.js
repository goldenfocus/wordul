import { edition as defaultEdition } from "/editions/default.js";
import { edition as yangEdition } from "/editions/yang.js";
import { edition as jackpotEdition } from "/editions/jackpot.js";
import { edition as arcadeEdition } from "/editions/arcade.js";
import { edition as editorialEdition } from "/editions/editorial.js";
import { edition as tactileEdition } from "/editions/tactile.js";
import { edition as robotEdition } from "/editions/robot.js";

export const EDITIONS = [
  defaultEdition, yangEdition, jackpotEdition,
  arcadeEdition, editorialEdition, tactileEdition, robotEdition,
];

export function getEdition(id) {
  return EDITIONS.find((e) => e.id === id) ?? defaultEdition;
}
