// Keep source-specific rules here, independently of formula and copy features.
const TRACKING_SOURCES = new Map([
  ["utm_source", new Set(["chatgpt.com", "chat.openai.com"])]
]);
const ASSISTANT_SELECTOR =
  '[data-markdown-text-style="assistant-message"], [data-message-author-role="assistant"]';
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';
const USER_SELECTOR = '[data-message-author-role="user"], [data-turn="user"]';
const PREVIEW_SELECTOR =
  '[data-radix-popper-content-wrapper], [data-radix-portal], [role="tooltip"], [role="dialog"]';
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
  const cleanedTargets = new WeakMap<Element, string>();

  function isCleanupScope(element: Element): boolean {
    return Boolean(element.closest(ASSISTANT_SELECTOR) || element.closest(PREVIEW_SELECTOR)) &&
      !element.closest(EDITABLE_SELECTOR) && !element.closest(USER_SELECTOR);
  }

  function cleanAnchor(anchor: Element): void {
    if (!isCleanupScope(anchor)) {
      return;
    }
    const href = anchor.getAttribute("href");
    if (href === null) {
      return;
    }
    const cleaned = cleanChatGptLink(href);
    if (cleaned !== href) {
      cleanedTargets.set(anchor, cleaned);
      anchor.setAttribute("href", cleaned);
    }
    const title = anchor.getAttribute("title");
    if (title !== null) {
      const cleanedTitle = cleanChatGptLink(title);
      if (cleanedTitle !== title) {
        anchor.setAttribute("title", cleanedTitle);
        // Preview cards can already have a clean href while their title still
        // exposes the original address retained by the page's click handler.
        if (cleanedTitle === cleaned) {
          cleanedTargets.set(anchor, cleaned);
        }
      }
    }
  }

  // ChatGPT's delegated handlers can navigate using an original URL retained in
  // component state. Keep the browser's native link action (including modifiers,
  // target, middle-click, and keyboard activation), but skip those page handlers.
  function handleActivation(event: Event): void {
    const target = event.target as Element | null;
    const anchor = target?.closest?.("a[href]");
    if (!anchor || !isCleanupScope(anchor)) {
      return;
    }
    cleanAnchor(anchor);
    if (cleanedTargets.has(anchor) && cleanedTargets.get(anchor) === anchor.getAttribute("href")) {
      event.stopImmediatePropagation();
    }
  }

  function cleanPreviewText(root: Element): void {
    if (root.matches("script, style") || root.closest(EDITABLE_SELECTOR) || root.closest(USER_SELECTOR)) {
      return;
    }
    for (const child of root.childNodes) {
      if (child.nodeType === 1) {
        cleanPreviewText(child as Element);
      } else if (child.nodeType === 3 && root.closest(PREVIEW_SELECTOR)) {
        const text = child.nodeValue || "";
        const trimmed = text.trim();
        const cleaned = cleanChatGptLink(trimmed);
        if (cleaned !== trimmed) {
          child.nodeValue = text.replace(trimmed, cleaned);
        }
      }
    }
  }

  function scan(root: Element): void {
    if (root.matches("a[href]")) {
      cleanAnchor(root);
    }
    for (const anchor of root.querySelectorAll("a[href]")) {
      cleanAnchor(anchor);
    }
    if (root.closest(PREVIEW_SELECTOR)) {
      cleanPreviewText(root);
    } else {
      for (const preview of root.querySelectorAll(PREVIEW_SELECTOR)) {
        cleanPreviewText(preview);
      }
    }
  }

  const observer = new Observer((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        pending.add(record.target as Element);
      } else if (record.type === "characterData") {
        if (record.target.parentElement?.closest(PREVIEW_SELECTOR)) {
          pending.add(record.target.parentElement);
        }
      } else {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) {
            pending.add(node as Element);
          } else if (node.parentElement?.closest(PREVIEW_SELECTOR)) {
            pending.add(node.parentElement);
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
    document.defaultView?.removeEventListener("click", handleActivation, true);
    document.defaultView?.removeEventListener("auxclick", handleActivation, true);
    pending.clear();
    controllers.delete(document);
  };
  controllers.set(document, stop);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["href", "title"]
  });
  document.defaultView?.addEventListener("click", handleActivation, true);
  document.defaultView?.addEventListener("auxclick", handleActivation, true);
  scan(document.documentElement);
  return stop;
}
