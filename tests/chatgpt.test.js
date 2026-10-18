const assert = require("node:assert/strict");
const test = require("node:test");
const {
  COPYTEX_RESPONSE_COPY_ATTRIBUTE,
  injectResponseCopyButtons,
  isChatGptHost,
  serializeChatGptTurnToMarkdown
} = require("../.test-build/chatgpt.cjs");
const extractor = require("../.test-build/extractor.cjs");
const selectionSerializer = require("../.test-build/selection.cjs");

class ElementStub {
  constructor(tagName, attributes = {}, children = []) {
    this.tagName = tagName;
    this.nodeType = 1;
    this.attributes = { ...attributes };
    this.className = attributes.className || attributes.class || "";
    this.children = [];
    this.childNodes = this.children;
    this.parentElement = null;
    this.parentNode = null;
    this.listeners = {};
    this.style = {};
    this._textContent = attributes.textContent || "";

    for (const child of children) {
      this.append(child);
    }
  }

  append(child) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return this;
  }

  appendChild(child) {
    this.append(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentElement = null;
      child.parentNode = null;
    }
    return child;
  }

  contains(target) {
    let cursor = target;
    while (cursor) {
      if (cursor === this) {
        return true;
      }
      cursor = cursor.parentElement || cursor.parentNode;
    }
    return false;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  click() {
    if (this.listeners.click) {
      this.listeners.click({
        preventDefault() {},
        stopPropagation() {}
      });
    }
  }

  cloneNode(deep) {
    return new ElementStub(
      this.tagName,
      this.attributes,
      deep ? this.children.map((child) => child.cloneNode(true)) : []
    );
  }

  closest(selector) {
    let cursor = this;
    while (cursor) {
      if (cursor.matches(selector)) {
        return cursor;
      }
      cursor = cursor.parentElement;
    }
    return null;
  }

  getAttribute(name) {
    return this.attributes[name] || "";
  }

  get textContent() {
    return this._textContent || this.childNodes.map((child) => child.textContent || "").join("");
  }

  set textContent(value) {
    this._textContent = String(value || "");
  }

  insertAdjacentElement(position, element) {
    assert.equal(position, "afterend");
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    element.parentElement = this.parentElement;
    element.parentNode = this.parentElement;
    siblings.splice(index + 1, 0, element);
  }

  matches(selector) {
    if (selector === ".markdown") {
      return hasClass(this, "markdown");
    }

    if (selector === '[role="math"][data-math-source]') {
      return this.getAttribute("role") === "math" && Boolean(this.getAttribute("data-math-source"));
    }

    if (selector === '[data-client-katex-layout][data-math-source]') {
      return Boolean(this.getAttribute("data-math-source"));
    }

    const tagAttributeMatch = selector.match(/^([a-z][\w-]*)\[([\w-]+)="([^"]+)"\]$/i);
    if (tagAttributeMatch) {
      return (
        this.tagName.toLowerCase() === tagAttributeMatch[1].toLowerCase() &&
        this.getAttribute(tagAttributeMatch[2]) === tagAttributeMatch[3]
      );
    }

    const attributePresenceMatch = selector.match(/^\[([^=\]]+)\]$/);
    if (attributePresenceMatch) {
      return Boolean(this.getAttribute(attributePresenceMatch[1]));
    }

    const attributeMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    if (attributeMatch) {
      return this.getAttribute(attributeMatch[1]) === attributeMatch[2];
    }

    if (selector === '[data-message-author-role="assistant"] .markdown') {
      return hasClass(this, "markdown") && Boolean(this.closest('[data-message-author-role="assistant"]'));
    }

    if (selector === 'button[data-testid="copy-turn-action-button"]') {
      return (
        this.tagName.toLowerCase() === "button" &&
        this.getAttribute("data-testid") === "copy-turn-action-button"
      );
    }

    if (selector === 'section[data-testid^="conversation-turn-"][data-turn="assistant"]') {
      return (
        this.tagName.toLowerCase() === "section" &&
        this.getAttribute("data-testid").startsWith("conversation-turn-") &&
        this.getAttribute("data-turn") === "assistant"
      );
    }

    if (selector === 'section[data-testid^="conversation-turn-"]') {
      return (
        this.tagName.toLowerCase() === "section" &&
        this.getAttribute("data-testid").startsWith("conversation-turn-")
      );
    }

    if (selector === '[role="group"]') {
      return this.getAttribute("role") === "group";
    }

    if (selector.startsWith(".")) {
      return hasClass(this, selector.slice(1));
    }

    if (selector === ".katex-mathml annotation") {
      return this.matches("annotation") && Boolean(this.closest(".katex-mathml"));
    }

    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    const matches = [];
    walk(this, (node) => {
      if (node.matches && node.matches(selector)) {
        matches.push(node);
      }
    });
    return matches;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") {
      this.className = String(value);
    }
  }
}

class TextStub {
  constructor(value) {
    this.nodeType = 3;
    this.nodeValue = value;
    this.textContent = value;
    this.parentElement = null;
    this.parentNode = null;
  }

  cloneNode() {
    return new TextStub(this.nodeValue);
  }
}

function walk(node, visit) {
  for (const child of node.childNodes || []) {
    visit(child);
    walk(child, visit);
  }
}

function hasClass(node, className) {
  return String(node.className || "")
    .split(/\s+/)
    .includes(className);
}

function el(tagName, attributes, children = []) {
  return new ElementStub(tagName, attributes, children);
}

function text(value) {
  return new TextStub(value);
}

function turn(role) {
  return new ElementStub("section", {
    "data-testid": role === "assistant" ? "conversation-turn-1" : "conversation-turn-2",
    "data-turn": role
  }, [
    new ElementStub("div", {}, [
      new ElementStub("button", {
        "data-testid": "copy-turn-action-button",
        "aria-label": "Copy message",
        "data-state": "closed"
      })
    ])
  ]);
}

function assistantTurnWithMarkdown(children) {
  return el("section", {
    "data-testid": "conversation-turn-1",
    "data-turn": "assistant"
  }, [
    el("div", { "data-message-author-role": "assistant" }, [
      el("div", { className: "markdown prose" }, children)
    ])
  ]);
}

function latestAssistantTurnWithMarkdown(children) {
  return el("section", {
    "data-testid": "conversation-turn-1"
  }, [
    el("div", { "data-message-author-role": "assistant" }, [
      el("div", { className: "markdown prose" }, children)
    ]),
    el("div", { role: "group" }, [
      el("button", {
        "data-testid": "copy-turn-action-button",
        "aria-label": "Copy response",
        "data-state": "closed"
      })
    ])
  ]);
}

function latestAssistantTurnBeforeActions(children) {
  return el("section", {
    "data-testid": "conversation-turn-1"
  }, [
    el("div", { "data-message-author-role": "assistant" }, [
      el("div", { className: "markdown prose" }, children)
    ])
  ]);
}

function misplacedResponseCopyButton() {
  return el("button", {
    [COPYTEX_RESPONSE_COPY_ATTRIBUTE]: "true"
  }, [
    el("span", { className: "copytex-response-copy-label" }, [text("TeX")])
  ]);
}

function newAssistantExchange(children, options = {}) {
  const {
    nativeCopyLabel = "Copy",
    withNativeCopy = true,
    includeCodeCopyButton = false
  } = options;

  const messageChildren = includeCodeCopyButton
    ? children.concat([
        el("pre", {}, [
          el("div", { className: "flex items-center justify-between" }, [
            el("button", { "aria-label": "Copy", type: "button" })
          ]),
          el("code", {}, [text("x = 1")])
        ])
      ])
    : children;

  const userBlock = el("div", { className: "block-BQZwFn" }, [
    el("h4", { className: "sr-only m-0 select-none" }, [text("You said:")]),
    el("div", { className: "flex flex-col items-end gap-2" }, [
      el("div", { "data-content-search-unit-key": "turn-1:0:user", className: "w-full" }, [
        el("div", { className: "flex flex-row-reverse items-center gap-1" }, [
          el("div", { className: "flex turn-action-controls items-center gap-0.5" }, [
            el("span", { className: "contents" }, [
              el("button", { "aria-label": "Copy message", type: "button" })
            ])
          ])
        ])
      ])
    ])
  ]);

  const assistantBlock = el("div", { className: "block-BQZwFn" }, [
    el("span", { "data-chatgpt-agent-turn-start": "", hidden: "" }),
    el("div", { "data-content-search-unit-key": "turn-1:2:assistant" }, [
      el("h4", { className: "sr-only m-0 select-none" }, [text("ChatGPT said:")]),
      el("div", { className: "group flex min-w-0 flex-col" }, [
        el(
          "div",
          {
            "data-markdown-text-style": "assistant-message",
            className: "MarkdownRoot-rZKhxa"
          },
          messageChildren
        )
      ])
    ])
  ]);

  const actionButtons = [
    el("span", { className: "contents" }, [
      el("button", { "aria-label": "Rate response", type: "button" })
    ])
  ];
  if (withNativeCopy) {
    actionButtons.unshift(
      el("span", { className: "contents" }, [
        el("button", { "aria-label": nativeCopyLabel, type: "button" })
      ])
    );
  }

  const turnBody = el("div", { className: "group flex flex-col pb-2 pt-2" }, [
    el("div", { className: "flex flex-col gap-3 browser:gap-1" }, [userBlock, assistantBlock]),
    el("div", { className: "mt-1.5 flex turn-action-controls h-5 items-center gap-0.5" }, [
      el("div", { className: "flex h-full items-center gap-0.5" }, actionButtons)
    ])
  ]);

  return el("div", { "data-turn-key": "turn-1" }, [
    el("div", { "data-content-search-turn-key": "turn-1", className: "flex flex-col gap-1.5" }, [
      el("div", { className: "contents" }, [
        el("div", { className: "contents" }, [turnBody])
      ])
    ])
  ]);
}

function newAssistantNativeCopyButton(exchange) {
  const turnBody = exchange.children[0].children[0].children[0].children[0];
  const actionBar = turnBody.children[1];
  return actionBar.children[0].children[0].children[0];
}

function inlineFormula(latex) {
  return el("span", { className: "katex" }, [
    el("span", { className: "katex-mathml" }, [
      el("annotation", {
        encoding: "application/x-tex",
        textContent: latex
      }, [text(latex)])
    ]),
    el("span", { className: "katex-html" }, [text("rendered")])
  ]);
}

function displayFormula(latex) {
  return el("span", { className: "katex-display" }, [inlineFormula(latex)]);
}

function chatGptMathSourceFormula(latex, displayMode = false) {
  const katex = el("span", { className: "katex" }, [
    el("span", { className: "katex-html", "aria-hidden": "true" }, [text("rendered")])
  ]);
  const content = displayMode
    ? [el("span", { className: "katex-display" }, [katex])]
    : [katex];

  return el("span", {
    role: "math",
    "data-math-source": latex,
    "data-client-katex-layout": "",
    style: displayMode ? "display:block" : ""
  }, content);
}

test("detects ChatGPT hosts", () => {
  assert.equal(isChatGptHost("chatgpt.com"), true);
  assert.equal(isChatGptHost("chat.openai.com"), true);
  assert.equal(isChatGptHost("chat.deepseek.com"), false);
});

test("injects response copy buttons into assistant turns only", () => {
  const root = new ElementStub("main", {}, [turn("assistant"), turn("user")]);

  assert.equal(injectResponseCopyButtons(root, () => {}), 1);
  assert.equal(root.querySelectorAll(`[${COPYTEX_RESPONSE_COPY_ATTRIBUTE}="true"]`).length, 1);

  const assistantActions = root.children[0].children[0].children;
  const userActions = root.children[1].children[0].children;
  assert.equal(assistantActions.length, 2);
  assert.equal(userActions.length, 1);
  assert.equal(assistantActions[1].getAttribute(COPYTEX_RESPONSE_COPY_ATTRIBUTE), "true");
  assert.equal(assistantActions[1].getAttribute("data-testid"), "");
  assert.equal(assistantActions[1].getAttribute("aria-label"), "Copy message with ChatPatch");
  assert.match(assistantActions[1].innerHTML, /TeX/);
});

test("does not inject duplicate response copy buttons", () => {
  const root = new ElementStub("main", {}, [turn("assistant")]);

  assert.equal(injectResponseCopyButtons(root, () => {}), 1);
  assert.equal(injectResponseCopyButtons(root, () => {}), 0);
  assert.equal(root.children[0].children[0].children.length, 2);
});

test("injects response copy buttons into latest ChatGPT assistant turns without data-turn", () => {
  const root = new ElementStub("main", {}, [
    latestAssistantTurnWithMarkdown([el("p", {}, [text("Assistant")])])
  ]);

  assert.equal(injectResponseCopyButtons(root, () => {}), 1);
  assert.equal(root.querySelectorAll(`[${COPYTEX_RESPONSE_COPY_ATTRIBUTE}="true"]`).length, 1);
});

test("waits for the native ChatGPT response copy button before injecting", () => {
  const root = new ElementStub("main", {}, [
    latestAssistantTurnBeforeActions([el("p", {}, [text("Assistant")])])
  ]);

  assert.equal(injectResponseCopyButtons(root, () => {}), 0);
  assert.equal(root.querySelectorAll(`[${COPYTEX_RESPONSE_COPY_ATTRIBUTE}="true"]`).length, 0);
});

test("reinjects response copy buttons when native marker remains but CopyTeX button is missing", () => {
  const root = new ElementStub("main", {}, [turn("assistant")]);
  const nativeButton = root.children[0].children[0].children[0];
  nativeButton.setAttribute("data-copytex-response-copy-injected", "true");

  assert.equal(injectResponseCopyButtons(root, () => {}), 1);
  assert.equal(root.querySelectorAll(`[${COPYTEX_RESPONSE_COPY_ATTRIBUTE}="true"]`).length, 1);
});

test("repairs misplaced response copy buttons after ChatGPT action bar changes", () => {
  const misplacedButton = misplacedResponseCopyButton();
  const turnNode = latestAssistantTurnWithMarkdown([el("p", {}, [text("Assistant")])]);
  turnNode.children.splice(0, 0, misplacedButton);
  misplacedButton.parentElement = turnNode;
  misplacedButton.parentNode = turnNode;
  const root = new ElementStub("main", {}, [turnNode]);

  assert.equal(injectResponseCopyButtons(root, () => {}), 1);

  const copyTeXButtons = root.querySelectorAll(`[${COPYTEX_RESPONSE_COPY_ATTRIBUTE}="true"]`);
  const actionButtons = turnNode.querySelectorAll('[role="group"]')[0].children;
  assert.equal(copyTeXButtons.length, 1);
  assert.equal(actionButtons[0].getAttribute("data-testid"), "copy-turn-action-button");
  assert.equal(actionButtons[1].getAttribute(COPYTEX_RESPONSE_COPY_ATTRIBUTE), "true");
});

test("response copy button calls handler without clicking the native button", () => {
  const root = new ElementStub("main", {}, [turn("assistant")]);
  let calledWith = null;
  let nativeClicked = false;

  injectResponseCopyButtons(root, (nativeButton) => {
    calledWith = nativeButton;
  });

  const nativeButton = root.children[0].children[0].children[0];
  nativeButton.addEventListener("click", () => {
    nativeClicked = true;
  });
  const copyTeXButton = root.children[0].children[0].children[1];
  copyTeXButton.click();

  assert.equal(calledWith, nativeButton);
  assert.equal(nativeClicked, false);
});

test("injects response copy buttons next to the latest ChatGPT native copy button", () => {
  const exchange = newAssistantExchange([el("p", {}, [text("Assistant")])]);
  const root = new ElementStub("main", {}, [exchange]);

  assert.equal(injectResponseCopyButtons(root, () => {}), 1);
  assert.equal(root.querySelectorAll(`[${COPYTEX_RESPONSE_COPY_ATTRIBUTE}="true"]`).length, 1);

  const buttons = root.querySelectorAll("button");
  const nativeCopyButton = buttons.find(
    (button) => button.getAttribute("aria-label") === "Copy"
  );
  const copyTeXButton = buttons.find(
    (button) => button.getAttribute(COPYTEX_RESPONSE_COPY_ATTRIBUTE) === "true"
  );
  assert.equal(nativeCopyButton, newAssistantNativeCopyButton(exchange));
  assert.equal(copyTeXButton.parentElement, nativeCopyButton.parentElement);
  assert.equal(copyTeXButton.parentElement.children[0], nativeCopyButton);
  assert.equal(copyTeXButton.getAttribute("data-testid"), "");
  assert.equal(copyTeXButton.getAttribute("aria-label"), "Copy message with ChatPatch");
  assert.match(copyTeXButton.innerHTML, /TeX/);

  const userCopyButton = buttons.find(
    (button) => button.getAttribute("aria-label") === "Copy message"
  );
  assert.equal(userCopyButton.getAttribute(COPYTEX_RESPONSE_COPY_ATTRIBUTE), "");
  assert.equal(userCopyButton.children.length, 0);
});

test("does not duplicate response copy buttons in the latest ChatGPT DOM", () => {
  const exchange = newAssistantExchange([el("p", {}, [text("Assistant")])]);
  const root = new ElementStub("main", {}, [exchange]);

  assert.equal(injectResponseCopyButtons(root, () => {}), 1);
  assert.equal(injectResponseCopyButtons(root, () => {}), 0);
  assert.equal(root.querySelectorAll(`[${COPYTEX_RESPONSE_COPY_ATTRIBUTE}="true"]`).length, 1);
});

test("ignores ChatGPT code block copy buttons when injecting", () => {
  const exchange = newAssistantExchange([el("p", {}, [text("Assistant")])], {
    includeCodeCopyButton: true
  });
  const root = new ElementStub("main", {}, [exchange]);

  assert.equal(injectResponseCopyButtons(root, () => {}), 1);

  const copyButtons = root
    .querySelectorAll("button")
    .filter((button) => button.getAttribute("aria-label") === "Copy");
  assert.equal(copyButtons.length, 2);
  assert.equal(
    Boolean(copyButtons[0].closest('[data-markdown-text-style="assistant-message"]')),
    true
  );
  assert.equal(copyButtons[0].getAttribute(COPYTEX_RESPONSE_COPY_ATTRIBUTE), "");

  const copyTeXButton = root.querySelectorAll(
    `[${COPYTEX_RESPONSE_COPY_ATTRIBUTE}="true"]`
  )[0];
  assert.equal(copyTeXButton.parentElement.children[0], copyButtons[1]);
  assert.equal(copyTeXButton.parentElement.children.length, 2);
});

test("waits for the latest ChatGPT native copy button before injecting", () => {
  const exchange = newAssistantExchange([el("p", {}, [text("Assistant")])], {
    withNativeCopy: false
  });
  const root = new ElementStub("main", {}, [exchange]);

  assert.equal(injectResponseCopyButtons(root, () => {}), 0);
  assert.equal(root.querySelectorAll(`[${COPYTEX_RESPONSE_COPY_ATTRIBUTE}="true"]`).length, 0);
});

test("matches the injected button size to the latest ChatGPT native button", () => {
  const exchange = newAssistantExchange([el("p", {}, [text("Assistant")])]);
  const root = new ElementStub("main", {}, [exchange]);
  const nativeCopyButton = newAssistantNativeCopyButton(exchange);
  nativeCopyButton.getBoundingClientRect = () => ({ width: 20, height: 20 });

  assert.equal(injectResponseCopyButtons(root, () => {}), 1);

  const copyTeXButton = root.querySelectorAll(
    `[${COPYTEX_RESPONSE_COPY_ATTRIBUTE}="true"]`
  )[0];
  assert.equal(copyTeXButton.style.minWidth, "20px");
  assert.equal(copyTeXButton.style.height, "20px");
});

test("serializes the latest ChatGPT assistant message DOM", () => {
  const exchange = newAssistantExchange([
    el("p", {}, [text("Inline "), inlineFormula("E = mc^2"), text(".")]),
    displayFormula("\\int_0^1 x\\,dx")
  ]);

  const result = serializeChatGptTurnToMarkdown(exchange, extractor, selectionSerializer);

  assert.deepEqual(result, {
    ok: true,
    text: "Inline $E = mc^2$.\n\n$$\n\\int_0^1 x\\,dx\n$$"
  });
});

test("serializes common ChatGPT Markdown DOM", () => {
  const turnNode = assistantTurnWithMarkdown([
    el("h2", {}, [text("Heading")]),
    el("p", {}, [
      el("strong", {}, [text("Bold")]),
      text(" and "),
      el("em", {}, [text("em")]),
      text(" with "),
      el("a", { href: "https://example.com" }, [text("link")]),
      text(" and "),
      el("code", {}, [text("x = 1")])
    ]),
    el("ul", {}, [
      el("li", {}, [text("first")]),
      el("li", {}, [text("second")])
    ]),
    el("blockquote", {}, [
      el("p", {}, [text("quoted")])
    ]),
    el("pre", {}, [
      el("code", { className: "language-js" }, [text("const x = '$5';")])
    ]),
    el("hr")
  ]);

  const result = serializeChatGptTurnToMarkdown(
    turnNode,
    extractor,
    selectionSerializer
  );

  assert.deepEqual(result, {
    ok: true,
    text: [
      "## Heading",
      "",
      "**Bold** and *em* with [link](https://example.com) and `x = 1`",
      "",
      "- first",
      "- second",
      "",
      "> quoted",
      "",
      "```js",
      "const x = '$5';",
      "```",
      "",
      "---"
    ].join("\n")
  });
});

test("serializes ChatGPT KaTeX formulas using Markdown output", () => {
  const turnNode = assistantTurnWithMarkdown([
    el("p", {}, [
      text("Inline "),
      inlineFormula("E = mc^2"),
      text(".")
    ]),
    displayFormula("\\int_0^1 x\\,dx")
  ]);

  const result = serializeChatGptTurnToMarkdown(turnNode, extractor, selectionSerializer);

  assert.deepEqual(result, {
    ok: true,
    text: "Inline $E = mc^2$.\n\n$$\n\\int_0^1 x\\,dx\n$$"
  });
});

test("serializes latest ChatGPT data-math-source formulas using Markdown output", () => {
  const turnNode = latestAssistantTurnWithMarkdown([
    el("p", {}, [
      text("Score "),
      chatGptMathSourceFormula("r_\\theta(x,y)"),
      text(".")
    ]),
    chatGptMathSourceFormula("L=-\\log\\sigma(r_\\theta(x,y_w)-r_\\theta(x,y_l))", true)
  ]);

  const result = serializeChatGptTurnToMarkdown(turnNode, extractor, selectionSerializer);

  assert.deepEqual(result, {
    ok: true,
    text:
      "Score $r_\\theta(x,y)$.\n\n" +
      "$$\nL=-\\log\\sigma(r_\\theta(x,y_w)-r_\\theta(x,y_l))\n$$"
  });
});

test("serializes ChatGPT KaTeX formulas using LaTeX output", () => {
  const turnNode = assistantTurnWithMarkdown([
    el("p", {}, [
      text("Inline "),
      inlineFormula("E = mc^2"),
      text(".")
    ]),
    displayFormula("\\int_0^1 x\\,dx")
  ]);

  const result = serializeChatGptTurnToMarkdown(
    turnNode,
    extractor,
    selectionSerializer,
    { outputFormat: "latex" }
  );

  assert.deepEqual(result, {
    ok: true,
    text: "Inline \\(E = mc^2\\).\n\n\\[\n\\int_0^1 x\\,dx\n\\]"
  });
});

test("serializes tables", () => {
  const turnNode = assistantTurnWithMarkdown([
    el("table", {}, [
      el("tr", {}, [el("th", {}, [text("A")]), el("th", {}, [text("B")])]),
      el("tr", {}, [el("td", {}, [text("1")]), el("td", {}, [text("2")])])
    ])
  ]);

  const result = serializeChatGptTurnToMarkdown(turnNode, extractor, selectionSerializer);

  assert.deepEqual(result, {
    ok: true,
    text: "| A | B |\n| --- | --- |\n| 1 | 2 |"
  });
});

test("reports missing ChatGPT response content", () => {
  const result = serializeChatGptTurnToMarkdown(turn("assistant"), extractor, selectionSerializer);

  assert.deepEqual(result, {
    ok: false,
    text: "",
    error: "No response content found"
  });
});
