import type { FormatOptions, FormulaExtractionResult } from "./shared/types";
import { serializeMarkdownChildren } from "./markdown";

// Current ChatGPT DOM (2026-09 redesign). Each exchange lives in a
// [data-turn-key] wrapper, the assistant Markdown root is tagged with
// data-markdown-text-style="assistant-message" and the native copy action is a
// button labelled "Copy" inside the turn action bar.
export const ASSISTANT_TURN_SELECTOR = "[data-turn-key]";
export const ASSISTANT_MARKDOWN_SELECTOR =
  '[data-markdown-text-style="assistant-message"]';
export const NATIVE_COPY_SELECTOR = 'button[aria-label="Copy"]';
export const COPYTEX_RESPONSE_COPY_ATTRIBUTE = "data-copytex-response-copy";

// Legacy ChatGPT DOM, kept as a fallback for older or A/B-tested markup.
const LEGACY_ASSISTANT_TURN_SELECTOR = 'section[data-testid^="conversation-turn-"]';
const LEGACY_ASSISTANT_MARKDOWN_SELECTOR =
  '[data-message-author-role="assistant"] .markdown';
const LEGACY_ASSISTANT_MESSAGE_SELECTOR = '[data-message-author-role="assistant"]';
const LEGACY_NATIVE_COPY_SELECTOR = 'button[data-testid="copy-turn-action-button"]';
const LEGACY_NATIVE_COPY_ARIA_SELECTOR = 'button[aria-label="Copy response"]';

const NATIVE_COPY_SELECTORS = [
  LEGACY_NATIVE_COPY_SELECTOR,
  LEGACY_NATIVE_COPY_ARIA_SELECTOR,
  NATIVE_COPY_SELECTOR
];

const COPYTEX_NATIVE_INJECTED_ATTRIBUTE = "data-copytex-response-copy-injected";
const ELEMENT_NODE = 1;

interface ExtractorApi {
  findFormulaElement(node: unknown): Element | null;
  extractLatexFromElement(node: unknown): FormulaExtractionResult | null;
}

interface FormulaFormatter {
  formatFormula(extracted: FormulaExtractionResult, options?: FormatOptions): string;
}

interface AssistantCopyTarget {
  turn: Element;
  nativeButton: Element;
}

export interface ChatGptApi {
  ASSISTANT_MARKDOWN_SELECTOR: string;
  ASSISTANT_TURN_SELECTOR: string;
  COPYTEX_RESPONSE_COPY_ATTRIBUTE: string;
  NATIVE_COPY_SELECTOR: string;
  injectResponseCopyButtons(
    root: ParentNode,
    onClick?: (nativeButton: Element, copyTeXButton: Element, turn: Element | null) => void
  ): number;
  isChatGptHost(hostname: string): boolean;
  serializeChatGptTurnToMarkdown(
    turn: ParentNode,
    extractor: ExtractorApi,
    formatter: FormulaFormatter,
    options?: FormatOptions
  ): { ok: boolean; text: string; error?: string };
}

export function isChatGptHost(hostname: string): boolean {
  return hostname === "chatgpt.com" || hostname === "chat.openai.com";
}

export function injectResponseCopyButtons(
  root: ParentNode,
  onClick?: (nativeButton: Element, copyTeXButton: Element, turn: Element | null) => void
): number {
  if (!root || typeof root.querySelectorAll !== "function") {
    return 0;
  }

  let count = 0;
  for (const target of collectAssistantCopyTargets(root)) {
    const { turn, nativeButton } = target;
    const existingButton = findResponseCopyButton(turn);
    if (existingButton) {
      if (isInsertedAfterNativeButton(existingButton, nativeButton)) {
        continue;
      }

      removeElement(existingButton);
    }

    const copyTeXButton = createResponseCopyButton(nativeButton, turn, onClick);
    if (!copyTeXButton || !insertResponseCopyButton(copyTeXButton, nativeButton)) {
      continue;
    }

    nativeButton.setAttribute(COPYTEX_NATIVE_INJECTED_ATTRIBUTE, "true");
    count += 1;
  }

  return count;
}

function collectAssistantCopyTargets(root: ParentNode): AssistantCopyTarget[] {
  const targets: AssistantCopyTarget[] = [];
  const seenNativeButtons = new Set<Element>();

  // Current DOM: pair every assistant message with the native copy button that
  // ChatGPT renders in the action bar of the same turn.
  for (const messageRoot of querySelectorAll(root, ASSISTANT_MARKDOWN_SELECTOR)) {
    const target = findAssistantCopyTarget(messageRoot);
    if (target && !seenNativeButtons.has(target.nativeButton)) {
      seenNativeButtons.add(target.nativeButton);
      targets.push(target);
    }
  }

  // Legacy DOM: assistant turns are sections holding an assistant message.
  for (const turn of querySelectorAllWithSelf(root, LEGACY_ASSISTANT_TURN_SELECTOR).filter(
    isAssistantTurn
  )) {
    const messageRoot = querySelector(turn, LEGACY_ASSISTANT_MARKDOWN_SELECTOR);
    const nativeButton = findNativeCopyButton(turn, messageRoot);
    if (!nativeButton || seenNativeButtons.has(nativeButton)) {
      continue;
    }

    seenNativeButtons.add(nativeButton);
    targets.push({ turn, nativeButton });
  }

  return targets;
}

function findAssistantCopyTarget(messageRoot: Element): AssistantCopyTarget | null {
  const boundary = closest(messageRoot, ASSISTANT_TURN_SELECTOR);
  let cursor = parentElement(messageRoot);

  while (cursor) {
    const nativeButton = findNativeCopyButton(cursor, messageRoot);
    if (nativeButton) {
      return { turn: cursor, nativeButton };
    }

    if (cursor === boundary || containsAssistantMessage(cursor, messageRoot)) {
      break;
    }

    cursor = parentElement(cursor);
  }

  return null;
}

function containsAssistantMessage(scope: Element, messageRoot: Element): boolean {
  for (const candidate of querySelectorAll(scope, ASSISTANT_MARKDOWN_SELECTOR)) {
    if (candidate !== messageRoot) {
      return true;
    }
  }

  return false;
}

function createResponseCopyButton(
  nativeButton: Element,
  turn: Element,
  onClick?: (nativeButton: Element, copyTeXButton: Element, turn: Element | null) => void
): Element | null {
  const button = nativeButton.cloneNode(false) as Element;
  if (!button) {
    return null;
  }

  button.removeAttribute("data-testid");
  button.removeAttribute("data-state");
  button.setAttribute("type", "button");
  button.setAttribute(COPYTEX_RESPONSE_COPY_ATTRIBUTE, "true");
  button.setAttribute("aria-label", "Copy message with CopyTeX");
  button.setAttribute("title", "Copy message with CopyTeX");
  button.innerHTML =
    '<span class="copytex-response-copy-label flex items-center justify-center touch:w-10 h-8 w-8">TeX</span>';
  matchNativeButtonSize(button, nativeButton);

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (typeof onClick === "function") {
      onClick(nativeButton, button, findChatGptAssistantTurn(button) || turn);
    }
  });

  return button;
}

// ChatGPT action bars changed from 32px buttons to compact 20px ones, so size
// the injected button after the native one instead of hard coding it.
function matchNativeButtonSize(button: Element, nativeButton: Element): void {
  const size = measureElementSize(nativeButton);
  if (!size) {
    return;
  }

  setElementSize(button, size);
  const label = firstElementChild(button);
  if (label) {
    setElementSize(label, size);
    setInlineStyle(label, "lineHeight", `${size}px`);
  }
}

function measureElementSize(element: Element): number {
  const measure = (element as {
    getBoundingClientRect?: () => { width?: number; height?: number };
  }).getBoundingClientRect;
  if (typeof measure !== "function") {
    return 0;
  }

  const rect = measure.call(element);
  const width = Number(rect && rect.width) || 0;
  const height = Number(rect && rect.height) || 0;
  const size = Math.max(width, height);

  return size > 0 ? Math.round(size) : 0;
}

function setElementSize(element: Element, size: number): void {
  setInlineStyle(element, "minWidth", `${size}px`);
  setInlineStyle(element, "height", `${size}px`);
}

function setInlineStyle(element: Element, property: string, value: string): void {
  const style = (element as { style?: Record<string, string> }).style;
  if (style) {
    style[property] = value;
  }
}

function firstElementChild(element: Element): Element | null {
  const children = (element as { children?: ArrayLike<Element> }).children;
  return children && children.length ? children[0] : null;
}

export function serializeChatGptTurnToMarkdown(
  turn: ParentNode,
  extractor: ExtractorApi,
  formatter: FormulaFormatter,
  options?: FormatOptions
): { ok: boolean; text: string; error?: string } {
  const messageRoot = findChatGptMessageRoot(turn);
  if (!messageRoot) {
    return { ok: false, text: "", error: "No response content found" };
  }

  const text = serializeMarkdownChildren(messageRoot, extractor, formatter, options);

  return text
    ? { ok: true, text }
    : { ok: false, text: "", error: "No response content found" };
}

function findNativeCopyButton(scope: ParentNode, exclude?: Element | null): Element | null {  for (const selector of NATIVE_COPY_SELECTORS) {
    for (const candidate of querySelectorAll(scope, selector)) {
      if (exclude && containsElement(exclude, candidate)) {
        continue;
      }

      return candidate;
    }
  }

  return null;
}

function findResponseCopyButton(turn: ParentNode): Element | null {
  return querySelector(turn, `[${COPYTEX_RESPONSE_COPY_ATTRIBUTE}="true"]`);
}

function insertResponseCopyButton(copyTeXButton: Element, nativeButton: Element): boolean {
  if (typeof nativeButton.insertAdjacentElement === "function") {
    nativeButton.insertAdjacentElement("afterend", copyTeXButton);
    return true;
  }

  return false;
}

function isInsertedAfterNativeButton(button: Element, nativeButton: Element): boolean {
  return previousElementSibling(button) === nativeButton;
}

function previousElementSibling(element: Element): Element | null {
  const previous = (element as { previousElementSibling?: Element | null }).previousElementSibling;
  if (previous) {
    return previous;
  }

  const parent = (element as { parentElement?: { children?: ArrayLike<Element> } | null })
    .parentElement;
  const siblings = parent?.children ? Array.from(parent.children) : [];
  const index = siblings.indexOf(element);

  return index > 0 ? siblings[index - 1] : null;
}

function parentElement(element: Element): Element | null {
  return (element as { parentElement?: Element | null }).parentElement || null;
}

function containsElement(parent: Element, child: Element): boolean {
  if (typeof parent.contains === "function") {
    return parent.contains(child);
  }

  let cursor: Element | null = child;
  while (cursor) {
    if (cursor === parent) {
      return true;
    }

    cursor = parentElement(cursor);
  }

  return false;
}

function removeElement(element: Element): void {
  if (typeof element.remove === "function") {
    element.remove();
    return;
  }

  const parent = element.parentNode;
  if (parent && typeof parent.removeChild === "function") {
    parent.removeChild(element);
  }
}

function findChatGptAssistantTurn(element: unknown): Element | null {
  const turn = closest(element, ASSISTANT_TURN_SELECTOR);
  return isElementLike(turn) ? turn : null;
}

function findChatGptMessageRoot(turn: ParentNode): Element | null {
  return (
    querySelector(turn, ASSISTANT_MARKDOWN_SELECTOR) ||
    querySelector(turn, LEGACY_ASSISTANT_MARKDOWN_SELECTOR) ||
    querySelector(turn, ".markdown") ||
    querySelector(turn, LEGACY_ASSISTANT_MESSAGE_SELECTOR)
  );
}

function isAssistantTurn(turn: unknown): turn is Element {
  if (!isElementLike(turn) || tagName(turn) !== "section") {
    return false;
  }

  if (!String(getAttribute(turn, "data-testid")).startsWith("conversation-turn-")) {
    return false;
  }

  if (getAttribute(turn, "data-turn") === "assistant") {
    return true;
  }

  return Boolean(querySelector(turn, LEGACY_ASSISTANT_MESSAGE_SELECTOR));
}

function closest(element: unknown, selector: string): Element | null {
  if (!element) {
    return null;
  }

  if (isElementLike(element) && typeof element.closest === "function") {
    return element.closest(selector);
  }

  let cursor = isNodeLike(element) ? element : null;
  while (cursor) {
    if (matchesSelector(cursor, selector)) {
      return cursor as Element;
    }
    cursor = cursor.parentElement || cursor.parentNode || null;
  }

  return null;
}

function getAttribute(element: unknown, name: string): string {
  if (element && typeof (element as Element).getAttribute === "function") {
    return (element as Element).getAttribute(name) || "";
  }
  return "";
}

function querySelector(root: unknown, selector: string): Element | null {
  if (root && typeof (root as ParentNode).querySelector === "function") {
    return (root as ParentNode).querySelector(selector);
  }

  return querySelectorAll(root, selector)[0] || null;
}

function querySelectorAllWithSelf(root: unknown, selector: string): Element[] {
  const matches = isElementLike(root) && matchesSelector(root, selector) ? [root] : [];
  return matches.concat(querySelectorAll(root, selector));
}

function querySelectorAll(root: unknown, selector: string): Element[] {
  if (root && typeof (root as ParentNode).querySelectorAll === "function") {
    return Array.from((root as ParentNode).querySelectorAll(selector));
  }

  const selectorMatches: Element[] = [];
  walk(root, (node) => {
    if (matchesSelector(node, selector)) {
      selectorMatches.push(node);
    }
  });
  return selectorMatches;
}

function matchesSelector(node: Node, selector: string): node is Element {
  if (!isElementLike(node)) {
    return false;
  }

  if (typeof node.matches === "function") {
    return node.matches(selector);
  }

  if (selector === ASSISTANT_TURN_SELECTOR) {
    return getAttribute(node, "data-turn-key") !== "";
  }

  if (selector === ASSISTANT_MARKDOWN_SELECTOR) {
    return getAttribute(node, "data-markdown-text-style") === "assistant-message";
  }

  if (selector === NATIVE_COPY_SELECTOR) {
    return isCopyActionButton(node, "Copy");
  }

  if (selector === LEGACY_NATIVE_COPY_SELECTOR) {
    return tagName(node) === "button" && getAttribute(node, "data-testid") === "copy-turn-action-button";
  }

  if (selector === LEGACY_NATIVE_COPY_ARIA_SELECTOR) {
    return isCopyActionButton(node, "Copy response");
  }

  if (selector === LEGACY_ASSISTANT_TURN_SELECTOR) {
    return (
      tagName(node) === "section" &&
      String(getAttribute(node, "data-testid")).startsWith("conversation-turn-")
    );
  }

  if (selector === LEGACY_ASSISTANT_MARKDOWN_SELECTOR) {
    return hasClass(node, "markdown") && Boolean(closest(node, LEGACY_ASSISTANT_MESSAGE_SELECTOR));
  }

  if (selector === LEGACY_ASSISTANT_MESSAGE_SELECTOR) {
    return getAttribute(node, "data-message-author-role") === "assistant";
  }

  if (selector === `[${COPYTEX_RESPONSE_COPY_ATTRIBUTE}="true"]`) {
    return getAttribute(node, COPYTEX_RESPONSE_COPY_ATTRIBUTE) === "true";
  }

  if (selector === "code" || selector === "tr") {
    return tagName(node) === selector;
  }

  if (selector.startsWith(".")) {
    return hasClass(node, selector.slice(1));
  }

  return false;
}

function isCopyActionButton(node: Element, label: string): boolean {
  return tagName(node) === "button" && getAttribute(node, "aria-label") === label;
}

function walk(root: unknown, visit: (node: Node) => void): void {
  if (!root) {
    return;
  }

  for (const child of childNodes(root)) {
    visit(child);
    walk(child, visit);
  }
}

function childNodes(node: unknown): Node[] {
  return Array.from(((node as { childNodes?: Node[]; children?: Node[] } | null) &&
    ((node as { childNodes?: Node[]; children?: Node[] }).childNodes ||
      (node as { childNodes?: Node[]; children?: Node[] }).children)) || []);
}

function tagName(node: unknown): string {
  return String((node as { tagName?: unknown } | null)?.tagName || "").toLowerCase();
}

function hasClass(node: unknown, className: string): boolean {
  if (
    node &&
    (node as Element).classList &&
    typeof (node as Element).classList.contains === "function"
  ) {
    return (node as Element).classList.contains(className);
  }

  return String((node as { className?: unknown } | null)?.className || "")
    .split(/\s+/)
    .includes(className);
}

function isElementLike(value: unknown): value is Element {
  return Boolean(
    value &&
      ((value as Node).nodeType === ELEMENT_NODE ||
        typeof (value as Element).tagName === "string")
  );
}

function isNodeLike(value: unknown): value is Node {
  return Boolean(value && typeof (value as Node).nodeType === "number");
}

export const chatGptApi: ChatGptApi = {
  ASSISTANT_MARKDOWN_SELECTOR,
  ASSISTANT_TURN_SELECTOR,
  COPYTEX_RESPONSE_COPY_ATTRIBUTE,
  NATIVE_COPY_SELECTOR,
  injectResponseCopyButtons,
  isChatGptHost,
  serializeChatGptTurnToMarkdown
};

(globalThis as typeof globalThis & { CopyTeXChatGPT?: ChatGptApi }).CopyTeXChatGPT =
  chatGptApi;
