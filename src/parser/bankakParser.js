const { parseAmount } = require('../utils/numberFormatter');

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const ARABIC_INDIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function normalizeDigits(text) {
  let result = text;
  for (let i = 0; i < 10; i++) {
    result = result.split(ARABIC_DIGITS[i]).join(String(i));
    result = result.split(ARABIC_INDIC_DIGITS[i]).join(String(i));
  }
  return result;
}

function trimAccountNumber(account) {
  const cleaned = account.replace(/\s+/g, '');
  if (cleaned.length >= 9) {
    return cleaned.slice(5, -4);
  }
  return cleaned;
}

function extractOperationNumber(text) {
  const match = text.match(/رقم العملية[:\s]*(\d+)/i);
  if (!match) return null;
  return match[1].trim();
}

function extractDateTime(text) {
  const match = text.match(/(\d{2}[-/][A-Za-z]+\d*[-/]\d{4}(\s+\d{2}:\d{2}(:\d{2})?)?)/i);
  return match ? match[1].trim() : null;
}

function extractFromAccount(text) {
  const match = text.match(/من حساب[:\s]*(\d{4,20})/i);
  if (!match) return null;
  return trimAccountNumber(match[1]);
}

function extractToAccount(text) {
  const match = text.match(/إلى حساب[:\s]*(\d{4,20})/i);
  return match ? trimAccountNumber(match[1]) : null;
}

function extractBeneficiaryName(text) {
  const match = text.match(/اسم المرسل اليه[:\s]*(.+)/i);
  if (match) return match[1].trim();

  const alt = text.match(/اسم المستفيد[:\s]*(.+)/i);
  return alt ? alt[1].trim() : null;
}

function extractMobile(text) {
  const match = text.match(/رقم الموبايل[:\s]*(\d{7,15})/i);
  return match ? match[1].trim() : null;
}

function extractComment(text) {
  const match = text.match(/التعليق[:\s]*(.+)/i);
  return match ? match[1].trim() : null;
}

function extractAmount(text) {
  const match = text.match(/(?:المبلغ|المبلع)[:\s]*([\d,]+(?:\.\d{1,3})?)/i);
  if (match) {
    const parsed = parseAmount(match[1]);
    if (parsed !== null) return parsed;
  }

  const allAmounts = [];
  let m;
  while ((m = /([\d,]+\.\d{2})/g.exec(text)) !== null) {
    const val = parseAmount(m[1]);
    if (val !== null && val > 0) allAmounts.push({ val, start: m.index });
  }
  if (allAmounts.length === 0) {
    while ((m = /([\d,]+)\s*(?:جنيه|SDG|ج\.س)/gi.exec(text)) !== null) {
      const val = parseAmount(m[1]);
      if (val !== null && val > 0) allAmounts.push({ val, start: m.index });
    }
  }

  if (allAmounts.length === 0) return null;
  if (allAmounts.length === 1) return allAmounts[0].val;

  const amountLabelPos = text.search(/المبلغ|المبلع/i);
  if (amountLabelPos !== -1) {
    const closest = allAmounts.reduce((a, b) =>
      Math.abs(a.start - amountLabelPos) < Math.abs(b.start - amountLabelPos) ? a : b
    );
    return closest.val;
  }

  return allAmounts[0].val;
}

function parseNotification(text) {
  const normalized = normalizeDigits(text);

  const operationId = extractOperationNumber(normalized);
  const dateTime = extractDateTime(normalized);
  const fromAccount = extractFromAccount(normalized);
  const toAccount = extractToAccount(normalized);
  const beneficiaryName = extractBeneficiaryName(normalized);
  const mobile = extractMobile(normalized);
  const comment = extractComment(normalized);
  const amount = extractAmount(normalized);

  if (amount === null) return null;

  const accounts = [];
  if (fromAccount) accounts.push(fromAccount);
  if (toAccount) accounts.push(toAccount);

  return {
    operationId,
    operationDisplay: operationId ? operationId.slice(-4) : null,
    dateTime,
    fromAccount,
    toAccount,
    accounts: accounts.length > 0 ? accounts : ['unknown'],
    beneficiaryName,
    mobile,
    comment,
    amount,
    currency: 'SDG',
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
