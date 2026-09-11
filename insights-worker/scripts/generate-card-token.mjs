import { randomBytes } from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const bytes = randomBytes(8);
const suffix = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");

console.log(`TNT-${suffix}`);
