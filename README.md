# ChatPatch

Small improvements for a better web chatbot experience.

## Features

- Copy rendered formulas as Markdown or LaTeX, with support for KaTeX, MathJax,
  and MediaWiki math on supported pages. Use selection, hover, or context-menu
  copying, or copy a ChatGPT response with its formulas preserved.
- Automatically clean ChatGPT source tracking from links in assistant responses,
  including newly streamed content. Other parameters, paths, fragments, and
  link text are preserved.

Link cleanup removes `utm_source=chatgpt.com` and
`utm_source=chat.openai.com` (source values are case-insensitive).
For example, `https://aegisub.org/?utm_source=chatgpt.com` becomes
`https://aegisub.org`. Clicking, copying a link address, and copying a response
with TeX use the cleaned link target. Cleanup is enabled by default on
`chatgpt.com` and `chat.openai.com` and runs independently of formula copying.

## Preview

<p align="center">
  <img src="assets/hover.png" alt="ChatPatch formula hover copy button" width="760">
</p>

<p align="center"><sub>Hover copy control on a rendered formula.</sub></p>

<p align="center">
  <img src="assets/popup.png" alt="Formula output format settings" width="320">
</p>

<p align="center"><sub>Output format settings, shown in an earlier version.</sub></p>

## Installation

This extension is only tested on Chrome.

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Build the extension:

   ```powershell
   npm run build
   ```

3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Click `Load unpacked`.
6. Select the generated `dist/` folder.
7. Open or reload a supported site and test on a response containing rendered math.

To create a distributable zip, run:

```powershell
npm run package
```

The package is written to `release/chatpatch-v<version>.zip`.

## Supported Sites

- `https://chatgpt.com/`
- `https://chat.openai.com/`
- `https://chat.deepseek.com/`
- `https://www.zhihu.com/`
- `https://zhuanlan.zhihu.com/`
- `https://*.wikipedia.org/`
