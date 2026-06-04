// public/countdown.js — pure countdown timing (no DOM), unit-tested in test/countdown.test.js.
// Given the server-stamped goAt (epoch ms) and the current time, return the number to
// show (3, 2, 1) or null once the count is done — at which point the GO! burst takes over.
export function countdownNumber(goAt, now) {
  const remaining = goAt - now;
  if (remaining <= 0) return null;
  return Math.ceil(remaining / 1000);
}
