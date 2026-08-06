// Socket fleet — challenge holding screen.
//
// Injected by pauseForChallenge (publish-infra/npm/browser-session.mts) on
// every pause tick while a Cloudflare human-verification challenge holds the
// npm page. It dresses the wait in the Socket admin sign-in theme — dark
// backdrop band, the agent shield bouncing, staggered blur-in copy — so the
// operator lands on a branded "the agent is waiting for you" screen instead
// of a bare vendor page. The band sits at the top and never covers the
// challenge widget below; click it to hide. The SHIELD literal is generated:
// scripts/repo/gen/playwright-banner.mts inlines the brand shield here and in
// agent-banner.js from one composition.
;(() => {
  'use strict'
  if (window.top !== window) {
    return
  }
  const MARK = 'data-socket-challenge-screen'
  const SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" aria-label="Socket agent browser" viewBox="-6.527 2.221 32.279 32.279"><defs><linearGradient id="a" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#f0a"/><stop offset="100%" stop-color="#8c50ff"/></linearGradient></defs><path fill="url(#a)" d="M18.44 8.84c.46.16.76.6.76 1.1-.04 3.58.23 8.63-.38 10.88-1.04 4.5-4.42 8.4-8.8 10.1a1.2 1.2 0 0 1-.84 0C4.52 29.15.92 24.73.18 19.8c-.06-.31-.1-.67-.13-.98-.04-.2-.05-1.14-.05-5.17V9.91a1.15 1.15 0 0 1 .76-1.07c2.8-1.02 5.38-1.93 8.2-2.96l.24-.1q.38-.12.77 0l2.24.81z" data-socket-layer="shield"/><g fill="#fff" data-socket-layer="playwright-silhouette"><path d="M8.07 20.57v-.96l-2.68.76s.2-1.15 1.6-1.55q.63-.17 1.08-.06v-3.94H9.4a8 8 0 0 0-.4-1.04c-.2-.4-.4-.14-.85.25-.32.26-1.13.84-2.36 1.17-1.22.32-2.2.24-2.62.17-.58-.1-.89-.23-.86.21q.03.6.34 1.8c.46 1.74 1.99 5.09 4.87 4.3.76-.2 1.3-.6 1.66-1.1zm-4.32-3.16 2.06-.54s-.06.78-.83.99-1.23-.45-1.23-.45"/><path d="M15.8 14.86c-.54.1-1.82.21-3.4-.21s-2.64-1.17-3.05-1.52c-.6-.49-.85-.83-1.1-.31q-.36.68-.8 2.24c-.6 2.26-1.06 7.03 2.68 8.03s5.74-3.35 6.34-5.6q.4-1.58.44-2.35c.03-.58-.36-.41-1.12-.28m-7.52 1.87s.6-.92 1.6-.63c1 .28 1.07 1.39 1.07 1.39zm2.44 4.12c-1.76-.52-2.03-1.92-2.03-1.92l4.73 1.32s-.95 1.1-2.7.6m1.67-2.89s.6-.91 1.6-.63 1.07 1.4 1.07 1.4z"/><path d="m7.13 19.88-1.74.49s.2-1.08 1.47-1.5l-.98-3.7-.09.02c-1.22.33-2.2.25-2.62.17-.58-.1-.89-.22-.86.22q.03.6.33 1.8c.47 1.74 2 5.09 4.88 4.3l.09-.02zM3.75 17.4l2.06-.54s-.06.78-.83.99-1.23-.45-1.23-.45"/><path d="m10.8 20.87-.09-.02c-1.76-.52-2.03-1.92-2.03-1.92l2.44.68 1.3-4.96h-.02c-1.59-.43-2.64-1.17-3.05-1.51-.6-.5-.85-.84-1.1-.32q-.36.69-.8 2.24c-.6 2.26-1.06 7.03 2.68 8.03l.08.02zm-2.53-4.14s.6-.92 1.6-.63c1 .28 1.07 1.39 1.07 1.39z"/><path d="m7.22 19.85-.47.13q.15.94.61 1.75l.16-.04q.21-.06.4-.14a5 5 0 0 1-.7-1.7m-.18-4.38c-.24.9-.46 2.19-.4 3.48q.15-.08.34-.13l.09-.02c-.1-1.38.12-2.78.38-3.74l.2-.67-.35.2q-.13.4-.26.88"/></g></svg>`
  const insert = () => {
    if (!document.body || document.querySelector('[' + MARK + ']')) {
      return
    }
    const host = document.createElement('div')
    host.setAttribute(MARK, '')
    // A closed shadow root so page CSS cannot restyle the screen and the
    // screen's CSS cannot leak into the page.
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML =
      '<style>' +
      ':host{position:fixed;top:0;left:0;right:0;z-index:2147483646;pointer-events:none}' +
      '.band{display:flex;flex-direction:column;align-items:center;text-align:center;' +
      'gap:2px;padding:28px 24px 22px;pointer-events:auto;cursor:pointer;' +
      'background:rgba(9,9,11,.93);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);' +
      'border-bottom:1px solid rgba(140,80,255,.35);box-shadow:0 6px 24px rgba(0,0,0,.45);' +
      'font:400 14px/1.5 system-ui,sans-serif;color:#a1a1aa;user-select:none}' +
      '.logo{display:flex;align-items:center;justify-content:center;width:72px;height:72px;' +
      'border-radius:9999px;background:rgba(255,255,255,.06);' +
      'border:1px solid rgba(255,255,255,.08);animation:sk-bounce 1s infinite}' +
      '.logo svg{width:44px;height:44px}' +
      '.kicker{margin-top:10px;font-size:13px;font-weight:500}' +
      '.title{font-size:22px;font-weight:600;letter-spacing:-.02em;color:#fafafa}' +
      '.hint{max-width:26rem;font-size:13px;text-wrap:pretty}' +
      '.in{opacity:0;animation:sk-blur-in .7s ease-out forwards;animation-delay:var(--delay,0s)}' +
      '@keyframes sk-bounce{0%,100%{transform:translateY(-18%);' +
      'animation-timing-function:cubic-bezier(.8,0,1,1)}' +
      '50%{transform:none;animation-timing-function:cubic-bezier(0,0,.2,1)}}' +
      '@keyframes sk-blur-in{from{opacity:0;filter:blur(8px)}to{opacity:1;filter:blur(0)}}' +
      '</style>' +
      '<div class="band" title="Click to hide — the agent resumes once the check clears">' +
      '<span class="logo in" style="--delay:.4s">' +
      SHIELD +
      '</span>' +
      '<p class="kicker in" style="--delay:.1s">Socket agent paused</p>' +
      '<h1 class="title in" style="--delay:.1s">Human verification needed</h1>' +
      '<p class="hint in" style="--delay:.2s">Solve the check on this page — the agent is watching and resumes automatically.</p>' +
      '</div>'
    root.querySelector('.band').addEventListener('click', () => host.remove())
    document.body.appendChild(host)
  }
  // Both paths on purpose: the challenge page may swap its body after the
  // injection tick, so the DOMContentLoaded fallback re-inserts; the dedupe in
  // insert() makes whichever call runs second a no-op.
  if (document.body) {
    insert()
  }
  document.addEventListener('DOMContentLoaded', insert, { once: true })
})()
