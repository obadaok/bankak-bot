const { parseAmount } = require('../utils/numberFormatter');

const PATTERNS = {
  operationNumber: /رقم العملية[:\s]*(\d+)/i,
  dateTime: /(\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2}:\d{2})/,
  accountGroups: /(\d{4})\s+(\d{4})\s+(\d{4,7})\s+(\d{4})/g,
  beneficiaryName: /اسم المستفيد[:\s]*(.+)/i,
  senderName: /اسم المرسل[:\s]*(.+)/i,
  amount: /المبلغ[:\s]*([\d,]+\.\d{2})/i,
};

function extractAccountParts(text) {
  const matches = [];
  let match;
  while ((match = PATTERNS.accountGroups.exec(text)) !== null) {
    const middle = match[2] + match[3];
    const stripped = middle.replace(/^0+/, '');
    matches.push(stripped);
  }
  return matches;
}

function extractOperationNumber(text) {
  const match = text.match(PATTERNS.operationNumber);
  if (!match) return null;
  const full = match[1].trim();
  return full.slice(-4);
}

function extractDateTime(text) {
  const match = text.match(PATTERNS.dateTime);
  return match ? match[1].trim() : null;
}

function extractBeneficiaryName(text) {
  const match = text.match(PATTERNS.beneficiaryName);
  return match ? match[1].trim() : null;
}

function extractSenderName(text) {
  const match = text.match(PATTERNS.senderName);
  return match ? match[1].trim() : null;
}

function extractAmount(text) {
  const match = text.match(PATTERNS.amount);
  if (!match) return null;
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

  const hasMinimumFields = operationId !== null && amount !== null && accounts.length > 0;

  if (!hasMinimumFields) return null;

  return {
    operationId,
    dateTime,
    accounts,
    beneficiaryName,
    senderName,
    amount,
  };
}

function getShortName(fullName) {
  if (!fullName) return 'غير معروف';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 2) return fullName.trim();
  return parts.slice(0, 2).join(' ');
}

module.exports = { parseNotification, getShortName };
