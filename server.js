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

function calculateOffer(amount, desiredMonthly) {
  if (isNaN(amount) || isNaN(desiredMonthly)) {
    return {
      success: false,
      message: `Vielen Dank für die Rückmeldung.

Leider konnten wir Ihre Angaben nicht eindeutig verarbeiten.

Bitte senden Sie den Kreditbetrag und die gewünschte monatliche Rate zum Beispiel so:
10000 / 300`
    };
  }

  if (amount < 3500) {
    return {
      success: false,
      message: `Vielen Dank für die Rückmeldung.

Der Mindestkreditbetrag beträgt 3.500 €.`
    };
  }

  if (amount > 300000) {
    return {
      success: false,
      message: `Vielen Dank für die Rückmeldung.

Der maximale Kreditbetrag beträgt 300.000 €.`
    };
  }

  if (desiredMonthly <= 0) {
    return {
      success: false,
      message: `Vielen Dank für die Rückmeldung.

Die monatliche Rate muss größer als 0 sein.`
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
      message: `Vielen Dank für die Rückmeldung.

Mit der gewünschten monatlichen Rate ist für diesen Kreditbetrag innerhalb der maximalen Laufzeit leider kein Angebot möglich.

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
    message: `Vielen Dank für die Rückmeldung.

Wir können Ihnen folgendes Angebot machen:

Kredit über ${formatEuro(amountRounded)} €

Laufzeit ${bestYear} Jahre

monatliche Rate ${formatEuro(monthlyRounded)} €

Bitte bestätigen Sie dies kurz, damit wir Ihnen die Liste der für den Antrag erforderlichen Unterlagen zusenden können.

Bei Fragen melden Sie sich gerne jederzeit.`
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

async function sendZohoEmail({ to, toName, subject, text }) {
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
    subject: subject,
    htmlbody: textToHtml(text)
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

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Loan webhook is running",
    endpoints: ["/manual-calculate", "/calculate-loan", "/website-calculate", "/send-loan-email"]
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

    const income = normalizeInput(req.body.income);
    const schufa = normalizeInput(req.body.schufa);
    const employment = normalizeInput(req.body.employment);

    if (!email) {
      return res.status(400).json({
        success: false,
        error_message: "E-Mail-Adresse fehlt."
      });
    }

    const result = calculateOffer(amount, desiredMonthly);
    const documentsList = getDocumentsList(employment);

    let calculationText = "";

    if (result.success) {
      calculationText = `Unverbindliche Beispielrechnung:
Finanzierungsbetrag: ${formatEuro(result.amountRounded)} €
Laufzeit: ${result.bestYear} Jahre
Geschätzte monatliche Rate: ${formatEuro(result.monthlyRounded)} €`;
    } else {
      calculationText = `Hinweis:
${result.message}`;
    }

    const clientEmailText = `Hallo ${name || ""},

vielen Dank für Ihre Finanzierungsanfrage.

Wir haben Ihre Angaben erhalten und eine erste unverbindliche Einschätzung für Sie vorbereitet.

Ihre Angaben:
Gewünschter Betrag: ${isNaN(amount) ? "" : formatEuro(amount) + " €"}
Gewünschte monatliche Rate: ${isNaN(desiredMonthly) ? "" : formatEuro(desiredMonthly) + " €"}
Einkommen vorhanden: ${income}
SCHUFA-Situation: ${schufa}
Beschäftigung: ${employment}

${calculationText}

Wichtig:
Dies ist keine finale Zusage. Die endgültige Prüfung hängt von Ihren Unterlagen, Ihrer Bonität und der Entscheidung des Finanzierungspartners ab.

Für die weitere Prüfung benötigen wir folgende Unterlagen:

${documentsList}

Bitte antworten Sie einfach auf diese E-Mail mit den Unterlagen oder teilen Sie uns mit, wann wir Sie telefonisch erreichen können.

Viele Grüße
Ihr Finanzierungsteam`;

    const internalEmailText = `Neue Finanzierungsanfrage eingegangen:

Name: ${name}
E-Mail: ${email}
Telefon: ${phone}
Betrag: ${isNaN(amount) ? "" : formatEuro(amount) + " €"}
Wunschrate: ${isNaN(desiredMonthly) ? "" : formatEuro(desiredMonthly) + " €"}
Einkommen: ${income}
SCHUFA: ${schufa}
Beschäftigung: ${employment}

${calculationText}

Bitte zeitnah kontaktieren.`;

    await sendZohoEmail({
      to: email,
      toName: name,
      subject: "Ihre Finanzierungsanfrage – erste unverbindliche Einschätzung",
      text: clientEmailText
    });

    if (process.env.INTERNAL_NOTIFY_EMAIL) {
      await sendZohoEmail({
        to: process.env.INTERNAL_NOTIFY_EMAIL,
        toName: "Intern",
        subject: "Neue Finanzierungsanfrage",
        text: internalEmailText
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
