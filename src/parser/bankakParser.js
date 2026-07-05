const { parseAmount } = require('../utils/numberFormatter');

const PATTERNS = {
  operationNumber: /رقم العملية[:\s]*(\d+)/i,
  operationNumberAlt: /رقم[:\s]*(\d{8,})/i,
  dateTime: /(\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2}:\d{2})/,
  dateTimeAlt: /(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/,
  accountGroups: /(\d{4})\s+(\d{4})\s+(\d{4,7})\s+(\d{4})/g,
  accountLong: /(\d{6,10})/g,
  beneficiaryName: /اسم المستفيد[:\s]*(.+)/i,
  beneficiaryNameAlt: /المستفيد[:\s]*(.+)/i,
  senderName: /اسم المرسل[:\s]*(.+)/i,
  amount: /المبلغ[:\s]*([\d,]+\.\d{2})/i,
  amountBefore: /([\d,]+\.\d{2})\s*المبلغ/i,
  amountGeneric: /([\d,]+\.\d{2})/,
};

function extractAccountParts(text) {
  const matches = [];
  let match;
  while ((match = PATTERNS.accountGroups.exec(text)) !== null) {
    const middle = match[2] + match[3];
    const stripped = middle.replace(/^0+/, '');
    if (stripped.length >= 5) matches.push(stripped);
  }

  if (matches.length === 0) {
    while ((match = PATTERNS.accountLong.exec(text)) !== null) {
      const num = match[1];
      if (num.length >= 6 && num.length <= 10) {
        const stripped = num.replace(/^0+/, '');
        if (!matches.includes(stripped)) matches.push(stripped);
      }
    }
  }

  return matches;
}

function extractOperationNumber(text) {
  let match = text.match(PATTERNS.operationNumber);
  if (!match) match = text.match(PATTERNS.operationNumberAlt);
  if (!match) return null;
  const full = match[1].trim();
  return full.slice(-4);
}

function extractDateTime(text) {
  let match = text.match(PATTERNS.dateTime);
  if (!match) match = text.match(PATTERNS.dateTimeAlt);
  return match ? match[1].trim() : null;
}

function extractBeneficiaryName(text) {
  let match = text.match(PATTERNS.beneficiaryName);
  if (!match) match = text.match(PATTERNS.beneficiaryNameAlt);
  return match ? match[1].trim() : null;
}

function extractSenderName(text) {
  const match = text.match(PATTERNS.senderName);
  return match ? match[1].trim() : null;
}

function extractAmount(text) {
  let match = text.match(PATTERNS.amount);
  if (!match) match = text.match(PATTERNS.amountBefore);

  if (!match) {
    const allAmounts = [...text.matchAll(PATTERNS.amountGeneric)];
    const validAmounts = allAmounts
      .map((m) => parseAmount(m[1]))
      .filter((v) => v !== null && v > 0);
    if (validAmounts.length > 0) {
      return Math.max(...validAmounts);
    }
    return null;
  }

  const parsed = parseAmount(match[1]);
  return parsed !== null ? parsed : null;
}

function parseNotification(text) {
  const operationId = extractOperationNumber(text);
  const dateTime = extractDateTime(text);
  const accounts = extractAccountParts(text);
  const beneficiaryName = extractBeneficiaryName(text);
  const senderName = extractSenderName(text);
  const amount = extractAmount(text);

  const hasAmount = amount !== null;
  const hasAccount = accounts.length > 0;

  if (!hasAmount) return null;

  return {
    operationId: operationId || (amount ? String(Date.now()).slice(-4) : null),
    dateTime,
    accounts: hasAccount ? accounts : ['unknown'],
    beneficiaryName,
    senderName,
    amount,
    fromOcr: !operationId,
  };
}

function getShortName(fullName) {
  if (!fullName) return 'غير معروف';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 2) return fullName.trim();
  return parts.slice(0, 2).join(' ');
}

module.exports = { parseNotification, getShortName };
