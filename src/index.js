require('./config/env');
const express = require('express');
const { MongoClient } = require('mongodb');
const { createWhatsAppClient, getLatestQR } = require('./whatsapp/client');
const { createMessageRouter } = require('./whatsapp/messageRouter');
const SessionManager = require('./session/sessionManager');
const logger = require('./utils/logger');
const config = require('./config/env');

let sock = null;

process.on('unhandledRejection', (err) => {
  logger.error({ err: err?.message, stack: err?.stack }, 'Unhandled rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err: err?.message, stack: err?.stack }, 'Uncaught exception');
});

function requireToken(req) {
  const token = req.query.token || req.headers['x-admin-token'];
  if (token !== config.ADMIN_TOKEN) {
    return false;
  }
  return true;
}

async function main() {
  logger.info('Starting Bankak Bot...');

  const mongoClient = new MongoClient(config.MONGODB_URI);
  await mongoClient.connect();
  const db = mongoClient.db();
  const sessionsCollection = db.collection('sessions');

  logger.info('Connected to MongoDB');

  mongoClient.on('error', (err) => {
    logger.error({ err: err.message }, 'MongoDB connection error');
  });

  mongoClient.on('close', () => {
    logger.warn('MongoDB connection closed');
  });

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

  sock = await createWhatsAppClient(
    sessionsCollection,
    messageRouter,
    (newSock) => { sock = newSock; }
  );

  const app = express();

  app.get('/', async (_req, res) => {
    const qr = getLatestQR();
    if (qr) {
      const QRCode = require('qrcode');
      const dataUrl = await QRCode.toDataURL(qr);
      res.send(`<html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h1>🤖 Bankak Bot</h1>
        <p>امسح رمز QR أدناه من واتساب المدير</p>
        <img src="${dataUrl}" alt="QR Code" style="max-width:300px"/>
        <p><small>الرقم: ${config.ADMIN_NUMBER}</small></p>
      </body></html>`);
    } else {
      res.send(`<html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h1>🤖 Bankak Bot</h1>
        <p>✅ البوت متصل وجاهز للعمل</p>
        <p>الرقم: ${config.ADMIN_NUMBER}</p>
      </body></html>`);
    }
  });

  app.get('/qr.png', async (req, res) => {
    if (!requireToken(req)) {
      return res.status(403).send('Unauthorized');
    }
    const qr = getLatestQR();
    if (!qr) {
      return res.status(404).send('QR not available');
    }
    const QRCode = require('qrcode');
    const png = await QRCode.toBuffer(qr, { type: 'png', width: 400 });
    res.type('image/png').send(png);
  });

  app.get('/health', async (_req, res) => {
    let mongoOk = false;
    try {
      await db.admin().ping();
      mongoOk = true;
    } catch (_) {}
    res.json({
      status: mongoOk && sock?.user ? 'ok' : 'degraded',
      connected: sock?.user ? true : false,
      mongo: mongoOk,
      activeSessions: sessionManager.getActiveSenders().length,
    });
  });

  app.get('/reset-auth', async (req, res) => {
    if (!requireToken(req)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
      await sessionsCollection.deleteOne({ _id: 'baileys-auth' });
      logger.info('Auth deleted, restarting...');
      res.json({ status: 'deleted' });
      setTimeout(() => process.exit(0), 1000);
    } catch (e) {
      logger.error({ err: e.message }, 'Failed to reset auth');
      res.status(500).json({ error: e.message });
    }
  });

  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'Health server started');
  });

  const shutdown = async () => {
    logger.info('Shutting down...');
    const { terminateWorker } = require('./utils/ocr');
    await terminateWorker();
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
