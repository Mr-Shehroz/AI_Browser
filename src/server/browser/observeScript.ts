// Kept as a string on purpose: tsx/esbuild can inject helpers (e.g. __name)
// into functions, which then break inside page.evaluate().
export const OBSERVE_SCRIPT = String.raw`(() => {
  const SELECTOR = 'a[href], button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [contenteditable="true"]';
  document.querySelectorAll('[data-agent-ref]').forEach(el => el.removeAttribute('data-agent-ref'));
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll(SELECTOR)) {
    if (out.length >= 150) break;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none') continue;
    const ref = 'e' + (i++);
    el.setAttribute('data-agent-ref', ref);
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || undefined;
    const buttonValue = (type === 'submit' || type === 'button') ? el.value : '';
    const name = el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder')
      || el.getAttribute('title') || buttonValue || el.getAttribute('name') || '';
    out.push({
      ref, role: el.getAttribute('role') || tag, type,
      name: String(name).replace(/\s+/g, ' ').trim().slice(0, 100),
      selector: '[data-agent-ref="' + ref + '"]',
      inViewport: r.top < innerHeight && r.bottom > 0,
    });
  }
  const blockers = [];
  if (document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"]')) blockers.push('captcha');
  if (document.querySelector('input[type="password"]')) blockers.push('login_form');
  return {
    url: location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, 4000),
    elements: out,
    blockers,
  };
})()`;