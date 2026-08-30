#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const jsRoot = path.join(root, "js");
const failures = [];
let checkedImports = 0;

function walk(dir, collected = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, collected);
    else if (entry.name.endsWith(".js")) collected.push(full);
  }
  return collected;
}

function filesystemSpecifier(specifier) {
  return String(specifier).split(/[?#]/, 1)[0];
}

function resolveImport(fromFile, specifier) {
  const cleanSpecifier = filesystemSpecifier(specifier);
  const absolute = path.resolve(path.dirname(fromFile), cleanSpecifier);
  const candidates = [absolute, `${absolute}.js`, path.join(absolute, "index.js")];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

for (const file of walk(jsRoot)) {
  const source = fs.readFileSync(file, "utf8");
  const specifiers = new Set();

  for (const match of source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) {
    specifiers.add(match[1]);
  }
  for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.add(match[1]);
  }

  for (const specifier of specifiers) {
    if (!specifier.startsWith(".")) continue;
    checkedImports += 1;
    if (!resolveImport(file, specifier)) {
      failures.push(`${path.relative(root, file)} -> ${specifier}`);
    }
  }
}

if (failures.length) {
  console.error("Broken relative JavaScript imports:");
  failures.forEach((failure) => console.error(`✗ ${failure}`));
  process.exit(1);
}

console.log(`✓ ${checkedImports} relative JavaScript imports resolve to repository files.`);
