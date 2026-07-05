const { parseNotification } = require('../parser/bankakParser');
const logger = require('../utils/logger');

const COMMAND = '/mbok';

function extractMessageText(msg) {
  const m = msg.message;
  if (!m) return '';

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.ephemeralMessage?.message?.conversation ||
    m.ephemeralMessage?.message?.extendedTextMessage?.text ||
    ''
  );
}

function createMessageRouter(sessionManager) {
  return async function handleMessage(sock, msg) {
    try {
      const senderId = msg.key.remoteJid;
      const pushName = msg.pushName || 'unknown';

      const messageText = extractMessageText(msg);

      logger.info({ senderId, pushName, text: messageText.slice(0, 50) }, 'Message received');

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
          { senderId, operationId: parsed.operationId, amount: parsed.amount },
          'Operation recorded'
        );
      } else {
        logger.info(
          { senderId, operationId: parsed.operationId },
          'Duplicate operation ignored'
        );
      }
    } catch (e) {
      logger.error({ err: e.message, stack: e.stack }, 'Error in message handler');
    }
  };
}

module.exports = { createMessageRouter };
