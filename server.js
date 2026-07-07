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

function getMessages(language) {
  const lang = (language || "de").toLowerCase();

  if (lang === "tr") {
    return {
      parseError: `Teşekkür ederiz.

Bilgilerinizi net olarak işleyemedik.

Lütfen kredi tutarını ve istediğiniz aylık ödemeyi örneğin şu şekilde gönderin:
10000 / 300`,
      minLoan: `Teşekkür ederiz.

Asgari kredi tutarı 3.500 €'dur.`,
      maxLoan: `Teşekkür ederiz.

Azami kredi tutarı 300.000 €'dur.`,
      invalidMonthly: `Teşekkür ederiz.

Aylık taksit 0'dan büyük olmalıdır.`,
      noOffer: `Teşekkür ederiz.

İstenen aylık taksit ile bu kredi tutarı için azami vade içinde maalesef bir teklif mümkün değildir.

Lütfen daha yüksek bir aylık ödeme tutarı veya daha düşük bir kredi tutarı düşünüp düşünmediğinizi bize bildirin.`,
      offer: (amountRounded, bestYear, monthlyRounded) => `Az önce gerçekleştirmiş olduğumuz telefon görüşmesi için teşekkür ederiz.

Telefonda yapılan değerlendirmeye ilişkin hesaplama özeti aşağıda bilgilerinize sunulmuştur:

Kredi tutarı: ${amountRounded} €
Vade: ${bestYear} yıl
Tahmini aylık taksit: ${monthlyRounded.toFixed(2)} €

Lütfen bilgileri kontrol ederek uygun bulmanız halinde bu sohbet üzerinden tarafımıza teyit iletmenizi rica ederiz. Onayınız sonrasında, sürecin devamı için gerekli belgeler tarafınıza iletilecektir.

Sonuçların, hafta sonları hariç olmak üzere, 24 saat içerisinde paylaşılması planlanmaktadır.`
    };
  }

  return {
    parseError: `Vielen Dank für die Rückmeldung.

Leider konnten wir Ihre Angaben nicht eindeutig verarbeiten.

Bitte senden Sie den Kreditbetrag und die gewünschte monatliche Rate zum Beispiel so:
10000 / 300`,
    minLoan: `Vielen Dank für die Rückmeldung.

Der Mindestkreditbetrag beträgt 3.500 €.`,
    maxLoan: `Vielen Dank für die Rückmeldung.

Der maximale Kreditbetrag beträgt 300.000 €.`,
    invalidMonthly: `Vielen Dank für die Rückmeldung.

Die monatliche Rate muss größer als 0 sein.`,
    noOffer: `Vielen Dank für die Rückmeldung.

Mit der gewünschten monatlichen Rate ist für diesen Kreditbetrag innerhalb der maximalen Laufzeit leider kein Angebot möglich.

Bitte teilen Sie uns gerne mit, ob eine höhere monatliche Rate oder ein geringerer Kreditbetrag für Sie infrage kommt.`,
    offer: (amountRounded, bestYear, monthlyRounded) => `Vielen Dank für die Rückmeldung.

Wir können Ihnen folgendes Angebot machen:

Kredit über ${amountRounded} €

Laufzeit ${bestYear} Jahre

monatliche Rate: ${monthlyRounded.toFixed(2)} €

Bitte bestätigen Sie dies kurz, damit wir Ihnen die Liste der für den Antrag erforderlichen Unterlagen zusenden können.

Bei Fragen melden Sie sich gerne jederzeit.`
  };
}

function calculateOffer(amount, desiredMonthly, language = "de") {
  const msgs = getMessages(language);

  if (isNaN(amount) || isNaN(desiredMonthly)) {
    return {
      success: false,
      message: msgs.parseError
    };
  }

  if (amount < 3500) {
    return {
      success: false,
      message: msgs.minLoan
    };
  }

  if (amount > 300000) {
    return {
      success: false,
      message: msgs.maxLoan
    };
  }

  if (desiredMonthly <= 0) {
    return {
      success: false,
      message: msgs.invalidMonthly
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
      message: msgs.noOffer
    };
  }

  const monthlyRounded = Number(bestMonthly.toFixed(2));
  const amountRounded = Number(amount.toFixed(2));

  return {
    success: true,
    bestYear: bestYear,
    monthlyRounded: monthlyRounded,
    amountRounded: amountRounded,
    message: msgs.offer(amountRounded, bestYear, monthlyRounded)
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
      max-width: 860px;
      margin: auto;
      background: white;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 4px 18px rgba(0,0,0,0.08);
    }
    h1 {
      margin-top: 0;
    }
    .lang-switch {
      display: flex;
      gap: 10px;
      margin: 16px 0 24px 0;
      flex-wrap: wrap;
    }
    .lang-btn {
      padding: 10px 14px;
      border: 1px solid #ccc;
      border-radius: 8px;
      background: #fff;
      cursor: pointer;
      font-weight: 700;
    }
    .lang-btn.active {
      background: #0b57d0;
      color: #fff;
      border-color: #0b57d0;
    }
    label {
      display: block;
      margin-top: 14px;
      margin-bottom: 8px;
      font-weight: 700;
    }
    input {
      width: 100%;
      padding: 12px;
      font-size: 16px;
      border: 1px solid #ccc;
      border-radius: 8px;
      box-sizing: border-box;
    }
    .helper {
      color: #666;
      font-size: 14px;
      margin-top: 6px;
    }
    button.calc {
      margin-top: 16px;
      padding: 12px 18px;
      font-size: 16px;
      border: none;
      border-radius: 8px;
      background: #0b57d0;
      color: white;
      cursor: pointer;
    }
    button.calc:hover {
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
      min-height: 120px;
    }
    .section-title {
      margin-top: 24px;
      margin-bottom: 8px;
      font-size: 18px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1 id="title">Loan Reply Generator</h1>
    <p id="intro1">Paste client text like:</p>
    <p id="intro2"><strong>10000€ monthly repayment 300€</strong> or <strong>10.000 / 150</strong></p>

    <div class="lang-switch">
      <button id="btn-de" class="lang-btn active" onclick="setLanguage('de')">Deutsch</button>
      <button id="btn-tr" class="lang-btn" onclick="setLanguage('tr')">Türkçe</button>
    </div>

    <label id="labelLoan" for="loan_amount">Loan Amount</label>
    <input id="loan_amount" type="text" placeholder="e.g. 5000 or 10.000">

    <label id="labelMonthly" for="desired_monthly">Desired Monthly Payment</label>
    <input id="desired_monthly" type="text" placeholder="e.g. 100 or 750">

    <div class="helper" id="helperText">
      You can enter values like 5000 / 100, 10.000 / 150, or paste them from WhatsApp.
    </div>

    <button class="calc" onclick="calculate()">Calculate</button>

    <div class="output">
      <div class="section-title" id="replyTitle">Reply Text</div>
      <pre id="result"></pre>
    </div>
  </div>

  <script>
    let currentLanguage = 'de';

    const uiTexts = {
      de: {
        title: 'Loan Reply Generator',
        intro1: 'Paste client text like:',
        intro2: '<strong>10000€ monthly repayment 300€</strong> or <strong>10.000 / 150</strong>',
        loanLabel: 'Loan Amount',
        monthlyLabel: 'Desired Monthly Payment',
        helper: 'You can enter values like 5000 / 100, 10.000 / 150, or paste them from WhatsApp.',
        calculate: 'Calculate',
        replyTitle: 'Reply Text',
        placeholderLoan: 'e.g. 5000 or 10.000',
        placeholderMonthly: 'e.g. 100 or 750'
      },
      tr: {
        title: 'Kredi Cevap Oluşturucu',
        intro1: 'Müşteri metnini yapıştırın, örneğin:',
        intro2: '<strong>10000€ aylık ödeme 300€</strong> veya <strong>10.000 / 150</strong>',
        loanLabel: 'Kredi Tutarı',
        monthlyLabel: 'Beklenen Aylık Taksit',
        helper: '5000 / 100, 10.000 / 150 gibi değerler girebilir veya WhatsApp’tan yapıştırabilirsiniz.',
        calculate: 'Hesapla',
        replyTitle: 'Cevap Metni',
        placeholderLoan: 'örn. 5000 veya 10.000',
        placeholderMonthly: 'örn. 100 veya 750'
      }
    };

    function setLanguage(lang) {
      currentLanguage = lang;
      document.getElementById('btn-de').classList.toggle('active', lang === 'de');
      document.getElementById('btn-tr').classList.toggle('active', lang === 'tr');

      document.getElementById('title').textContent = uiTexts[lang].title;
      document.getElementById('intro1').textContent = uiTexts[lang].intro1;
      document.getElementById('intro2').innerHTML = uiTexts[lang].intro2;
      document.getElementById('labelLoan').textContent = uiTexts[lang].loanLabel;
      document.getElementById('labelMonthly').textContent = uiTexts[lang].monthlyLabel;
      document.getElementById('helperText').textContent = uiTexts[lang].helper;
      document.querySelector('button.calc').textContent = uiTexts[lang].calculate;
      document.getElementById('replyTitle').textContent = uiTexts[lang].replyTitle;
      document.getElementById('loan_amount').placeholder = uiTexts[lang].placeholderLoan;
      document.getElementById('desired_monthly').placeholder = uiTexts[lang].placeholderMonthly;
      document.getElementById('result').textContent = '';
    }

    function buildReply(language, success, data) {
      if (!success) {
        return data.message || "No result";
      }

      if (language === 'tr') {
        return `Az önce gerçekleştirmiş olduğumuz telefon görüşmesi için teşekkür ederiz.

Telefonda yapılan değerlendirmeye ilişkin hesaplama özeti aşağıda bilgilerinize sunulmuştur:

Kredi tutarı: ${data.loan_amount} €
Vade: ${data.best_year} yıl
Tahmini aylık taksit: ${Number(data.monthly_rate).toFixed(2)} €

Lütfen bilgileri kontrol ederek uygun bulmanız halinde bu sohbet üzerinden tarafımıza teyit iletmenizi rica ederiz. Onayınız sonrasında, sürecin devamı için gerekli belgeler tarafınıza iletilecektir.

Sonuçların, hafta sonları hariç olmak üzere, 24 saat içerisinde paylaşılması planlanmaktadır.`;
      }

      return `Vielen Dank für die Rückmeldung.

Wir können Ihnen folgendes Angebot machen:

Kredit über ${data.loan_amount} €

Laufzeit ${data.best_year} Jahre

monatliche Rate: ${Number(data.monthly_rate).toFixed(2)} €

Bitte bestätigen Sie dies kurz, damit wir Ihnen die Liste der für den Antrag erforderlichen Unterlagen zusenden können.

Bei Fragen melden Sie sich gerne jederzeit.`;
    }

    async function calculate() {
      const loanAmount = document.getElementById("loan_amount").value;
      const desiredMonthly = document.getElementById("desired_monthly").value;

      const response = await fetch("/website-calculate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          loan_amount: loanAmount,
          desired_monthly: desiredMonthly,
          language: currentLanguage
        })
      });

      const data = await response.json();

      const reply = buildReply(currentLanguage, data.success, data);
      document.getElementById("result").textContent = reply || "No result";
    }

    setLanguage('de');
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
    const result = calculateOffer(amount, desiredMonthly, "de");

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
    const language = req.body.language || "de";

    const result = calculateOffer(amount, desiredMonthly, language);

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

app.post("/website-calculate", (req, res) => {
  try {
    const amount = cleanNumber(req.body.loan_amount);
    const desiredMonthly = cleanNumber(req.body.desired_monthly);
    const language = req.body.language || "de";

    const result = calculateOffer(amount, desiredMonthly, language);

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
    return res.status(500).json({
      success: false,
      loan_amount: "",
      best_year: "",
      monthly_rate: "",
      error_message: "Interner Serverfehler."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
