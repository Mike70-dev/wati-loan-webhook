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
const COMPANY_WEBSITE = "https://www.jjmconsultinggmbh.com";
const COMPANY_EMAIL = "info@jjmconsultinggmbh.com";

/* =========================
   HELPERS
========================= */

function normalizeInput(text) {
  if (!text) return "";
  return String(text).trim();
}

function extractNumbers(text) {
  const matches = String(text || "").match(/[\d.,]+/g);
  if (!matches || matches.length < 2) return null;
  return [matches[0], matches[1]];
}

function cleanNumber(value) {
  if (value === undefined || value === null) return NaN;

  let str = String(value).trim();

  // Take first number-like part if value contains ranges or text
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
   LOAN CALCULATION
========================= */

function calculateOffer(amount, desiredMonthly) {
  if (isNaN(amount) || isNaN(desiredMonthly)) {
    return {
      success: false,
      message: `Leider konnten wir Ihre Angaben nicht eindeutig verarbeiten.

Bitte senden Sie den Kreditbetrag und die gewünschte monatliche Rate zum Beispiel so:
10000 / 300`
    };
  }

  if (amount < 3500) {
    return {
      success: false,
      message: `Der Mindestkreditbetrag beträgt 3.500 €.`
    };
  }

  if (amount > 300000) {
    return {
      success: false,
      message: `Der maximale Kreditbetrag beträgt 300.000 €.`
    };
  }

  if (desiredMonthly <= 0) {
    return {
      success: false,
      message: `Die monatliche Rate muss größer als 0 sein.`
    };
  }

  const minYears = 1;
  const maxYears = 25;
  const yearlyRate = 0.025;

  let bestYear = null;
  let bestMonthly = null;

  for (let year = minYears; year <= maxYears; year++) {
    const interestTotal = amount * yearlyRate * year;
    const totalRepayment = amount + interestTotal;
    const monthlyPayment = totalRepayment / (year * 12);

    if (monthlyPayment <= desiredMonthly) {
      if (bestMonthly === null || monthlyPayment > bestMonthly) {
        bestMonthly = monthlyPayment;
        bestYear = year;
      }
    }
  }

  if (bestYear === null || bestMonthly === null) {
    return {
      success: false,
      message: `Mit der gewünschten monatlichen Rate ist für diesen Kreditbetrag innerhalb der maximalen Laufzeit leider kein Angebot möglich.

Bitte teilen Sie uns gerne mit, ob eine höhere monatliche Rate oder ein geringerer Kreditbetrag für Sie infrage kommt.`
    };
  }

  const monthlyRounded = Number(bestMonthly.toFixed(2));
  const amountRounded = Number(amount.toFixed(2));

  return {
    success: true,
    bestYear,
    monthlyRounded,
    amountRounded,
    message: `Kredit über ${formatEuro(amountRounded)} €

Laufzeit: ${bestYear} Jahre

Geschätzte monatliche Rate: ${formatEuro(monthlyRounded)} €`
  };
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
   HTML EMAIL BUILDERS
========================= */

function buildClientEmailHtml({ name, amount, desiredMonthly, result, documentsList }) {
  const safeName = escapeHtml(name || "");
  const amountText = isNaN(amount) ? "" : `${formatEuro(amount)} €`;
  const desiredText = isNaN(desiredMonthly) ? "" : `${formatEuro(desiredMonthly)} €`;

  const calculationHtml = result.success
    ? `
      <p style="margin:6px 0;"><strong>Finanzierungsbetrag:</strong> ${formatEuro(result.amountRounded)} €</p>
      <p style="margin:6px 0;"><strong>Laufzeit:</strong> ${result.bestYear} Jahre</p>
      <p style="margin:6px 0;"><strong>Geschätzte monatliche Rate:</strong> ${formatEuro(result.monthlyRounded)} €</p>
    `
    : `<p style="margin:0;">${textToHtml(result.message)}</p>`;

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
          wir haben Ihre Angaben erhalten und eine erste unverbindliche Einschätzung vorbereitet.
        </p>

        <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:12px; padding:18px; margin:22px 0;">
          <h2 style="font-size:18px; margin:0 0 12px; color:#111827;">Ihre Angaben</h2>
          <p style="margin:6px 0;"><strong>Gewünschter Betrag:</strong> ${amountText}</p>
          <p style="margin:6px 0;"><strong>Gewünschte monatliche Rate:</strong> ${desiredText}</p>
        </div>

        <div style="background:#eef6ff; border:1px solid #bfdbfe; border-radius:12px; padding:18px; margin:22px 0;">
          <h2 style="font-size:18px; margin:0 0 12px; color:#1e3a8a;">Erste unverbindliche Einschätzung</h2>
          ${calculationHtml}
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

function buildInternalEmailHtml({ name, email, phone, amount, desiredMonthly, result }) {
  const calculationHtml = result.success
    ? `
      <p><strong>Finanzierungsbetrag:</strong> ${formatEuro(result.amountRounded)} €</p>
      <p><strong>Laufzeit:</strong> ${result.bestYear} Jahre</p>
      <p><strong>Geschätzte monatliche Rate:</strong> ${formatEuro(result.monthlyRounded)} €</p>
    `
    : `<p>${textToHtml(result.message)}</p>`;

  return `
<div style="font-family:Arial, Helvetica, sans-serif; background:#f4f6f8; padding:24px;">
  <div style="max-width:680px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; padding:24px;">
    <h2 style="margin-top:0;">Neue Finanzierungsanfrage</h2>

    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>
    <p><strong>Telefon:</strong> ${escapeHtml(phone)}</p>
    <p><strong>Betrag:</strong> ${isNaN(amount) ? "" : formatEuro(amount) + " €"}</p>
    <p><strong>Wunschrate:</strong> ${isNaN(desiredMonthly) ? "" : formatEuro(desiredMonthly) + " €"}</p>

    <h3>Berechnung</h3>
    ${calculationHtml}

    <p>Bitte zeitnah bearbeiten.</p>

    <hr style="border:none; border-top:1px solid #e5e7eb; margin:20px 0;">

    <p style="font-size:12px; color:#6b7280; line-height:1.6;">
      ${escapeHtml(COMPANY_NAME)}<br>
      ${escapeHtml(COMPANY_ADDRESS)}<br>
      Telefon: ${escapeHtml(COMPANY_PHONE)}<br>
      E-Mail: ${escapeHtml(COMPANY_EMAIL)}<br>
      Webseite: ${escapeHtml(COMPANY_WEBSITE)}
    </p>
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
      "/manual-calculate",
      "/calculate-loan",
      "/website-calculate",
      "/send-loan-email"
    ]
  });
});

app.post("/manual-calculate", (req, res) => {
  try {
    const input = normalizeInput(req.body.input);
    const extracted = extractNumbers(input);

    if (!extracted) {
      return res.status(200).json({
        success: false,
        message: `Leider konnten wir Ihre Angaben nicht eindeutig verarbeiten.

Bitte senden Sie den Kreditbetrag und die gewünschte monatliche Rate zum Beispiel so:
10000 / 300`
      });
    }

    const amount = cleanNumber(extracted[0]);
    const desiredMonthly = cleanNumber(extracted[1]);
    const result = calculateOffer(amount, desiredMonthly);

    return res.status(200).json({
      success: result.success,
      message: result.message
    });
  } catch (error) {
    console.error("manual-calculate error:", error);
    return res.status(500).json({
      success: false,
      message: "Interner Serverfehler."
    });
  }
});

app.post("/calculate-loan", (req, res) => {
  try {
    const amount = cleanNumber(req.body.loan_amount);
    const desiredMonthly = cleanNumber(req.body.desired_monthly);
    const phone = req.body.phone ? String(req.body.phone).replace(/[^\d]/g, "") : "";

    const result = calculateOffer(amount, desiredMonthly);

    if (!result.success) {
      return res.status(200).json({
        success: true,
        phone,
        loan_amount: "",
        desired_monthly: "",
        best_year: "",
        monthly_rate: "",
        offer_text: "",
        error_message: result.message
      });
    }

    return res.status(200).json({
      success: true,
      phone,
      loan_amount: result.amountRounded.toFixed(2),
      desired_monthly: desiredMonthly.toFixed(2),
      best_year: String(result.bestYear),
      monthly_rate: result.monthlyRounded.toFixed(2),
      offer_text: result.message,
      error_message: ""
    });
  } catch (error) {
    console.error("calculate-loan error:", error);
    return res.status(500).json({
      success: false,
      error_message: "Interner Serverfehler."
    });
  }
});

app.post("/website-calculate", (req, res) => {
  try {
    const amount = cleanNumber(req.body.loan_amount);
    const desiredMonthly = cleanNumber(req.body.desired_monthly);

    const result = calculateOffer(amount, desiredMonthly);

    if (!result.success) {
      return res.status(200).json({
        success: false,
        loan_amount: "",
        best_year: "",
        monthly_rate: "",
        error_message: result.message
      });
    }

    return res.status(200).json({
      success: true,
      loan_amount: result.amountRounded.toFixed(2),
      best_year: String(result.bestYear),
      monthly_rate: result.monthlyRounded.toFixed(2),
      error_message: ""
    });
  } catch (error) {
    console.error("website-calculate error:", error);
    return res.status(500).json({
      success: false,
      loan_amount: "",
      best_year: "",
      monthly_rate: "",
      error_message: "Interner Serverfehler."
    });
  }
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

    const phone = normalizeInput(
      body.phone ||
      body.Phone ||
      body.phone_number ||
      body["Phone Number"] ||
      body["Telefonnummer"]
    );

    const amountRaw =
      body.loan_amount ||
      body.amount ||
      body["Loan Amount"] ||
      body["Welchen Kreditbetrag möchten Sie anfragen?"] ||
      body["Kreditbetrag"];

    const desiredMonthlyRaw =
      body.desired_monthly ||
      body.monthly_rate ||
      body["Desired Monthly"] ||
      body["Welche monatliche Rate möchten Sie ungefähr zahlen?"] ||
      body["Monatliche Rate"];

    if (!email) {
      return res.status(400).json({
        success: false,
        error_message: "E-Mail-Adresse fehlt."
      });
    }

    const amount = cleanNumber(amountRaw);
    const desiredMonthly = cleanNumber(desiredMonthlyRaw);

    const result = calculateOffer(amount, desiredMonthly);
    const documentsList = getDocumentsList();

    const clientEmailHtml = buildClientEmailHtml({
      name,
      amount,
      desiredMonthly,
      result,
      documentsList
    });

    const internalEmailHtml = buildInternalEmailHtml({
      name,
      email,
      phone,
      amount,
      desiredMonthly,
      result
    });

    await sendZohoEmail({
      to: email,
      toName: name,
      subject: "Ihre Anfrage ist eingegangen",
      htmlbody: clientEmailHtml
    });

    if (process.env.INTERNAL_NOTIFY_EMAIL) {
      await sendZohoEmail({
        to: process.env.INTERNAL_NOTIFY_EMAIL,
        toName: "Intern",
        subject: "Neue Finanzierungsanfrage",
        htmlbody: internalEmailHtml
      });
    }

    return res.status(200).json({
      success: true,
      message: "E-Mail wurde erfolgreich über Zoho gesendet.",
      email_sent_to: email,
      calculation_success: result.success
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
