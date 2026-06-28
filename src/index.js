require('./config/env');
const express = require('express');
const { MongoClient } = require('mongodb');
const { createWhatsAppClient, getLatestQR } = require('./whatsapp/client');
const { createMessageRouter } = require('./whatsapp/messageRouter');
const SessionManager = require('./session/sessionManager');
const logger = require('./utils/logger');
const config = require('./config/env');

let sock = null;

async function main() {
  logger.info('Starting Bankak Bot...');

  const mongoClient = new MongoClient(config.MONGODB_URI);
  await mongoClient.connect();
  const db = mongoClient.db();
  const sessionsCollection = db.collection('sessions');

  logger.info('Connected to MongoDB');

  const sessionManager = new SessionManager(async (senderId, content) => {
    if (sock) {
      try {
        await sock.sendMessage(senderId, content);
      } catch (e) {
        logger.error({ err: e.message, senderId }, 'Failed to send message');
      }
    }
  });

  const messageRouter = createMessageRouter(sessionManager);

  sock = await createWhatsAppClient(sessionsCollection, messageRouter);

  const app = express();

  app.get('/', (_req, res) => {
    const qr = getLatestQR();
    if (qr) {
      res.send(`<html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h1>🤖 Bankak Bot</h1>
        <p>امسح رمز QR أدناه من واتساب المدير</p>
        <img src="/qr" alt="QR Code" style="max-width:300px"/>
      </body></html>`);
    } else {
      res.send(`<html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h1>🤖 Bankak Bot</h1>
        <p>✅ البوت متصل وجاهز للعمل</p>
        <p>الرقم: ${config.ADMIN_NUMBER}</p>
      </body></html>`);
    }
  });

  app.get('/qr', async (_req, res) => {
    const qr = getLatestQR();
    if (!qr) {
      return res.status(404).send('QR not available - bot may already be connected');
    }
    const QRCode = require('qrcode');
    const dataUrl = await QRCode.toDataURL(qr);
    res.send(`<html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h1>🤖 Bankak Bot</h1>
      <p>امسح رمز QR أدناه من واتساب المدير</p>
      <img src="${dataUrl}" alt="QR Code" style="max-width:300px"/>
      <p><small>الرقم: ${config.ADMIN_NUMBER}</small></p>
    </body></html>`);
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      connected: sock?.user ? true : false,
      activeSessions: sessionManager.getActiveSenders().length,
    });
  });

  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'Health server started');
  });

  const shutdown = async () => {
    logger.info('Shutting down...');
    if (sock) {
      sock.end(undefined);
    }
    await mongoClient.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, 'Fatal error');
  process.exit(1);
});
