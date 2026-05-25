const express = require("express");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function cleanNumber(value) {
  if (value === undefined || value === null) return NaN;

  let str = String(value).trim();

  // Remove spaces and currency symbols, but keep digits, dots, and commas
  str = str.replace(/[^\d.,]/g, "");

  // If both dot and comma exist, assume European style like 5.000,50
  if (str.includes(".") && str.includes(",")) {
    str = str.replace(/\./g, "");
    str = str.replace(",", ".");
  } 
  // If only dot exists, check if it's a thousands separator like 5.000
  else if (str.includes(".")) {
    if (/^\d{1,3}(\.\d{3})+$/.test(str)) {
      str = str.replace(/\./g, "");
    }
  } 
  // If only comma exists, decide whether it's thousands or decimal separator
  else if (str.includes(",")) {
    if (/^\d{1,3}(,\d{3})+$/.test(str)) {
      str = str.replace(/,/g, "");
    } else {
      str = str.replace(",", ".");
    }
  }

  return parseFloat(str);
}

app.get("/", (req, res) => {
  res.send("Wati loan webhook is running.");
});

app.post("/calculate-loan", (req, res) => {
  try {
    const amount = cleanNumber(req.body.loan_amount);
    const desiredMonthly = cleanNumber(req.body.desired_monthly);
    const phone = req.body.phone ? String(req.body.phone).replace(/[^\d]/g, "") : "";

    if (isNaN(amount) || isNaN(desiredMonthly)) {
      return res.status(200).json({
        success: true,
        error_message: "Ungültige Eingabe. Kreditbetrag oder monatliche Rate ist keine gültige Zahl."
      });
    }

    if (amount < 3500) {
      return res.status(200).json({
        success: true,
        error_message: "Der Mindestkreditbetrag beträgt 3.500 €."
      });
    }

    if (desiredMonthly <= 0) {
      return res.status(200).json({
        success: true,
        error_message: "Die monatliche Rate muss größer als 0 sein."
      });
    }

    const minYears = 1;
    const maxYears = 10;
    const yearlyRate = 0.025;

    let bestYear = null;
    let bestMonthly = null;
    let smallestDifference = Infinity;

    for (let year = minYears; year <= maxYears; year++) {
      const totalRepayment = amount * (1 + yearlyRate * year);
      const monthlyPayment = totalRepayment / (year * 12);
      const difference = Math.abs(desiredMonthly - monthlyPayment);

      if (difference < smallestDifference) {
        smallestDifference = difference;
        bestYear = year;
        bestMonthly = monthlyPayment;
      }
    }

    const monthlyRounded = Number(bestMonthly.toFixed(2));
    const amountRounded = Number(amount.toFixed(2));

    const offerText = `Vielen Dank für Ihre Rückmeldung.
Auf Basis Ihrer Angaben können wir Ihnen folgendes unverbindliches Angebot machen:
Kredit über: ${amountRounded} €
Laufzeit: ${bestYear} Jahre
Voraussichtliche monatliche Rate: ${monthlyRounded.toFixed(2)} €
Bitte bestätigen Sie dies kurz, damit wir Ihnen die Liste der für den Antrag erforderlichen Unterlagen zusenden können.
Die endgültige Prüfung erfolgt nach Sichtung Ihrer Unterlagen.`;

    return res.status(200).json({
      success: true,
      phone: phone,
      loan_amount: amountRounded.toFixed(2),
      desired_monthly: desiredMonthly.toFixed(2),
      best_year: String(bestYear),
      monthly_rate: monthlyRounded.toFixed(2),
      offer_text: offerText,
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
  console.log(`Server running on port ${PORT}`);
});
