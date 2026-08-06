// Socket fleet — Playwright MCP page-init script.
//
// Injected into every page the agent-driven browser opens (wired via
// --init-script in .mcp.json), this draws a corner ribbon — the same shape as
// socket.dev staging's STAGING badge — so a human glancing at the window can
// always tell the tab is under agent control. The badge is the Socket shield
// in the brand gradient with the Playwright masks as the cutout silhouette.
// Click the ribbon to hide it for that page.
;(() => {
  'use strict'
  if (window.top !== window) {
    return
  }
  const MARK = 'data-socket-agent-banner'
  const SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" aria-label="Socket agent browser" viewBox="-6.527 2.221 32.279 32.279"><defs><linearGradient id="a" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#f0a"/><stop offset="100%" stop-color="#8c50ff"/></linearGradient></defs><path fill="url(#a)" d="M18.44 8.84c.46.16.76.6.76 1.1-.04 3.58.23 8.63-.38 10.88-1.04 4.5-4.42 8.4-8.8 10.1a1.2 1.2 0 0 1-.84 0C4.52 29.15.92 24.73.18 19.8c-.06-.31-.1-.67-.13-.98-.04-.2-.05-1.14-.05-5.17V9.91a1.15 1.15 0 0 1 .76-1.07c2.8-1.02 5.38-1.93 8.2-2.96l.24-.1q.38-.12.77 0l2.24.81z" data-socket-layer="shield"/><g fill="#fff" data-socket-layer="playwright-silhouette"><path d="M8.07 20.57v-.96l-2.68.76s.2-1.15 1.6-1.55q.63-.17 1.08-.06v-3.94H9.4a8 8 0 0 0-.4-1.04c-.2-.4-.4-.14-.85.25-.32.26-1.13.84-2.36 1.17-1.22.32-2.2.24-2.62.17-.58-.1-.89-.23-.86.21q.03.6.34 1.8c.46 1.74 1.99 5.09 4.87 4.3.76-.2 1.3-.6 1.66-1.1zm-4.32-3.16 2.06-.54s-.06.78-.83.99-1.23-.45-1.23-.45"/><path d="M15.8 14.86c-.54.1-1.82.21-3.4-.21s-2.64-1.17-3.05-1.52c-.6-.49-.85-.83-1.1-.31q-.36.68-.8 2.24c-.6 2.26-1.06 7.03 2.68 8.03s5.74-3.35 6.34-5.6q.4-1.58.44-2.35c.03-.58-.36-.41-1.12-.28m-7.52 1.87s.6-.92 1.6-.63c1 .28 1.07 1.39 1.07 1.39zm2.44 4.12c-1.76-.52-2.03-1.92-2.03-1.92l4.73 1.32s-.95 1.1-2.7.6m1.67-2.89s.6-.91 1.6-.63 1.07 1.4 1.07 1.4z"/><path d="m7.13 19.88-1.74.49s.2-1.08 1.47-1.5l-.98-3.7-.09.02c-1.22.33-2.2.25-2.62.17-.58-.1-.89-.22-.86.22q.03.6.33 1.8c.47 1.74 2 5.09 4.88 4.3l.09-.02zM3.75 17.4l2.06-.54s-.06.78-.83.99-1.23-.45-1.23-.45"/><path d="m10.8 20.87-.09-.02c-1.76-.52-2.03-1.92-2.03-1.92l2.44.68 1.3-4.96h-.02c-1.59-.43-2.64-1.17-3.05-1.51-.6-.5-.85-.84-1.1-.32q-.36.69-.8 2.24c-.6 2.26-1.06 7.03 2.68 8.03l.08.02zm-2.53-4.14s.6-.92 1.6-.63c1 .28 1.07 1.39 1.07 1.39z"/><path d="m7.22 19.85-.47.13q.15.94.61 1.75l.16-.04q.21-.06.4-.14a5 5 0 0 1-.7-1.7m-.18-4.38c-.24.9-.46 2.19-.4 3.48q.15-.08.34-.13l.09-.02c-.1-1.38.12-2.78.38-3.74l.2-.67-.35.2q-.13.4-.26.88"/></g></svg>`
  const insert = () => {
    if (!document.body || document.querySelector('[' + MARK + ']')) {
      return
    }
    const host = document.createElement('div')
    host.setAttribute(MARK, '')
    // A closed shadow root so page CSS cannot restyle the ribbon and the
    // ribbon's CSS cannot leak into the page.
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML =
      '<style>' +
      ':host{position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none}' +
      '.ribbon{position:fixed;top:26px;left:-34px;transform:rotate(-45deg);' +
      'display:flex;align-items:center;justify-content:center;gap:3px;' +
      'width:150px;padding:4px 0;pointer-events:auto;cursor:pointer;' +
      'background:#fde8f3;border:1px solid rgba(140,80,255,.35);' +
      'box-shadow:0 2px 6px rgba(0,0,0,.25);' +
      'font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.08em;' +
      'user-select:none}' +
      // The shield rides the ribbon's -45° tilt (no counter-rotation) so it
      // leans with the band instead of standing upright inside it. Oversized
      // against the band's height on purpose — it overhangs the ribbon edges
      // and the drop shadow lifts it off the strip.
      '.ribbon svg{width:28px;height:28px;' +
      'filter:drop-shadow(0 1px 2px rgba(0,0,0,.35)) drop-shadow(0 2px 6px rgba(140,80,255,.45))}' +
      // Deep Socket purple for the label, darkening along the run.
      '.label{background:linear-gradient(90deg,#8c50ff,#6d28d9);' +
      '-webkit-background-clip:text;background-clip:text;color:transparent}' +
      '</style>' +
      '<div class="ribbon" title="Click to hide — this browser is agent-driven (Playwright MCP)">' +
      SHIELD +
      '<span class="label">AGENT</span>' +
      '</div>'
    root.querySelector('.ribbon').addEventListener('click', () => host.remove())
    document.body.appendChild(host)
  }
  // Both paths on purpose: at init-script time the pre-navigation document
  // (about:blank) may already carry a body that the real page then replaces,
  // so the early insert alone can be wiped. The dedupe in insert() makes the
  // second call a no-op when the first one survived.
  if (document.body) {
    insert()
  }
  document.addEventListener('DOMContentLoaded', insert, { once: true })
})()
