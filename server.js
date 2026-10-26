const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   COMPANY DETAILS
========================= */

const COMPANY_NAME = "JJM Consulting GmbH";
const COMPANY_ADDRESS = "Gerda-Hasselfeldt-Ring 6b, 85235 Pfaffenhofen an der Glonn";
const COMPANY_PHONE = "0177 136 38 11";
const COMPANY_WEBSITE = "https://www.jjmconsultinggmbh.co";
const COMPANY_EMAIL = "finanzierung@jjmconsultinggmbh.com";

/* =========================
   HELPERS
========================= */

function normalizeInput(text) {
  if (!text) return "";
  return String(text).trim();
}

function cleanNumber(value) {
  if (value === undefined || value === null) return NaN;

  let str = String(value).trim();
  const match = str.match(/[\d.,]+/);
  if (!match) return NaN;

  str = match[0];
  str = str.replace(/[^\d.,]/g, "");

  if (str.includes(".") && str.includes(",")) {
    str = str.replace(/\./g, "");
    str = str.replace(",", ".");
  } else if (str.includes(".")) {
    if (/^\d{1,3}(\.\d{3})+$/.test(str)) {
      str = str.replace(/\./g, "");
    }
  } else if (str.includes(",")) {
    if (/^\d{1,3}(,\d{3})+$/.test(str)) {
      str = str.replace(/,/g, "");
    } else {
      str = str.replace(",", ".");
    }
  }

  return parseFloat(str);
}

function formatEuro(value) {
  if (value === undefined || value === null || isNaN(value)) return "";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textToHtml(text) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

/* =========================
   DOCUMENTS LIST
========================= */

function getDocumentsList() {
  return `- Personalausweis oder Reisepass
- Einkommensnachweis

Als Einkommensnachweis gilt zum Beispiel:
- Gehaltsabrechnung vom Arbeitgeber
- Nachweis vom Jobcenter / Bürgergeld / Sozialleistungen
- Rentenbescheid`;
}

/* =========================
   ZOHO EMAIL SENDER
========================= */

async function sendZohoEmail({ to, toName, subject, htmlbody }) {
  const host = process.env.ZOHO_CPAA_HOST || "https://cpaas.zoho.eu";
  const token = process.env.ZOHO_CPAA_TOKEN;
  const fromEmail = process.env.FROM_EMAIL;
  const fromName = process.env.FROM_NAME || COMPANY_NAME;
  const replyTo = process.env.REPLY_TO_EMAIL || fromEmail;

  if (!token) throw new Error("ZOHO_CPAA_TOKEN fehlt.");
  if (!fromEmail) throw new Error("FROM_EMAIL fehlt.");
  if (!to) throw new Error("Empfänger-E-Mail fehlt.");

  const payload = {
    from: {
      address: fromEmail,
      name: fromName
    },
    to: [
      {
        email_address: {
          address: to,
          name: toName || ""
        }
      }
    ],
    reply_to: [
      {
        address: replyTo
      }
    ],
    subject,
    htmlbody
  };

  const response = await fetch(`${host}/v1.1/email`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: token
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("Zoho email error:", data);
    throw new Error(`Zoho email failed with status ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

/* =========================
   HTML EMAIL BUILDER
========================= */

function buildClientEmailHtml({ name, amount, desiredMonthlyText, documentsList }) {
  const safeName = escapeHtml(name || "");
  const amountText = isNaN(amount) ? "" : `${formatEuro(amount)} €`;
  const monthlyText = escapeHtml(desiredMonthlyText || "");

  const documentsHtml = textToHtml(documentsList);

  return `
<div style="margin:0; padding:0; background:#f4f6f8; font-family:Arial, Helvetica, sans-serif; color:#111827;">
  <div style="max-width:680px; margin:0 auto; padding:24px;">
    
    <div style="background:#ffffff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden;">
      
      <div style="background:#0f172a; padding:24px 28px;">
        <h1 style="margin:0; color:#ffffff; font-size:24px; line-height:1.3;">
          Ihre Anfrage ist eingegangen
        </h1>
        <p style="margin:8px 0 0; color:#cbd5e1; font-size:15px;">
          Vielen Dank für Ihre Anfrage. Wir haben Ihre Angaben erhalten.
        </p>
      </div>

      <div style="padding:28px;">
        <p style="font-size:16px; line-height:1.6; margin:0 0 18px;">
          Hallo ${safeName || ""},
        </p>

        <p style="font-size:16px; line-height:1.6; margin:0 0 20px;">
          wir haben Ihre Angaben erhalten und bereiten nun eine erste unverbindliche Einschätzung für Sie vor.
        </p>

        <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:12px; padding:18px; margin:22px 0;">
          <h2 style="font-size:18px; margin:0 0 12px; color:#111827;">Ihre Angaben</h2>
          <p style="margin:6px 0;"><strong>Gewünschter Betrag:</strong> ${amountText}</p>
          <p style="margin:6px 0;"><strong>Gewünschte monatliche Rate:</strong> ${monthlyText}</p>
        </div>

        <div style="background:#eef6ff; border:1px solid #bfdbfe; border-radius:12px; padding:18px; margin:22px 0;">
          <h2 style="font-size:18px; margin:0 0 12px; color:#1e3a8a;">Erste unverbindliche Einschätzung</h2>
          <p style="margin:0; font-size:15px; line-height:1.6;">
            Auf Basis Ihrer Angaben prüfen wir nun, welche Finanzierungsmöglichkeiten für Sie infrage kommen.
          </p>
        </div>

        <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:12px; padding:16px; margin:22px 0;">
          <p style="margin:0; font-size:14px; line-height:1.6; color:#7c2d12;">
            <strong>Wichtiger Hinweis:</strong> Dies ist noch keine finale Zusage. 
            Die endgültige Prüfung hängt von Ihren Unterlagen, Ihrer Bonität und der Entscheidung des Finanzierungspartners ab.
          </p>
        </div>

        <h2 style="font-size:18px; margin:24px 0 12px; color:#111827;">Benötigte Unterlagen</h2>
        <div style="background:#f9fafb; border-radius:10px; padding:18px; border:1px solid #e5e7eb; margin-bottom:22px; line-height:1.6;">
          ${documentsHtml}
        </div>

        <h2 style="font-size:18px; margin:24px 0 12px; color:#111827;">Nächster Schritt</h2>
        <p style="font-size:16px; line-height:1.6; margin:0 0 18px;">
          Bitte antworten Sie einfach auf diese E-Mail mit dem Einkommensnachweis. Danach prüfen wir Ihre Anfrage weiter.
        </p>

        <p style="font-size:16px; line-height:1.6; margin:28px 0 0;">
          Viele Grüße<br>
          <strong>${escapeHtml(COMPANY_NAME)}</strong>
        </p>
      </div>
    </div>

    <div style="font-size:12px; color:#6b7280; line-height:1.6; margin:18px 4px 0; text-align:center;">
      <p style="margin:0 0 8px;">
        Sie erhalten diese E-Mail, weil Sie eine Finanzierungsanfrage gestellt haben.
      </p>

      <p style="margin:0 0 6px;">
        <strong>${escapeHtml(COMPANY_NAME)}</strong>
      </p>

      <p style="margin:0 0 6px;">
        ${escapeHtml(COMPANY_ADDRESS)}
      </p>

      <p style="margin:0 0 6px;">
        Telefon:
        <a href="tel:${escapeHtml(COMPANY_PHONE.replace(/\s/g, ""))}" style="color:#2563eb; text-decoration:none;">
          ${escapeHtml(COMPANY_PHONE)}
        </a>
      </p>

      <p style="margin:0 0 6px;">
        E-Mail:
        <a href="mailto:${escapeHtml(COMPANY_EMAIL)}" style="color:#2563eb; text-decoration:none;">
          ${escapeHtml(COMPANY_EMAIL)}
        </a>
      </p>

      <p style="margin:0;">
        Webseite:
        <a href="${escapeHtml(COMPANY_WEBSITE)}" style="color:#2563eb; text-decoration:none;">
          ${escapeHtml(COMPANY_WEBSITE)}
        </a>
      </p>
    </div>

  </div>
</div>
`;
}

/* =========================
   ROUTES
========================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Loan webhook is running",
    endpoints: [
      "/send-loan-email"
    ]
  });
});

app.post("/send-loan-email", async (req, res) => {
  try {
    const body = req.body || {};

    const name = normalizeInput(
      body.name ||
      body.full_name ||
      body.fullName ||
      body["Full Name"] ||
      body["full name"]
    );

    const email = normalizeInput(
      body.email ||
      body.Email ||
      body["E-Mail"] ||
      body["Email Address"]
    );

    const amountRaw =
      body.loan_amount ||
      body.amount ||
      body["Loan Amount"] ||
      body["Welchen Kreditbetrag möchten Sie anfragen?"] ||
      body["Kreditbetrag"];

    const desiredMonthlyText = normalizeInput(
      body.desired_monthly ||
      body.monthly_rate ||
      body["Desired Monthly"] ||
      body["Welche monatliche Rate möchten Sie ungefähr zahlen?"] ||
      body["Monatliche Rate"]
    );

    if (!email) {
      return res.status(400).json({
        success: false,
        error_message: "E-Mail-Adresse fehlt."
      });
    }

    const amount = cleanNumber(amountRaw);
    const documentsList = getDocumentsList();

    const clientEmailHtml = buildClientEmailHtml({
      name,
      amount,
      desiredMonthlyText,
      documentsList
    });

    await sendZohoEmail({
      to: email,
      toName: name,
      subject: "Ihre Anfrage ist eingegangen",
      htmlbody: clientEmailHtml
    });

    return res.status(200).json({
      success: true,
      message: "E-Mail wurde erfolgreich über Zoho gesendet.",
      email_sent_to: email
    });
  } catch (error) {
    console.error("send-loan-email error:", error);

    return res.status(500).json({
      success: false,
      error_message: "Interner Serverfehler beim Senden der E-Mail über Zoho.",
      details: error.message
    });
  }
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
