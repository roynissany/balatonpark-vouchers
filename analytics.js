// Consent, and the Meta pixel behind it.
//
// Two things live here so neither can drift from the other:
//
//   1. the consent bar, drawn on every page rather than only the landing
//      page - someone sent a direct link to the purchase page was never
//      being asked, which is the wrong way round;
//   2. the pixel, which loads only after someone has chosen "accept", and
//      a small queue so a page can report an event before the choice is
//      made without having to care whether anything is listening.
//
// Nothing here runs before the choice. Declining leaves no third-party
// script on the page at all.

(function (window, document) {
  'use strict';

  var PIXEL_ID = '987233217783582';
  var KEY = 'bpc-cookie-choice';
  var PRIVACY = 'https://www.balatonparkcircuit.com/privacy-policy';

  var queue = [];
  var loaded = false;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function remember(choice) {
    try { localStorage.setItem(KEY, choice); } catch (e) { /* blocked storage */ }
  }

  function loadPixel() {
    if (loaded || !PIXEL_ID) return;
    loaded = true;

    /* Meta's own snippet, unchanged apart from being called on consent. */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');

    // Anything the page reported while it was waiting.
    queue.splice(0).forEach(function (item) {
      window.fbq('track', item.name, item.params || {});
    });
  }

  // What the pages call. Safe to call at any time: before consent it is
  // remembered, after a refusal it is dropped.
  function track(name, params) {
    if (!name) return;
    if (loaded && window.fbq) { window.fbq('track', name, params || {}); return; }
    if (stored() === 'all') { loadPixel(); window.fbq('track', name, params || {}); return; }
    if (queue.length < 20) queue.push({ name: name, params: params });
  }

  // ---------------------------------------------------------------- the bar

  var CSS =
    '#cookies{position:fixed;left:50%;transform:translateX(-50%);bottom:20px;' +
    'z-index:60;width:calc(100% - 40px);max-width:600px;display:flex;' +
    'flex-wrap:wrap;align-items:center;gap:14px;padding:13px 16px;' +
    'background:rgba(10,20,34,.70);backdrop-filter:blur(12px);' +
    '-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.16);' +
    'font-family:Inter,-apple-system,system-ui,sans-serif}' +
    '#cookies[hidden]{display:none}' +
    '#cookies p{flex:1 1 250px;margin:0;font-size:12.5px;font-weight:300;' +
    'line-height:1.55;color:rgba(245,247,251,.82)}' +
    '#cookies a{color:#A8CEF0}' +
    '#cookies button{min-height:44px;font-family:Inter,sans-serif;font-size:13px;' +
    'cursor:pointer;white-space:nowrap;border-radius:0}' +
    '#cookies .ess{padding:0 11px;background:rgba(255,255,255,.10);color:#F5F7FB;' +
    'border:1px solid rgba(255,255,255,.38);font-weight:500}' +
    '#cookies .acc{padding:0 20px;background:#427AB7;color:#fff;border:none;font-weight:600}';

  function text(key, fallback) {
    return (window.i18n && window.i18n.t) ? window.i18n.t(key) : fallback;
  }

  function build() {
    // A page that already carries its own bar keeps it; this only fills in
    // where there is none.
    if (document.getElementById('cookies')) return document.getElementById('cookies');

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var box = document.createElement('div');
    box.id = 'cookies';
    box.hidden = true;
    box.innerHTML =
      '<p><span data-i18n="cookie.text">' + text('cookie.text', 'Essential cookies keep the voucher system working! Other ones are important to us.') + '</span> ' +
      '<a href="' + PRIVACY + '" target="_blank" rel="noopener" style="white-space:nowrap" data-i18n="cookie.more">' +
      text('cookie.more', 'More') + '</a></p>' +
      '<span style="flex:0 0 auto;display:flex;gap:8px">' +
      '<button type="button" class="ess" data-choice="essential" data-i18n="cookie.essentials">' +
      text('cookie.essentials', 'Essentials') + '</button>' +
      '<button type="button" class="acc" data-choice="all" data-i18n="cookie.accept">' +
      text('cookie.accept', 'Accept') + '</button></span>';
    document.body.appendChild(box);
    return box;
  }

  function start() {
    var box = build();
    var saved = stored();

    if (!saved) box.hidden = false;

    box.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button[data-choice]');
      if (!btn) return;
      remember(btn.dataset.choice);
      box.hidden = true;
      if (btn.dataset.choice === 'all') loadPixel();
      else queue.length = 0;
    });

    if (saved === 'all') loadPixel();

    // Keep the wording in step with the language switch.
    if (window.i18n) {
      if (window.i18n.apply) window.i18n.apply(box);
      if (window.i18n.onChange) {
        window.i18n.onChange(function () {
          if (window.i18n.apply) window.i18n.apply(box);
        });
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.bpcTrack = track;
})(window, document);
