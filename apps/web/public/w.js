/*!
 * Snack Manager — chargeur du widget de commande en ligne.
 *
 * ┌─ INTÉGRATION ────────────────────────────────────────────────────────────┐
 * │  Collez cette ligne avant </body> sur le site du restaurant :            │
 * │                                                                          │
 * │  <script src="https://VOTRE-DOMAINE/w.js" data-tenant="classfood" defer> │
 * │  </script>                                                               │
 * │                                                                          │
 * │  Attributs disponibles sur la balise <script> :                          │
 * │    data-tenant   (requis)  identifiant du restaurant, ex. "classfood"    │
 * │    data-color    accent de la marque, ex. "#c9a15a" (défaut : doré)      │
 * │    data-label    libellé du bouton (défaut : "Commander en ligne")       │
 * │    data-position "right" | "left"   coin du bouton flottant (défaut right)│
 * │    data-target   sélecteur CSS — si présent, la commande est insérée EN   │
 * │                  LIGNE dans cet élément (hauteur auto) au lieu du bouton  │
 * │                  flottant. Ex. data-target="#commander"                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Aucune dépendance, aucun cookie, aucun suivi. L'iframe n'est créée qu'à
 * l'ouverture du panneau : le site hôte ne paie rien tant que personne ne
 * commande. ~3,4 Ko servis (gzip).
 *
 * Messages reçus de l'iframe (protocole `{ source: "snackmanager", type }`) :
 *   "ready"   l'application est montée
 *   "resize"  hauteur du contenu, en mode data-target
 *   "close"   demande de fermeture du panneau
 */
(function () {
  "use strict";

  var TAG = "snackmanager";
  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        if (/\/w\.js(\?|$)/.test(all[i].src || "")) return all[i];
      }
      return null;
    })();

  if (!script) return;
  if (window.__smWidget) return; // une seule instance par page
  window.__smWidget = true;

  var tenant = (script.getAttribute("data-tenant") || "").trim();
  if (!tenant) {
    if (window.console) console.warn("[SnackManager] data-tenant manquant sur w.js");
    return;
  }

  var raw = script.getAttribute("data-color") || "#c9a15a";
  var accent = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw.trim()) ? raw.trim() : "#c9a15a";
  var label = script.getAttribute("data-label") || "Commander en ligne";
  var left = (script.getAttribute("data-position") || "right") === "left";
  var target = script.getAttribute("data-target");

  var origin = (function () {
    try {
      return new URL(script.src, location.href).origin;
    } catch {
      return "";
    }
  })();
  var src = origin + "/embed/" + encodeURIComponent(tenant);

  var reduce =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var EASE = "cubic-bezier(.2,.8,.2,1)";

  function el(tag, css) {
    var node = document.createElement(tag);
    if (css) node.style.cssText = css;
    return node;
  }

  function makeFrame(extra) {
    var frame = el("iframe", "width:100%;border:0;display:block;" + (extra || ""));
    frame.src = src;
    frame.title = "Commander en ligne";
    frame.loading = "lazy";
    frame.allow = "payment *; clipboard-write";
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    return frame;
  }

  // ── Mode « en ligne dans la page » : pas de bouton flottant ──
  if (target) {
    var host = document.querySelector(target);
    if (!host) {
      if (window.console)
        console.warn("[SnackManager] data-target introuvable : " + target);
      return;
    }
    var inline = makeFrame("height:640px;border-radius:16px;background:#000;");
    host.appendChild(inline);
    window.addEventListener("message", function (event) {
      var data = event.data;
      if (!data || data.source !== TAG || event.source !== inline.contentWindow) return;
      if (data.type === "resize" && typeof data.height === "number") {
        inline.style.height = Math.max(420, Math.min(2400, data.height)) + "px";
      }
    });
    return;
  }

  // ── Bouton flottant ──
  var button = el(
    "button",
    "position:fixed;bottom:18px;" +
      (left ? "left:18px;" : "right:18px;") +
      "z-index:2147483000;display:inline-flex;align-items:center;gap:9px;" +
      "padding:14px 20px;border:0;border-radius:999px;cursor:pointer;" +
      "font:800 15px/1 Inter,system-ui,-apple-system,Segoe UI,sans-serif;" +
      "letter-spacing:-.01em;background:" +
      accent +
      ";color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.35);" +
      "-webkit-tap-highlight-color:transparent;touch-action:manipulation;" +
      "user-select:none;-webkit-user-select:none;" +
      (reduce ? "" : "transition:transform .2s " + EASE + ";"),
  );
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 4h2.2L7.5 16.5h11L21 8H6"/><circle cx="9.5" cy="19.5" r="1"/>' +
    '<circle cx="16.5" cy="19.5" r="1"/></svg><span></span>';
  button.lastChild.textContent = label;

  if (!reduce) {
    button.addEventListener("mousedown", function () {
      button.style.transform = "scale(.97)";
    });
    ["mouseup", "mouseleave", "blur"].forEach(function (type) {
      button.addEventListener(type, function () {
        button.style.transform = "";
      });
    });
  }

  // ── Panneau plein écran (iframe créée à la première ouverture) ──
  var overlay = null;
  var frame = null;
  var restore = null;

  function build() {
    overlay = el(
      "div",
      "position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.72);" +
        "display:flex;align-items:flex-end;justify-content:center;opacity:0;" +
        (reduce ? "" : "transition:opacity .24s " + EASE + ";"),
    );
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Commander en ligne");

    var panel = el(
      "div",
      "position:relative;width:100%;max-width:520px;height:100%;max-height:100%;" +
        "background:#000;overflow:hidden;box-shadow:0 -18px 60px rgba(0,0,0,.6);" +
        (reduce ? "" : "transform:translateY(24px);transition:transform .28s " + EASE + ";"),
    );

    frame = makeFrame("height:100%;");
    panel.appendChild(frame);

    var close = el(
      "button",
      "position:absolute;top:10px;" +
        "right:10px;width:34px;height:34px;border-radius:999px;cursor:pointer;" +
        "border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.55);color:#fff;" +
        "display:grid;place-items:center;padding:0;z-index:2;backdrop-filter:blur(6px);",
    );
    close.type = "button";
    close.setAttribute("aria-label", "Fermer");
    close.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
      '<path d="m6 6 12 12"/><path d="m18 6-12 12"/></svg>';
    close.addEventListener("click", hide);
    panel.appendChild(close);

    overlay.appendChild(panel);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) hide();
    });
    document.body.appendChild(overlay);
    return panel;
  }

  function onKey(event) {
    if (event.key === "Escape" || event.keyCode === 27) hide();
  }

  var bodyOverflow = "";

  function show() {
    var panel = overlay ? overlay.firstChild : build();
    restore = document.activeElement;
    bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    overlay.style.display = "flex";
    button.style.display = "none";
    button.setAttribute("aria-expanded", "true");
    requestAnimationFrame(function () {
      overlay.style.opacity = "1";
      panel.style.transform = "translateY(0)";
    });
    document.addEventListener("keydown", onKey);
    if (frame) frame.focus();
  }

  function hide() {
    if (!overlay) return;
    var panel = overlay.firstChild;
    overlay.style.opacity = "0";
    if (panel) panel.style.transform = "translateY(24px)";
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = bodyOverflow;
    button.style.display = "inline-flex";
    button.setAttribute("aria-expanded", "false");
    window.setTimeout(
      function () {
        if (overlay) overlay.style.display = "none";
      },
      reduce ? 0 : 260,
    );
    if (restore && restore.focus) restore.focus();
    else button.focus();
  }

  button.addEventListener("click", show);

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== TAG) return;
    if (!frame || event.source !== frame.contentWindow) return;
    if (data.type === "close") hide();
  });

  function mount() {
    document.body.appendChild(button);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  // API minimale pour un lien « Commander » déjà présent sur le site hôte :
  //   <a href="#" onclick="SnackManager.open();return false">Commander</a>
  window.SnackManager = { open: show, close: hide };
})();
