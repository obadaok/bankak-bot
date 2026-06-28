const Aggregator = require('../aggregator/aggregator');
const { buildReport, buildTimeoutMessage } = require('../report/reportBuilder');
const config = require('../config/env');

class SessionManager {
  constructor(sendMessage) {
    this.sessions = new Map();
    this.sendMessage = sendMessage;
  }

  startSession(senderId) {
    const existing = this.sessions.get(senderId);
    if (existing && !existing.closing) {
      return false;
    }

    const aggregator = new Aggregator();
    const startedAt = Date.now();

    const timer = setTimeout(() => {
      this.endSession(senderId);
    }, config.SESSION_TIMEOUT);

    this.sessions.set(senderId, {
      senderId,
      aggregator,
      startedAt,
      timer,
      closing: false,
    });

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

    if (stats.totalCount === 0) {
      await this.sendMessage(senderId, { text: buildTimeoutMessage() });
    } else {
      const report = buildReport(stats);
      if (report) {
        await this.sendMessage(senderId, { text: report });
      }
    }

    this.sessions.delete(senderId);
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
}

module.exports = SessionManager;
