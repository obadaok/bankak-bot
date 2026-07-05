const Aggregator = require('../aggregator/aggregator');
const { buildReport, buildTimeoutMessage } = require('../report/reportBuilder');
const config = require('../config/env');

class SessionManager {
  constructor(sendMessage, reportStore = null) {
    this.sessions = new Map();
    this.sendMessage = sendMessage;
    this.reportStore = reportStore;
  }

  startSession(senderId) {
    const existing = this.sessions.get(senderId);
    if (existing && !existing.closing) {
      return false;
    }

    const aggregator = new Aggregator();
    const startedAt = Date.now();

    const session = {
      senderId,
      aggregator,
      startedAt,
      timer: null,
      closing: false,
    };

    session.timer = setTimeout(() => {
      this.endSession(senderId);
    }, config.SESSION_TIMEOUT);

    this.sessions.set(senderId, session);

    return true;
  }

  hasActiveSession(senderId) {
    const session = this.sessions.get(senderId);
    return session && !session.closing;
  }

  processMessage(senderId, parsed) {
    const session = this.sessions.get(senderId);
    if (!session || session.closing) return false;

    return session.aggregator.addOperation(parsed);
  }

  async endSession(senderId) {
    const session = this.sessions.get(senderId);
    if (!session) return;

    if (session.closing) return;
    session.closing = true;

    clearTimeout(session.timer);

    const stats = session.aggregator.getStats();
    const endedAt = Date.now();

    if (stats.totalCount === 0) {
      await this.sendMessage(senderId, { text: buildTimeoutMessage() });
    } else {
      const report = buildReport(stats);
      if (report) {
        await this.sendMessage(senderId, { text: report });
      }

      if (this.reportStore) {
        await this.reportStore.saveReport({
          senderId,
          startedAt: session.startedAt,
          endedAt,
          stats,
        });
      }
    }

    if (this.sessions.get(senderId) === session) {
      this.sessions.delete(senderId);
    }
  }

  getActiveSenders() {
    const active = [];
    for (const [senderId, session] of this.sessions) {
      if (!session.closing) {
        active.push(senderId);
      }
    }
    return active;
  }

  getSessionsSnapshot() {
    const snapshot = [];
    const now = Date.now();

    for (const [senderId, session] of this.sessions) {
      if (session.closing) continue;

      const stats = session.aggregator.getStats();
      const elapsedMs = now - session.startedAt;
      const remainingMs = Math.max(0, config.SESSION_TIMEOUT - elapsedMs);

      snapshot.push({
        senderId,
        startedAt: session.startedAt,
        remainingMs,
        totalCount: stats.totalCount,
        totalAmount: stats.totalAmount,
        accounts: stats.accounts,
      });
    }

    return snapshot;
  }
}

module.exports = SessionManager;
