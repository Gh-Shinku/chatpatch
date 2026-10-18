# CopyTeX

An extension that copies KaTeX, MathJax, and MediaWiki-rendered formulas as Markdown or LaTeX on supported web pages.

## Preview

<p align="center">
  <img src="assets/hover.png" alt="CopyTeX hover copy button" width="760">
</p>

<p align="center"><sub>Hover copy control on a rendered formula.</sub></p>

<p align="center">
  <img src="assets/popup.png" alt="CopyTeX extension popup" width="320">
</p>

<p align="center"><sub>Extension popup for output format settings.</sub></p>

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

The package is written to `release/copytex-v<version>.zip`.

## Supported Sites

On ChatGPT (`chatgpt.com` and `chat.openai.com`), the extension also automatically
cleans links in assistant responses, including newly streamed content. It removes
`utm_source=chatgpt.com` and `utm_source=chat.openai.com` (source values are
case-insensitive), while preserving other query parameters, paths, and fragments.
For example, `https://aegisub.org/?utm_source=chatgpt.com` becomes
`https://aegisub.org`. Link text is unchanged. Clicking, copying a link address,
and copying a response with TeX use the cleaned link target. This feature runs
independently of formula extraction and copying and is enabled by default.

- `https://chatgpt.com/`
- `https://chat.deepseek.com/`
- `https://www.zhihu.com/`
- `https://zhuanlan.zhihu.com/`
- `https://*.wikipedia.org/`
