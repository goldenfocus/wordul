// Memorable, voice-friendly room codes: adjective-animal pairs.
// ~60 of each → 3,600 unique combos; collisions in any 1h window are vanishingly rare
// for a v1 audience size, and the DO `idFromName` is content-addressed anyway so a
// "collision" just means two unrelated rooms accidentally share a name — annoying but
// not corrupting. If that ever becomes a real problem, append a 2-digit suffix.

const ADJECTIVES = [
  "happy", "sunny", "fluffy", "spicy", "sleepy", "wobbly", "sneaky", "bouncy",
  "peachy", "salty", "cozy", "fancy", "jolly", "breezy", "dreamy", "witty",
  "sassy", "snazzy", "quirky", "sparkly", "fuzzy", "zesty", "swanky", "perky",
  "dapper", "snappy", "cheeky", "plucky", "lucky", "frothy", "dizzy", "giddy",
  "groovy", "lanky", "mellow", "mighty", "nimble", "plush", "posh", "punchy",
  "rowdy", "scrappy", "slick", "spry", "sturdy", "swift", "tasty", "tipsy",
  "toasty", "trusty", "vibrant", "wacky", "wiggly", "zippy", "balmy", "bold",
  "brave", "brisk", "bubbly", "classy", "clever", "crispy", "crunchy", "dandy",
];

const ANIMALS = [
  "otter", "narwhal", "badger", "raccoon", "panda", "sloth", "axolotl", "capybara",
  "weasel", "ferret", "gecko", "koala", "lemur", "llama", "marmot", "manatee",
  "mole", "mongoose", "octopus", "opossum", "pangolin", "platypus", "puffin", "quokka",
  "salamander", "seahorse", "seal", "shrew", "skunk", "squirrel", "stoat", "tapir",
  "toucan", "walrus", "wombat", "alpaca", "bison", "beaver", "chinchilla", "coati",
  "donkey", "echidna", "hedgehog", "ibex", "kiwi", "lemming", "lynx", "meerkat",
  "ocelot", "pelican", "penguin", "raven", "sparrow", "swan", "tortoise", "vole",
  "yak", "zebra", "moose", "buffalo", "hippo", "rhino", "ferret", "fox",
];

export function generateRoomCode() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj}-${animal}`;
}
