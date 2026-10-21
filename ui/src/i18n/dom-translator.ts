// Runtime UI localization layer.
//
// Paperclip's UI hardcodes English strings across hundreds of components. Rather than
// rewriting every component (and conflicting with upstream on each merge), this layer
// watches the DOM and swaps known UI strings for their translations. User-authored
// content (markdown bodies, editors, code) is never touched — except for a small,
// explicit set of server-generated phrases (e.g. "Answered questions") that land in
// markdown bodies; those use a separate markdown-only dictionary.

export type Dictionary = Record<string, string>;

const MARKDOWN_SELECTOR = ".paperclip-markdown";

const SKIP_SELECTOR = [
  ".mdxeditor",
  "[contenteditable='true']",
  "[contenteditable='']",
  "pre",
  "code",
  "kbd",
  "textarea",
  "script",
  "style",
  "[data-no-i18n]",
].join(",");

const TRANSLATED_ATTRS = ["placeholder", "title", "aria-label", "alt"] as const;
// Text-entry elements hold user content, but their placeholder/label attributes are UI.
// MDXEditor renders its placeholder as a non-editable sibling inside the editor root.
const EDITOR_PLACEHOLDER_SELECTOR = ".mdxeditor [class*='_placeholder_']:not([contenteditable='true'])";
const TEXT_ENTRY_SELECTOR = "textarea, [contenteditable='true'], [contenteditable='']";
const TRAILING_PUNCT = /^(.*?)([:：…]|\.\.\.)$/s;

interface Pattern {
  regex: RegExp;
  slots: number[];
  template: string;
}

interface TextRecord {
  source: string;
  output: string;
}

export function createTranslator(dict: Dictionary) {
  const exact = new Map<string, string>();
  const lower = new Map<string, string>();
  const patterns: Pattern[] = [];

  for (const [source, target] of Object.entries(dict)) {
    if (!target) continue;
    if (/\{\d+\}/.test(source)) {
      const slots: number[] = [];
      const body = source
        .split(/(\{\d+\})/)
        .map((part) => {
          const slot = /^\{(\d+)\}$/.exec(part);
          if (slot) {
            slots.push(Number(slot[1]));
            return "(.+?)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      patterns.push({ regex: new RegExp(`^${body}$`, "s"), slots, template: target });
    } else {
      exact.set(source, target);
      lower.set(source.toLowerCase(), target);
    }
  }
  // Most specific (longest literal text) first.
  patterns.sort((a, b) => b.regex.source.length - a.regex.source.length);

  function lookup(text: string): string | null {
    const hit = exact.get(text) ?? lower.get(text.toLowerCase());
    if (hit) return hit;
    for (const pattern of patterns) {
      const match = pattern.regex.exec(text);
      if (!match) continue;
      const values: Record<number, string> = {};
      let prose = false;
      pattern.slots.forEach((slot, index) => {
        const raw = match[index + 1];
        const translated = lookup(raw);
        // An untranslated lowercase phrase in a slot means the pattern swallowed
        // ordinary English prose rather than a name/number — don't produce a hybrid.
        if (!translated && /^[a-z]+(\s+[a-z]+)+/.test(raw)) prose = true;
        values[slot] = translated ?? raw;
      });
      if (prose) continue;
      return pattern.template.replace(/\{(\d+)\}/g, (_, n) => values[Number(n)] ?? "");
    }
    return null;
  }

  function translate(text: string): string | null {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized || !/[A-Za-z]/.test(normalized)) return null;
    const direct = lookup(normalized);
    if (direct) return direct;
    const punct = TRAILING_PUNCT.exec(normalized);
    if (punct) {
      const head = lookup(punct[1].trim());
      if (head) return head + punct[2];
    }
    return null;
  }

  return { translate };
}

export function startDomTranslation(
  dict: Dictionary,
  root: Node = document.documentElement,
  markdownDict: Dictionary = {},
) {
  const { translate } = createTranslator(dict);
  const { translate: translateMarkdown } = createTranslator(markdownDict);
  const textRecords = new WeakMap<Text, TextRecord>();
  const attrRecords = new WeakMap<Element, Map<string, TextRecord>>();

  function isSkipped(element: Element | null): boolean {
    if (!element) return true;
    if (element.closest(EDITOR_PLACEHOLDER_SELECTOR)) return false;
    return element.closest(SKIP_SELECTOR) !== null;
  }

  function translateEditorPlaceholders(element: Element) {
    const placeholders = element.matches(EDITOR_PLACEHOLDER_SELECTOR)
      ? [element]
      : [...element.querySelectorAll(EDITOR_PLACEHOLDER_SELECTOR)];
    for (const placeholder of placeholders) {
      const walker = document.createTreeWalker(placeholder, NodeFilter.SHOW_TEXT);
      for (let current = walker.nextNode(); current; current = walker.nextNode()) {
        translateText(current as Text);
      }
    }
  }

  function translateText(node: Text) {
    const current = node.data;
    const record = textRecords.get(node);
    if (record && current === record.output) return;
    if (isSkipped(node.parentElement)) return;
    const inMarkdown = node.parentElement!.closest(MARKDOWN_SELECTOR) !== null;
    const result = inMarkdown ? translateMarkdown(current) : translate(current);
    if (!result) return;
    const leading = /^\s*/.exec(current)?.[0] ?? "";
    const trailing = /\s*$/.exec(current)?.[0] ?? "";
    const output = leading + result + trailing;
    textRecords.set(node, { source: current, output });
    node.data = output;
  }

  function translateAttrs(element: Element) {
    if (element.closest(MARKDOWN_SELECTOR)) return;
    if (isSkipped(element) && !element.matches(TEXT_ENTRY_SELECTOR)) return;
    for (const attr of TRANSLATED_ATTRS) {
      const current = element.getAttribute(attr);
      if (!current) continue;
      let records = attrRecords.get(element);
      const record = records?.get(attr);
      if (record && current === record.output) continue;
      const result = translate(current);
      if (!result) continue;
      if (!records) {
        records = new Map();
        attrRecords.set(element, records);
      }
      records.set(attr, { source: current, output: result });
      element.setAttribute(attr, result);
    }
  }

  function translateTree(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      translateText(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (isSkipped(element)) {
      if (element.matches(TEXT_ENTRY_SELECTOR)) translateAttrs(element);
      translateEditorPlaceholders(element);
      return;
    }
    translateAttrs(element);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(candidate) {
        if (candidate.nodeType === Node.ELEMENT_NODE && (candidate as Element).matches(SKIP_SELECTOR)) {
          if ((candidate as Element).matches(TEXT_ENTRY_SELECTOR)) translateAttrs(candidate as Element);
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
      if (current.nodeType === Node.TEXT_NODE) translateText(current as Text);
      else translateAttrs(current as Element);
    }
    translateEditorPlaceholders(element);
  }

  const pending = new Set<Node>();
  let scheduled = false;
  function flush() {
    scheduled = false;
    const nodes = [...pending];
    pending.clear();
    for (const node of nodes) {
      if (node.isConnected) translateTree(node);
    }
  }
  function enqueue(node: Node) {
    pending.add(node);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") enqueue(mutation.target);
      else if (mutation.type === "attributes") translateAttrs(mutation.target as Element);
      else mutation.addedNodes.forEach(enqueue);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATED_ATTRS],
  });
  translateTree(root);

  return () => observer.disconnect();
}
