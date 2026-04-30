/**
 * Formulaire contact → API Node.js incluse dans ce dépôt (server/index.js).
 * Développement : dans server/, copier .env.example en .env, puis `npm install` et `npm start`.
 * Ouvert ensuite : http://127.0.0.1:3001/Portfolio.htm
 *
 * Déploiement : proxifier `/api/` vers ce service (voir commentaire en bas de js/contact-form.js).
 *
 * Pour appeler une autre URL d’API, définissez avant ce script :
 *   window.VB_CONTACT_API_BASE = "https://api.mondomaine.com";
 */
(function () {
  function contactEndpoint() {
    var base =
      typeof window.VB_CONTACT_API_BASE !== "undefined" && window.VB_CONTACT_API_BASE
        ? String(window.VB_CONTACT_API_BASE).replace(/\/+$/, "")
        : "";
    return base ? base + "/api/contact" : "/api/contact";
  }

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  onReady(function () {
    var form = document.getElementById("vb-contact-form-el");
    if (!form) return;

    var statusEl = document.getElementById("vb-contact-form-status");
    var submitBtn = form.querySelector('button[type="submit"]');
    var honeypot = form.querySelector('input[name="company"]');

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!statusEl || !submitBtn) return;

      if (honeypot && honeypot.value) {
        return;
      }

      var fd = new FormData(form);
      var name = (fd.get("name") || "").toString().trim();
      var email = (fd.get("email") || "").toString().trim();
      var phone = (fd.get("phone") || "").toString().trim();
      var subject = (fd.get("subject") || "").toString().trim();
      var message = (fd.get("message") || "").toString().trim();

      if (!name || !email || !message) {
        statusEl.textContent = "Merci de remplir au minimum le nom, l’e-mail et le message.";
        statusEl.className = "vb-contact-form-status vb-contact-form-status--error";
        return;
      }

      var payload = {
        name: name,
        email: email,
        phone: phone,
        subject: subject || "Message depuis Vision Boosters Agency",
        message: message,
      };

      var prevLabel = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = "Envoi en cours…";
      statusEl.textContent = "";
      statusEl.className = "vb-contact-form-status";

      fetch(contactEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.text().then(function (text) {
            var body = null;
            try {
              body = text ? JSON.parse(text) : null;
            } catch (ignore) {
              body = { message: "Réponse serveur inattendue." };
            }
            return { ok: r.ok, body: body };
          });
        })
        .then(function (result) {
          submitBtn.disabled = false;
          submitBtn.textContent = prevLabel;

          var data = result.body;
          if (result.ok && data && data.success) {
            if (data.emailFailed) {
              statusEl.textContent =
                "Votre message a bien été enregistré.\n\nUn problème d’e-mail empêche l’alerte automatique pour l’équipe : contactez-nous sur WhatsApp en attendant une réponse.";
              statusEl.className = "vb-contact-form-status vb-contact-form-status--warn";
            } else {
              statusEl.textContent =
                "Merci ! Votre message a bien été reçu.\n\nNotre équipe vous répondra dans les plus brefs délais — pensez à vérifier vos courriers indésirables (spam).";
              statusEl.className = "vb-contact-form-status vb-contact-form-status--ok";
            }
            form.reset();
            return;
          }

          statusEl.textContent =
            (data && data.message) || "Envoi impossible pour le moment. Réessayez plus tard.";
          statusEl.className = "vb-contact-form-status vb-contact-form-status--error";
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = prevLabel;
          statusEl.textContent =
            "Impossible de joindre le serveur (vérifiez qu’il tourne localement avec `npm start` dans server/, ou le proxy /api/ en production).";
          statusEl.className = "vb-contact-form-status vb-contact-form-status--error";
        });
    });
  });
})();

/*
  Production (exemple Nginx) — site statique + API :
    location /api/ {
      proxy_pass http://127.0.0.1:3001/api/;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

  Si l’API est sur un autre sous-domaine : ajoutez ce domaine au meta CSP connect-src de Portfolio.htm
  et définissez window.VB_CONTACT_API_BASE avant ce script.
*/
