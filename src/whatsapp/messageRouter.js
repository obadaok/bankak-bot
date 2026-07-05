const { parseNotification } = require('../parser/bankakParser');
const { extractTextFromImage } = require('../utils/ocr');
const logger = require('../utils/logger');

const COMMAND = '/mbok';

function extractMessageText(msg) {
  const m = msg.message;
  if (!m) return '';

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.ephemeralMessage?.message?.conversation ||
    m.ephemeralMessage?.message?.extendedTextMessage?.text ||
    m.ephemeralMessage?.message?.imageMessage?.caption ||
    ''
  );
}

function isImageMessage(msg) {
  const m = msg.message;
  if (!m) return false;
  return !!(
    m.imageMessage ||
    m.ephemeralMessage?.message?.imageMessage
  );
}

function createMessageRouter(sessionManager) {
  async function handleTextMessage(sock, senderId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;

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
      return true;
    }

    if (!sessionManager.hasActiveSession(senderId)) return false;

    const parsed = parseNotification(trimmed);
    if (!parsed) {
      logger.info({ senderId, text: trimmed.slice(0, 100) }, 'Text not recognized as bankak notification');
      return false;
    }

    const added = sessionManager.processMessage(senderId, parsed);
    if (added) {
      const displayId = parsed.operationDisplay || parsed.operationId?.slice(-4) || '';
      await sock.sendMessage(senderId, {
        text: `✅ تم استلام العملية (${displayId}) بمبلغ ${parsed.amount.toLocaleString('en-US')} جنيه سوداني`,
      });
      logger.info({ senderId, operationId: parsed.operationId, amount: parsed.amount }, 'Operation recorded');
    } else {
      await sock.sendMessage(senderId, {
        text: `⚠️ العملية مكررة وتم تجاهلها`,
      });
      logger.info({ senderId, operationId: parsed.operationId }, 'Duplicate operation ignored');
    }
    return true;
  }

  async function handleImageMessage(sock, senderId, msg) {
    if (!sessionManager.hasActiveSession(senderId)) return;

    try {
      await sock.sendMessage(senderId, { text: '🔍 جاري تحليل الصورة...' });

      const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
      const buffer = await downloadMediaMessage(msg, 'buffer', {}, logger);
      if (!buffer) {
        await sock.sendMessage(senderId, { text: '❌ تعذر تحميل الصورة' });
        return;
      }

      const text = await extractTextFromImage(buffer);
      if (!text) {
        await sock.sendMessage(senderId, { text: '❌ لم يتم التعرف على نص في الصورة' });
        return;
      }

      const parsed = parseNotification(text);
      if (!parsed) {
        await sock.sendMessage(senderId, { text: '❌ الصورة لا تحتوي إشعار بنكك صالح' });
        return;
      }

      const added = sessionManager.processMessage(senderId, parsed);
      if (added) {
        const displayId = parsed.operationDisplay || parsed.operationId?.slice(-4) || '';
        await sock.sendMessage(senderId, {
          text: `✅ تم استلام العملية (${displayId}) بمبلغ ${parsed.amount.toLocaleString('en-US')} جنيه سوداني`,
        });
        logger.info({ senderId, operationId: parsed.operationId, amount: parsed.amount }, 'Operation recorded from image');
      } else {
        await sock.sendMessage(senderId, {
          text: `⚠️ العملية مكررة وتم تجاهلها`,
        });
      }
    } catch (e) {
      logger.error({ err: e.message, stack: e.stack }, 'Error processing image');
      try {
        await sock.sendMessage(senderId, { text: '❌ حدث خطأ أثناء معالجة الصورة' });
      } catch (_) {}
    }
  }

  return async function handleMessage(sock, msg) {
    try {
      const senderId = msg.key.remoteJid;
      const pushName = msg.pushName || 'unknown';

      const messageText = extractMessageText(msg);

      logger.info({ senderId, pushName, text: messageText.slice(0, 50), hasImage: isImageMessage(msg) }, 'Message received');

      if (isImageMessage(msg)) {
        await handleImageMessage(sock, senderId, msg);
        return;
      }

      if (messageText.trim()) {
        await handleTextMessage(sock, senderId, messageText);
      }
    } catch (e) {
      logger.error({ err: e.message, stack: e.stack }, 'Error in message handler');
    }
  };
}

module.exports = { createMessageRouter };
