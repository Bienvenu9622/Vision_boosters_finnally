import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data", "leads.jsonl");

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS;
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "https://visionboostersagency.com",
    "https://www.visionboostersagency.com",
  ];
}

function validateBody(body) {
  const name = String(body?.name ?? "").trim().slice(0, 200);
  const email = String(body?.email ?? "").trim().slice(0, 320);
  const phone = String(body?.phone ?? "").trim().slice(0, 40);
  const subject = String(body?.subject ?? "").trim().slice(0, 200);
  const message = String(body?.message ?? "").trim().slice(0, 8000);
  if (!name || !email || !message) {
    return { error: "Champs requis manquants (nom, e-mail, message)." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Adresse e-mail invalide." };
  }
  return { name, email, phone, subject, message };
}

async function appendLead(record) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.appendFile(DATA_FILE, JSON.stringify(record) + "\n", "utf8");
}

function isMailConfigured() {
  const { SMTP_HOST, MAIL_FROM, MAIL_TO } = process.env;
  return Boolean(SMTP_HOST && MAIL_FROM && MAIL_TO);
}

function createMailTransport() {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_SECURE,
    SMTP_REQUIRE_TLS,
  } = process.env;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: SMTP_SECURE === "true" || SMTP_SECURE === "1",
    requireTLS: SMTP_REQUIRE_TLS === "true" || SMTP_REQUIRE_TLS === "1",
    auth:
      SMTP_USER != null && SMTP_USER !== ""
        ? { user: SMTP_USER, pass: SMTP_PASS ?? "" }
        : undefined,
    ...(process.env.SMTP_DEBUG === "true" ? { logger: true, debug: true } : {}),
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendMailNotification(fields) {
  const { MAIL_FROM, MAIL_TO } = process.env;
  if (!isMailConfigured()) {
    return { skipped: true };
  }
  const transporter = createMailTransport();
  const subj = fields.subject || "Message depuis le site";
  const plain = [
    `Nom : ${fields.name}`,
    `E-mail : ${fields.email}`,
    fields.phone ? `Téléphone : ${fields.phone}` : null,
    "",
    fields.message,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
<!DOCTYPE html><html><body style="font-family:Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111;">
<h2 style="margin:0 0 12px;color:#333;">Nouveau message — formulaire site</h2>
<p style="margin:0 0 6px;"><strong>Nom</strong> : ${escapeHtml(fields.name)}</p>
<p style="margin:0 0 6px;"><strong>E-mail</strong> : ${escapeHtml(fields.email)}</p>
${fields.phone ? `<p style="margin:0 0 6px;"><strong>Téléphone</strong> : ${escapeHtml(fields.phone)}</p>` : ""}
<hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
<pre style="font-family:inherit;white-space:pre-wrap;margin:0;">${escapeHtml(fields.message)}</pre>
</body></html>`.trim();

  await transporter.sendMail({
    from: MAIL_FROM,
    to: MAIL_TO,
    replyTo: fields.email,
    subject: `[Vision Boosters] ${subj}`,
    text: plain,
    html,
  });
  return { sent: true };
}

const app = express();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 40,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(
  cors({
    origin: parseCorsOrigins(),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 86400,
  }),
);
app.use(express.json({ limit: "128kb" }));
app.use("/api", limiter);

app.post("/api/contact", async (req, res) => {
  try {
    const parsed = validateBody(req.body);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }

    const record = {
      at: new Date().toISOString(),
      ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "",
      ...parsed,
    };

    await appendLead(record);

    let mailStatus = null;
    try {
      mailStatus = await sendMailNotification(parsed);
    } catch (e) {
      console.error("SMTP error:", e?.message || e);
      mailStatus = { error: true };
    }

    return res.json({
      success: true,
      persisted: true,
      emailSent: mailStatus?.sent === true,
      emailSkipped: mailStatus?.skipped === true,
      emailFailed: mailStatus?.error === true,
    });
  } catch (e) {
    console.error("contact error:", e?.message || e);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur. Réessayez plus tard.",
    });
  }
});

const siteRoot = path.join(__dirname, "..");
const serveStatic = process.env.SERVE_STATIC !== "0";
if (serveStatic) {
  app.use(express.static(siteRoot));
}

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, async () => {
  console.log(`Vision Boosters API + site statique → http://127.0.0.1:${PORT}/`);

  if (!isMailConfigured()) {
    console.warn(
      "\n[Vision Boosters] Aucun e-mail vers la boîte agence : définissez SMTP_HOST, MAIL_FROM et MAIL_TO dans server/.env.\n→ Les formulaires sont enregistrés dans server/data/leads.jsonl jusqu’à configuration SMTP.\n",
    );
  } else if (process.env.SMTP_VERIFY_ON_START !== "0") {
    try {
      await createMailTransport().verify();
      console.log("[Vision Boosters] SMTP : connexion de test réussie — les mails peuvent être envoyés.\n");
    } catch (e) {
      console.error("[Vision Boosters] SMTP verify a échoué :", e?.message || e);
      console.error("→ Corrigez server/.env (hôte, port, identifiants, TLS). Les messages sont quand même enregistrés en fichier.\n");
    }
  }
});
