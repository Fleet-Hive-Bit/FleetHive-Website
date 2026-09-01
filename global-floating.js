// ===== GlobalFloatingActions =====
// ONE global component for Bree (left) + WhatsApp (right), shared by every
// page on the site. This file is the single source of truth for their
// markup — no page should ever define its own copy.
//
// Why this exists: Bree/WhatsApp must never move (not on scroll, open/close,
// section or page change, refresh, or device). The safest way to guarantee
// that is to stop hand-copying their HTML into every page (which is how
// small drifts creep in) and instead inject one identical block everywhere.
//
// This script must be included BEFORE bree-knowledge.js / site.js in every
// page's <script> list, and it runs synchronously (not on DOMContentLoaded)
// so the elements already exist by the time site.js wires up Bree's
// behavior. It does not touch Bree's logic at all — that stays in site.js.
(function(){
  if(document.getElementById('breeLauncher')) return; // already injected — never duplicate

  var html =
    '<a href="https://wa.me/2347025771522" class="wa-float" aria-label="Chat on WhatsApp" target="_blank" rel="noopener">' +
      '<span class="wa-halo"></span>' +
      '<span class="wa-online"></span>' +
      '<svg class="wa-icon" viewBox="0 0 32 32" fill="#3B7DDD"><path d="M16.001 3C9.383 3 4 8.373 4 14.98c0 2.37.696 4.578 1.9 6.435L4 29l7.79-2.036a12.94 12.94 0 0 0 4.211.705h.005C22.62 27.669 28 22.297 28 15.69 28 9.373 22.617 3 16.001 3zm0 22.09h-.004a10.9 10.9 0 0 1-5.55-1.52l-.398-.236-4.622 1.209 1.233-4.505-.259-.463a10.77 10.77 0 0 1-1.653-5.596c0-5.965 4.86-10.82 10.842-10.82 2.897 0 5.62 1.13 7.667 3.18a10.75 10.75 0 0 1 3.174 7.66c0 5.965-4.86 10.82-10.43 10.09z"/></svg>' +
      '<span class="wa-text">Chat with us</span>' +
    '</a>' +
    '<div class="bree-launcher" id="breeLauncher">' +
      '<div class="bree-avatar">B<span class="bree-ai-ring"></span><span class="bree-ai-badge"></span></div>' +
      '<span class="bree-text">Ask Bree</span>' +
    '</div>' +
    '<div class="bree-panel" id="breePanel">' +
      '<div class="bree-head">' +
        '<div class="bree-head-info">' +
          '<div class="bree-avatar">B</div>' +
          '<div><div class="bree-head-name">Bree</div><div class="bree-head-status">\u25CF FleetHive Assistant</div></div>' +
        '</div>' +
        '<button class="bree-close" id="breeClose" aria-label="Close">\u00D7</button>' +
      '</div>' +
      '<div class="bree-body" id="breeBody"></div>' +
      '<div class="bree-quick">' +
        '<button>Track my vehicle</button><button>View pricing</button><button>Track a package/asset</button><button>Become a partner</button><button>Talk to an agent</button>' +
      '</div>' +
      '<div class="bree-input-row">' +
        '<input type="text" id="breeInput" placeholder="Ask Bree a question...">' +
        '<button class="bree-send" id="breeSend" aria-label="Send"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>' +
      '</div>' +
    '</div>';

  var container = document.createElement('div');
  container.id = 'globalFloatingActions';
  container.innerHTML = html;
  // Appended directly to <body> (not into any page section), so it is never
  // subject to a page container's position:relative/overflow/transform,
  // which could otherwise break position:fixed's viewport anchoring.
  document.body.appendChild(container);
})();
