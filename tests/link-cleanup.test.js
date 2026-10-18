const assert = require("node:assert/strict");
const test = require("node:test");
const { cleanChatGptLink, initChatGptLinkCleanup } = require("../.test-build/link-cleanup.cjs");
const { serializeChatGptTurnToMarkdown } = require("../.test-build/chatgpt.cjs");

test("removes only recognized ChatGPT source parameters without reserializing the URL", () => {
  const cases = [
    ["https://aegisub.org/?utm_source=chatgpt.com", "https://aegisub.org"],
    ["https://example.org/doc/?q=a%20b&utm_source=CHATGPT.COM&x=%2f&x=+#part", "https://example.org/doc/?q=a%20b&x=%2f&x=+#part"],
    ["http://example.org/?utm_source=chat.openai.com&utm_source=chatgpt.com", "http://example.org"],
    ["https://example.org/?%75tm_source=chatgpt%2Ecom#top", "https://example.org/#top"],
    ["https://example.org/?utm_source=other&utm_source=chatgpt.com&utm_medium=web", "https://example.org/?utm_source=other&utm_medium=web"],
    ["https://example.org/path?utm_source=chatgpt.com&download", "https://example.org/path?download"],
    ["//example.org/?utm_source=chatgpt.com", "//example.org"],
    ["https://example.org/?a=1&&utm_source=chatgpt.com&b=2", "https://example.org/?a=1&&b=2"]
  ];
  for (const [input, expected] of cases) {
    assert.equal(cleanChatGptLink(input), expected);
    assert.equal(cleanChatGptLink(expected), expected, "cleanup is idempotent");
  }
});

test("leaves unrelated, malformed, and non-HTTP links unchanged", () => {
  for (const href of [
    "https://example.org/", "https://example.org/?q=a+b&utm_source=google#top",
    "https://example.org/?UTM_SOURCE=chatgpt.com", "https://example.org/?utm_source=chatgpt.com.evil",
    "https://example.org/#?utm_source=chatgpt.com", "https://example.org/?utm_source=%ZZ",
    "https://[invalid/?utm_source=chatgpt.com", "https://?utm_source=chatgpt.com",
    "javascript:alert(1)?utm_source=chatgpt.com", "mailto:a@example.org?utm_source=chatgpt.com",
    "/local?utm_source=chatgpt.com", "", "#top"
  ]) {
    assert.equal(cleanChatGptLink(href), href);
  }
});

// A small DOM double models only the selectors and observer boundary used here.
class Element {
  constructor(tag, attributes = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.attributes = { ...attributes };
    this.childNodes = [];
    this.writes = 0;
    for (const child of children) this.append(child);
  }
  append(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }
  get isConnected() { return Boolean(this.parentElement?.isConnected || this.connected); }
  get textContent() { return this.childNodes.map((child) => child.textContent).join(""); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  setAttribute(key, value) { this.attributes[key] = value; this.writes++; }
  matches(selector) {
    if (selector === "a[href]") return this.tagName === "A" && this.getAttribute("href") !== null;
    if (selector.startsWith("input,")) {
      return ["INPUT", "TEXTAREA"].includes(this.tagName) ||
        (this.getAttribute("contenteditable") !== null && this.getAttribute("contenteditable") !== "false");
    }
    if (selector.startsWith('[data-markdown-text-style=')) {
      return this.getAttribute("data-markdown-text-style") === "assistant-message" ||
        this.getAttribute("data-message-author-role") === "assistant";
    }
    return false;
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (node.matches(selector)) return node;
    }
    return null;
  }
  querySelectorAll(selector) {
    return this.childNodes.flatMap((child) => child.nodeType !== 1 ? [] : [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
    ]);
  }
}

function fixture() {
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(root, options) { this.root = root; this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  const root = new Element("html");
  root.connected = true;
  const message = root.append(new Element("div", { "data-markdown-text-style": "assistant-message" }));
  const document = { documentElement: root, defaultView: { MutationObserver: Observer } };
  return { document, root, message, observers };
}

function link() {
  return new Element("a", { href: "https://aegisub.org/?utm_source=chatgpt.com" }, [
    { nodeType: 3, nodeValue: "Aegisub", textContent: "Aegisub" }
  ]);
}

test("initial scan cleans current and legacy assistant links, preserving labels and user/editable content", () => {
  const { document, root, message, observers } = fixture();
  const paragraph = message.append(new Element("p"));
  const current = paragraph.append(link());
  const legacy = root.append(new Element("div", { "data-message-author-role": "assistant" })).append(link());
  const user = root.append(new Element("div", { "data-message-author-role": "user" })).append(link());
  const editable = message.append(new Element("div", { contenteditable: "true" })).append(link());
  const stop = initChatGptLinkCleanup(document, "chatgpt.com");
  assert.equal(current.getAttribute("href"), "https://aegisub.org");
  assert.equal(legacy.getAttribute("href"), "https://aegisub.org");
  assert.equal(current.textContent, "Aegisub");
  assert.equal(user.writes, 0);
  assert.equal(editable.writes, 0);
  assert.deepEqual(observers[0].options.attributeFilter, ["href"]);
  assert.equal(initChatGptLinkCleanup(document, "chatgpt.com"), stop);
  assert.equal(observers.length, 1);

  const copied = serializeChatGptTurnToMarkdown(
    { querySelector: () => ({ nodeType: 1, tagName: "DIV", childNodes: [paragraph] }) },
    { findFormulaElement: () => null, extractLatexFromElement: () => null },
    { formatFormula: () => "" }
  );
  assert.equal(copied.text, "[Aegisub](https://aegisub.org)");
  stop();
  assert.equal(observers[0].disconnected, true);
});

test("batches streamed subtrees and href changes without repeatedly rewriting clean links", async () => {
  const { document, message, observers } = fixture();
  const stop = initChatGptLinkCleanup(document, "chat.openai.com");
  const subtree = message.append(new Element("p", {}, [link()]));
  const anchor = subtree.childNodes[0];
  const observer = observers[0];
  observer.callback([{ type: "childList", addedNodes: [subtree] }]);
  observer.callback([{ type: "childList", addedNodes: [anchor] }]);
  assert.equal(anchor.writes, 0);
  await Promise.resolve();
  assert.equal(anchor.writes, 1);
  observer.callback([{ type: "attributes", target: anchor }]);
  await Promise.resolve();
  assert.equal(anchor.writes, 1, "own mutations do not cause further writes");
  anchor.setAttribute("href", "https://example.org/doc?utm_source=chat.openai.com&q=1");
  observer.callback([{ type: "attributes", target: anchor }]);
  await Promise.resolve();
  assert.equal(anchor.getAttribute("href"), "https://example.org/doc?q=1");
  const pending = message.append(link());
  observer.callback([{ type: "childList", addedNodes: [pending] }]);
  stop();
  await Promise.resolve();
  assert.equal(pending.writes, 0);
});

test("does not initialize on other sites or similarly named hosts", () => {
  for (const hostname of ["chat.deepseek.com", "en.wikipedia.org", "chatgpt.com.evil", "example.org"]) {
    const { document, message, observers } = fixture();
    const anchor = message.append(link());
    initChatGptLinkCleanup(document, hostname)();
    assert.equal(observers.length, 0);
    assert.equal(anchor.writes, 0);
  }
});
