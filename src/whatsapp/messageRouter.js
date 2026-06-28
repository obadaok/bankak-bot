const { parseNotification } = require('../parser/bankakParser');
const logger = require('../utils/logger');

const COMMAND = '/mbok';

function createMessageRouter(sessionManager) {
  return async function handleMessage(sock, msg) {
    const senderId = msg.key.remoteJid;
    const messageText =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      '';

    if (!messageText.trim()) return;

    const trimmed = messageText.trim();

    if (trimmed === COMMAND) {
      const started = sessionManager.startSession(senderId);
      if (started) {
        await sock.sendMessage(senderId, {
          text: '✅ تم تفعيل المحلل لمدة دقيقة. أرسل إشعارات بنكك الآن.',
        });
        logger.info({ senderId }, 'Session started');
      } else {
        await sock.sendMessage(senderId, {
          text: '⚠️ لديك جلسة نشطة حالياً، انتظر حتى انتهائها.',
        });
      }
      return;
    }

    if (!sessionManager.hasActiveSession(senderId)) return;

    const parsed = parseNotification(trimmed);
    if (!parsed) return;

    const added = sessionManager.processMessage(senderId, parsed);
    if (added) {
      logger.info(
        {
          senderId,
          operationId: parsed.operationId,
          amount: parsed.amount,
        },
        'Operation recorded'
      );
    } else {
      logger.info(
        {
          senderId,
          operationId: parsed.operationId,
        },
        'Duplicate operation ignored'
      );
    }
  };
}

module.exports = { createMessageRouter };
