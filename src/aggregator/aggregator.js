class Aggregator {
  constructor() {
    this.seenOperations = new Set();
    this.accounts = new Map();
    this.totalCount = 0;
    this.totalAmount = 0;
  }

  addOperation(parsed) {
    const dedupId = parsed.operationId || `ocr_${parsed.amount}_${parsed.accounts?.[0] || 'unknown'}_${Date.now()}`;

    if (this.seenOperations.has(dedupId)) {
      return false;
    }

    this.seenOperations.add(dedupId);
    this.totalCount += 1;
    this.totalAmount += parsed.amount;

    for (const accountNumber of parsed.accounts) {
      if (!this.accounts.has(accountNumber)) {
        this.accounts.set(accountNumber, {
          accountNumber,
          name: parsed.beneficiaryName || parsed.senderName || 'غير معروف',
          count: 0,
          total: 0,
        });
      }

      const account = this.accounts.get(accountNumber);
      account.count += 1;
      account.total += parsed.amount;

      if (parsed.beneficiaryName && account.name === 'غير معروف') {
        account.name = parsed.beneficiaryName;
      }
    }

    return true;
  }

  getStats() {
    return {
      totalCount: this.totalCount,
      totalAmount: this.totalAmount,
      accounts: Array.from(this.accounts.values())
        .sort((a, b) => b.total - a.total),
    };
  }

  isEmpty() {
    return this.totalCount === 0;
  }

  clear() {
    this.seenOperations.clear();
    this.accounts.clear();
    this.totalCount = 0;
    this.totalAmount = 0;
  }
}

module.exports = Aggregator;
