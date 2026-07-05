require('./config/env');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const { createWhatsAppClient, getLatestQR } = require('./whatsapp/client');
const { createMessageRouter } = require('./whatsapp/messageRouter');
const SessionManager = require('./session/sessionManager');
const ReportStore = require('./report/reportStore');
const { parseNotification } = require('./parser/bankakParser');
const { extractTextFromImage } = require('./utils/ocr');
const { buildReport, buildTimeoutMessage } = require('./report/reportBuilder');
const logger = require('./utils/logger');
const config = require('./config/env');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

let sock = null;

function maskSenderId(senderId) {
  if (!senderId) return 'غير معروف';
  const number = senderId.split('@')[0];
  if (number.length <= 6) return number;
  return `${number.slice(0, 4)}****${number.slice(-4)}`;
}

function serializeSession(session) {
  return {
    senderId: maskSenderId(session.senderId),
    startedAt: session.startedAt,
    remainingMs: session.remainingMs,
    totalCount: session.totalCount,
    totalAmount: session.totalAmount,
    accounts: session.accounts,
  };
}

function serializeReport(report) {
  return {
    id: report._id,
    senderId: maskSenderId(report.senderId),
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    totalCount: report.totalCount,
    totalAmount: report.totalAmount,
    accounts: report.accounts,
  };
}

process.on('unhandledRejection', (err) => {
  logger.error({ err: err?.message, stack: err?.stack }, 'Unhandled rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err: err?.message, stack: err?.stack }, 'Uncaught exception');
});

async function main() {
  logger.info('Starting Bankak Bot...');

  const mongoClient = new MongoClient(config.MONGODB_URI);
  await mongoClient.connect();
  const db = mongoClient.db();
  const sessionsCollection = db.collection('sessions');
  const reportsCollection = db.collection('reports');

  logger.info('Connected to MongoDB');

  const reportStore = new ReportStore(reportsCollection);

  const sessionManager = new SessionManager(async (senderId, content) => {
    if (sock) {
      try {
        await sock.sendMessage(senderId, content);
      } catch (e) {
        logger.error({ err: e.message, senderId }, 'Failed to send message');
      }
    }
  }, reportStore);

  const messageRouter = createMessageRouter(sessionManager);

  sock = await createWhatsAppClient(
    sessionsCollection,
    messageRouter,
    (newSock) => { sock = newSock; }
  );

  const app = express();
  app.use(express.json());

  app.use('/', express.static(path.join(__dirname, '..', 'public')));

  app.get('/qr', async (_req, res) => {
    const qr = getLatestQR();
    if (qr) {
      const QRCode = require('qrcode');
      const dataUrl = await QRCode.toDataURL(qr);
      res.send(`<html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h1>🤖 Bankak Bot</h1>
        <p>امسح رمز QR أدناه من واتساب المدير</p>
        <img src="${dataUrl}" alt="QR Code" style="max-width:300px"/>
        <p><small>الرقم: ${config.ADMIN_NUMBER}</small></p>
        <p><a href="/">⬅️ الرجوع للتطبيق</a></p>
      </body></html>`);
    } else {
      res.send(`<html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h1>🤖 Bankak Bot</h1>
        <p>✅ البوت متصل وجاهز للعمل</p>
        <p>الرقم: ${config.ADMIN_NUMBER}</p>
        <p><a href="/">⬅️ الرجوع للتطبيق</a></p>
      </body></html>`);
    }
  });

  app.get('/qr.png', async (_req, res) => {
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

  app.get('/api/sessions', (_req, res) => {
    const snapshot = sessionManager.getSessionsSnapshot().map(serializeSession);
    res.json({ sessions: snapshot });
  });

  app.get('/api/reports', async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = parseInt(req.query.skip, 10) || 0;
    const { reports, total } = await reportStore.listReports({ limit, skip });
    res.json({ reports: reports.map(serializeReport), total });
  });

  app.get('/api/reports/:id', async (req, res) => {
    const report = await reportStore.getReportById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(serializeReport(report));
  });

  app.get('/api/summary', async (_req, res) => {
    const allTime = await reportStore.getAllTimeSummary();
    res.json({
      activeSessions: sessionManager.getActiveSenders().length,
      sessionTimeoutMs: config.SESSION_TIMEOUT,
      ...allTime,
    });
  });

  app.post('/api/parse', (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ error: 'text is required' });
      const parsed = parseNotification(text);
      if (!parsed) return res.json({ error: 'لم يتم التعرف على إشعار صالح' });
      res.json(parsed);
    } catch (e) {
      logger.error({ err: e.message }, 'Parse API error');
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/parse-image', upload.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'image is required' });
      const text = await extractTextFromImage(req.file.buffer);
      if (!text) return res.json({ error: 'لم يتم التعرف على نص في الصورة' });
      const parsed = parseNotification(text);
      res.json({ parsed, ocrText: text.slice(0, 500) });
    } catch (e) {
      logger.error({ err: e.message }, 'Parse-image API error');
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/report', (req, res) => {
    try {
      const { operations } = req.body;
      if (!operations || !operations.length) return res.status(400).json({ error: 'operations required' });

      const Aggregator = require('./aggregator/aggregator');
      const agg = new Aggregator();
      operations.forEach(op => agg.addOperation(op));
      const stats = agg.getStats();
      const report = buildReport(stats);
      res.json({ report, stats });
    } catch (e) {
      logger.error({ err: e.message }, 'Report API error');
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/reset-auth', async (_req, res) => {
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
