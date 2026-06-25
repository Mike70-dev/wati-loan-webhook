const express = require("express");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function normalizeInput(text) {
  if (!text) return "";
  return String(text).trim();
}

function extractNumbers(text) {
  const matches = text.match(/[\d.,]+/g);
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
    bestYear: bestYear,
    monthlyRounded: monthlyRounded,
    amountRounded: amountRounded,
    message: `Vielen Dank für die Rückmeldung.

Wir können Ihnen folgendes Angebot machen:

Kredit über ${amountRounded} €

Laufzeit ${bestYear} Jahre

monatliche Rate ${monthlyRounded.toFixed(2)} €

Bitte bestätigen Sie dies kurz, damit wir Ihnen die Liste der für den Antrag erforderlichen Unterlagen zusenden können.

Bei Fragen melden Sie sich gerne jederzeit.`
  };
}

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loan Reply Generator</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f7f7f7;
      margin: 0;
      padding: 40px;
    }
    .container {
      max-width: 800px;
      margin: auto;
      background: white;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 4px 18px rgba(0,0,0,0.08);
    }
    h1 {
      margin-top: 0;
    }
    textarea {
      width: 100%;
      min-height: 120px;
      padding: 12px;
      font-size: 16px;
      border: 1px solid #ccc;
      border-radius: 8px;
      box-sizing: border-box;
    }
    button {
      margin-top: 12px;
      padding: 12px 18px;
      font-size: 16px;
      border: none;
      border-radius: 8px;
      background: #0b57d0;
      color: white;
      cursor: pointer;
    }
    button:hover {
      background: #0847aa;
    }
    .output {
      margin-top: 20px;
    }
    pre {
      background: #f1f1f1;
      padding: 16px;
      border-radius: 8px;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Loan Reply Generator</h1>
    <p>Paste client text like:</p>
    <p><strong>10000€ monatliche Rückzahlung 300€</strong> or <strong>10.000 / 150</strong></p>

    <textarea id="inputText" placeholder="Paste client message here..."></textarea>
    <br>
    <button onclick="calculate()">Calculate</button>

    <div class="output">
      <h2>Reply Text</h2>
      <pre id="result"></pre>
    </div>
  </div>

  <script>
    async function calculate() {
      const inputText = document.getElementById("inputText").value;

      const response = await fetch("/manual-calculate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ input: inputText })
      });

      const data = await response.json();
      document.getElementById("result").textContent = data.message || "No result";
    }
  </script>
</body>
</html>
  `);
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
        phone: phone,
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
      phone: phone,
      loan_amount: result.amountRounded.toFixed(2),
      desired_monthly: desiredMonthly.toFixed(2),
      best_year: String(result.bestYear),
      monthly_rate: result.monthlyRounded.toFixed(2),
      offer_text: result.message,
      error_message: ""
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error_message: "Interner Serverfehler."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
