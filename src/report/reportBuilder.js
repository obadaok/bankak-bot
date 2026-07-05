const { formatNumber } = require('../utils/numberFormatter');
const { getShortName } = require('../parser/bankakParser');

function buildReport(stats) {
  if (stats.totalCount === 0) {
    return null;
  }

  const lines = [];
  lines.push('📊 تقرير بنكك');
  lines.push('');
  lines.push(`عدد العمليات:\n${stats.totalCount}`);
  lines.push('');
  lines.push(`إجمالي المبالغ:\n${formatNumber(stats.totalAmount)} ج.س`);
  lines.push('');
  lines.push('الحسابات:');
  lines.push('');

  stats.accounts.forEach((account, index) => {
    lines.push(`${index + 1}-`);
    lines.push('');
    lines.push(`الحساب:\n${account.accountNumber}`);
    lines.push('');
    lines.push(`الاسم:\n${getShortName(account.name)}`);
    lines.push('');
    lines.push(`عدد العمليات:\n${account.count}`);
    lines.push('');
    lines.push(`المجموع:\n${formatNumber(account.total)} ج.س`);
    lines.push('');
  });

  return lines.join('\n');
}

function buildTimeoutMessage() {
  return 'انتهى الوقت، حاول من جديد';
}

module.exports = { buildReport, buildTimeoutMessage };
