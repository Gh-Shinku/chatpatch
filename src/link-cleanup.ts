// Keep source-specific rules here, independently of formula and copy features.
const TRACKING_SOURCES = new Map([
  ["utm_source", new Set(["chatgpt.com", "chat.openai.com"])]
]);
const ASSISTANT_SELECTOR =
  '[data-markdown-text-style="assistant-message"], [data-message-author-role="assistant"]';
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';
const controllers = new WeakMap<Document, () => void>();

export function cleanChatGptLink(href: string): string {
  // Validate without serializing through URL: serialization would alter unrelated
  // encoding, parameter formatting, and the root slash.
  if (!/^(https?:)?\/\//i.test(href)) {
    return href;
  }
  try {
    const url = new URL(href, "https://chatgpt.com");
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return href;
    }
  } catch {
    return href;
  }

  const hashIndex = href.indexOf("#");
  const fragment = hashIndex < 0 ? "" : href.slice(hashIndex);
  const beforeFragment = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const queryIndex = beforeFragment.indexOf("?");
  if (queryIndex < 0) {
    return href;
  }

  const parts = beforeFragment.slice(queryIndex + 1).split("&");
  const kept = parts.filter((part) => {
    const pair = new URLSearchParams(part).entries().next().value;
    return !pair || !TRACKING_SOURCES.get(pair[0])?.has(pair[1].toLowerCase());
  });
  if (kept.length === parts.length) {
    return href;
  }

  const query = kept.join("&");
  const cleaned = beforeFragment.slice(0, queryIndex) + (query ? `?${query}` : "") + fragment;
  return cleaned.replace(/^((?:https?:)?\/\/[^/?#]+)\/$/i, "$1");
}

export function initChatGptLinkCleanup(document: Document, hostname: string): () => void {
  if (hostname !== "chatgpt.com" && hostname !== "chat.openai.com") {
    return () => {};
  }
  const existing = controllers.get(document);
  if (existing) {
    return existing;
  }
  const Observer = document.defaultView?.MutationObserver;
  if (!Observer || !document.documentElement) {
    return () => {};
  }

  let active = true;
  let scheduled = false;
  const pending = new Set<Element>();

  function cleanAnchor(anchor: Element): void {
    if (!anchor.closest(ASSISTANT_SELECTOR) || anchor.closest(EDITABLE_SELECTOR)) {
      return;
    }
    const href = anchor.getAttribute("href");
    if (href === null) {
      return;
    }
    const cleaned = cleanChatGptLink(href);
    if (cleaned !== href) {
      anchor.setAttribute("href", cleaned);
    }
  }

  function scan(root: Element): void {
    if (root.matches("a[href]")) {
      cleanAnchor(root);
    }
    for (const anchor of root.querySelectorAll("a[href]")) {
      cleanAnchor(anchor);
    }
  }

  const observer = new Observer((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        pending.add(record.target as Element);
      } else {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) {
            pending.add(node as Element);
          }
        }
      }
    }
    if (!pending.size || scheduled) {
      return;
    }
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (active) {
        for (const root of pending) {
          if (root.isConnected) {
            scan(root);
          }
        }
      }
      pending.clear();
    });
  });

  const stop = () => {
    active = false;
    observer.disconnect();
    pending.clear();
    controllers.delete(document);
  };
  controllers.set(document, stop);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["href"]
  });
  scan(document.documentElement);
  return stop;
}
