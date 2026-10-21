// Usage: node scripts/i18n-extract-missing-ko.mjs <repoRoot> <outJson>
// Run after an upstream sync, translate the output, and merge it into ui/src/i18n/ko.json.
// Extracts user-visible English UI strings from ui/src (*.tsx) and lists those
// missing from ui/src/i18n/ko.json + ko-overrides.json.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const [repoRoot, outJson] = process.argv.slice(2);
const require = createRequire(path.join(repoRoot, "ui/package.json"));
const pnpmDir = path.join(repoRoot, "node_modules/.pnpm");
const ts5 = readdirSync(pnpmDir).find((name) => /^typescript@5\./.test(name));
// TypeScript 7 (native) has no compiler API; use a 5.x copy.
const ts = require(path.join(pnpmDir, ts5, "node_modules/typescript"));

const UI_ATTRS = new Set(["placeholder", "title", "aria-label", "alt", "label", "description", "tooltip", "emptyMessage", "heading", "subtitle", "helperText", "hint", "confirmLabel", "cancelLabel", "submitLabel", "message", "text"]);
const UI_PROPS = new Set(["label", "title", "description", "placeholder", "heading", "subtitle", "helperText", "hint", "emptyMessage", "tooltip", "message", "body", "summary", "cta", "actionLabel", "confirmLabel", "name"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry.startsWith("._") || entry === "node_modules" || entry === "i18n") continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry) && !/\.(test|spec|stories)\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

function looksLikeUiText(s) {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > 400) return null;
  if (!/[A-Za-z]{2}/.test(t)) return null;
  if (/^[a-z0-9_.:/#\-[\]()=&%]+$/.test(t)) return null; // identifiers, paths, keys
  if (/^(https?:|\/|\.\/|#|@|data:|mailto:)/.test(t)) return null;
  const tokens = t.split(" ");
  // tailwind class lists
  if (tokens.length > 1 && tokens.every((tok) => /^[!a-z0-9:\-/[\].%#()_&>~*,]+$/.test(tok)) && tokens.some((tok) => /[-:]/.test(tok))) return null;
  if (!/[A-Z]/.test(t) && tokens.length < 2) return null;
  return t;
}

const found = new Map(); // text -> first file
function add(text, file) {
  const t = looksLikeUiText(text);
  if (t && !found.has(t)) found.set(t, path.relative(repoRoot, file));
}

function templateToPattern(node) {
  let out = node.head.text;
  node.templateSpans.forEach((span, i) => {
    out += `{${i}}` + span.literal.text;
  });
  return out;
}

function inJsx(node) {
  let p = node.parent;
  for (let depth = 0; p && depth < 8; depth++, p = p.parent) {
    if (ts.isJsxExpression(p) || ts.isJsxAttribute(p)) return true;
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

for (const file of walk(path.join(repoRoot, "ui/src"))) {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isJsxText(node)) add(node.text, file);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      if (ts.isJsxAttribute(parent)) {
        if (UI_ATTRS.has(parent.name.getText(src))) add(node.text, file);
      } else if (ts.isPropertyAssignment(parent) && UI_PROPS.has(parent.name.getText(src).replace(/["']/g, ""))) {
        add(node.text, file);
      } else if (ts.isCallExpression(parent) && /^(toast|pushToast|setError|alert|confirm)/.test(parent.expression.getText(src))) {
        add(node.text, file);
      } else if (inJsx(node) && !ts.isImportDeclaration(parent) && !(ts.isCallExpression(parent) && /cn|clsx|cva|twMerge/.test(parent.expression.getText(src)))) {
        add(node.text, file);
      }
    } else if (ts.isTemplateExpression(node) && inJsx(node)) {
      const pattern = templateToPattern(node);
      if (/[A-Za-z]{3,}.*\s/.test(pattern.replace(/\{\d+\}/g, ""))) add(pattern, file);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}

const dict = {
  ...JSON.parse(readFileSync(path.join(repoRoot, "ui/src/i18n/ko.json"), "utf8")),
  ...JSON.parse(readFileSync(path.join(repoRoot, "ui/src/i18n/ko-overrides.json"), "utf8")),
};
const known = new Set(Object.keys(dict).map((k) => k.toLowerCase()));
const missing = [...found.entries()]
  .filter(([t]) => !known.has(t.toLowerCase()))
  .map(([text, file]) => ({ text, file }));
writeFileSync(outJson, JSON.stringify(missing, null, 1));
console.log(`found=${found.size} known=${known.size} missing=${missing.length}`);
