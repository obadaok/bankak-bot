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
  amountGeneric: /([\d,]+\.\d{2})/g,
};

function hasOverlap(start, end, ranges) {
  return ranges.some((r) => start < r.end && end > r.start);
}

function extractAccountParts(text) {
  const matches = [];
  const usedRanges = [];

  let match;
  while ((match = PATTERNS.accountGroups.exec(text)) !== null) {
    const middle = match[2] + match[3];
    const stripped = middle.replace(/^0+/, '');
    if (stripped.length >= 5) {
      matches.push(stripped);
      usedRanges.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  if (matches.length === 0) {
    while ((match = PATTERNS.accountLong.exec(text)) !== null) {
      const num = match[1];
      const start = match.index;
      const end = start + match[0].length;

      if (hasOverlap(start, end, usedRanges)) continue;

      if (num.length >= 6 && num.length <= 10) {
        const stripped = num.replace(/^0+/, '');
        if (!matches.includes(stripped)) {
          matches.push(stripped);
          usedRanges.push({ start, end });
        }
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
  return { full, display: full.slice(-4) };
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
    const allAmounts = [];
    let m;
    while ((m = PATTERNS.amountGeneric.exec(text)) !== null) {
      const val = parseAmount(m[1]);
      if (val !== null && val > 0) {
        allAmounts.push({ val, start: m.index });
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

  const parsed = parseAmount(match[1]);
  return parsed !== null ? parsed : null;
}

function parseNotification(text) {
  const normalized = normalizeDigits(text);

  const operationId = extractOperationNumber(normalized);
  const dateTime = extractDateTime(normalized);
  const accounts = extractAccountParts(normalized);
  const beneficiaryName = extractBeneficiaryName(normalized);
  const senderName = extractSenderName(normalized);
  const amount = extractAmount(normalized);

  if (amount === null) return null;

  return {
    operationId: operationId ? operationId.full : null,
    operationDisplay: operationId ? operationId.display : null,
    dateTime,
    accounts: accounts.length > 0 ? accounts : ['unknown'],
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
