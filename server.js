const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

  // Take the first number-like part if the value contains text or ranges
  const match = str.match(/[\d.,]+/);
  if (!match) return NaN;

  str = match[0];
  str = str.replace(/[^\d.,]/g, "");

  if (str.includes(".") && str.includes(",")) {
    // German format: 10.000,50 -> 10000.50
    str = str.replace(/\./g, "");
    str = str.replace(",", ".");
  } else if (str.includes(".")) {
    // German thousand separator: 10.000 -> 10000
    if (/^\d{1,3}(\.\d{3})+$/.test(str)) {
      str = str.replace(/\./g, "");
    }
  } else if (str.includes(",")) {
    // German decimal comma or thousand comma
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

function getDocumentsList(employment) {
  const emp = String(employment || "").toLowerCase();

  if (emp.includes("selbst")) {
    return `- Personalausweis oder Reisepass
- Kontoauszüge der letzten 3 Monate
- Aktuelle BWA
- Letzter Steuerbescheid
- Gewerbeanmeldung, falls vorhanden`;
  }

  if (emp.includes("rent")) {
    return `- Personalausweis oder Reisepass
- Rentenbescheid
- Kontoauszüge der letzten 3 Monate`;
  }

  if (emp.includes("arbeitslos")) {
    return `- Personalausweis oder Reisepass
- Nachweis über aktuelle Leistungen
- Kontoauszüge der letzten 3 Monate`;
  }

  return `- Personalausweis oder Reisepass
- Einkommensnachweise der letzten 3 Monate
- Kontoauszüge der letzten 3 Monate
- Arbeitsvertrag oder Beschäftigungsnachweis`;
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

async function sendZohoEmail({ to, toName, subject, htmlbody }) {
  const host = process.env.ZOHO_CPAA_HOST || "https://cpaas.zoho.eu";
  const token = process.env.ZOHO_CPAA_TOKEN;
  const fromEmail = process.env.FROM_EMAIL;
  const fromName = process.env.FROM_NAME || "Finanzierungsteam";
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

function buildClientEmailHtml({
  name,
  amount,
  desiredMonthly,
  result,
  documentsList
}) {
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
          Hallo ${safeName || " "},
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
        <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:12px; padding:18px; margin-bottom:22px; line-height:1.6;">
          ${documentsHtml}
        </div>

        <h2 style="font-size:18px; margin:24px 0 12px; color:#111827;">Nächster Schritt</h2>
        <p style="font-size:16px; line-height:1.6; margin:0 0 18px;">
          Bitte antworten Sie einfach auf diese E-Mail mit den Unterlagen. Danach prüfen wir Ihre Anfrage weiter.
        </p>

        <p style="font-size:16px; line-height:1.6; margin:28px 0 0;">
          Viele Grüße<br>
          <strong>Ihr Finanzierungsteam</strong>
        </p>
      </div>
    </div>

    <p style="font-size:12px; color:#6b7280; line-height:1.5; margin:16px 4px 0;">
      Sie erhalten diese E-Mail, weil Sie eine Finanzierungsanfrage gestellt haben.
    </p>
  </div>
</div>
`;
}

function buildInternalEmailHtml({
  name,
  email,
  phone,
  amount,
  desiredMonthly,
  result
}) {
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
  </div>
</div>
`;
}

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
        message: `Vielen Dank für die Rückmeldung.

Leider konnten wir Ihre Angaben nicht eindeutig verarbeiten.

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
    const name = normalizeInput(req.body.name);
    const email = normalizeInput(req.body.email);
    const phone = normalizeInput(req.body.phone);

    const amount = cleanNumber(req.body.loan_amount || req.body.amount);
    const desiredMonthly = cleanNumber(req.body.desired_monthly || req.body.monthly_rate);

    const employment = normalizeInput(req.body.employment);

    if (!email) {
      return res.status(400).json({
        success: false,
        error_message: "E-Mail-Adresse fehlt."
      });
    }

    const result = calculateOffer(amount, desiredMonthly);
    const documentsList = getDocumentsList(employment);

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
