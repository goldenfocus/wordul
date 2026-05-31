export type Color = "green" | "yellow" | "gray";

export function scoreGuess(guess: string, answer: string): Color[] {
  const g = guess.toUpperCase();
  const a = answer.toUpperCase();
  const result: Color[] = new Array(g.length).fill("gray");
  const leftover: Record<string, number> = {};

  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) {
      result[i] = "green";
    } else {
      leftover[a[i]] = (leftover[a[i]] ?? 0) + 1;
    }
  }
  for (let i = 0; i < g.length; i++) {
    if (result[i] === "green") continue;
    const c = g[i];
    if ((leftover[c] ?? 0) > 0) {
      result[i] = "yellow";
      leftover[c] -= 1;
    }
  }
  return result;
}
