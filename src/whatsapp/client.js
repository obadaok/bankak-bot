const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const QRCode = require('qrcode');

const AUTH_DIR = '/tmp/bankak-auth';
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

let latestQR = null;
let qrResolvers = [];
let reconnectAttempt = 0;
let reconnectTimer = null;

function ensureAuthDir() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }
}

async function restoreAuthFromMongo(mongoCollection) {
  try {
    const saved = await mongoCollection.findOne({ _id: 'baileys-auth' });
    if (saved?.files) {
      ensureAuthDir();
      for (const [file, data] of Object.entries(saved.files)) {
        fs.writeFileSync(path.join(AUTH_DIR, file), Buffer.from(data, 'base64'));
      }
      logger.info('Auth state restored from MongoDB');
      return true;
    }
  } catch (e) {
    logger.error({ err: e.message }, 'Failed to restore auth from MongoDB');
  }
  return false;
}

async function saveAuthToMongo(mongoCollection) {
  try {
    ensureAuthDir();
    const files = {};
    for (const file of fs.readdirSync(AUTH_DIR)) {
      files[file] = fs.readFileSync(path.join(AUTH_DIR, file)).toString('base64');
    }
    await mongoCollection.updateOne(
      { _id: 'baileys-auth' },
      { $set: { files, updatedAt: new Date() } },
      { upsert: true }
    );
    logger.info('Auth state saved to MongoDB');
  } catch (e) {
    logger.error({ err: e.message }, 'Failed to save auth to MongoDB');
  }
}

let mongoSavePending = false;
let mongoSaveTimer = null;

function debouncedSaveAuth(mongoCollection) {
  if (mongoSaveTimer) clearTimeout(mongoSaveTimer);
  if (mongoSavePending) return;
  mongoSavePending = true;
  mongoSaveTimer = setTimeout(async () => {
    mongoSavePending = false;
    await saveAuthToMongo(mongoCollection);
  }, 3000);
}

function onQR(qr) {
  latestQR = qr;
  reconnectAttempt = 0;
  QRCode.toString(qr, { type: 'terminal', small: true }, (err, str) => {
    if (!err) {
      console.log('\n=== QR CODE - Scan with Admin WhatsApp ===\n');
      console.log(str);
      console.log('\n==========================================\n');
    }
  });
  qrResolvers.forEach((resolve) => resolve(qr));
  qrResolvers = [];
}

function getLatestQR() {
  return latestQR;
}

function getReconnectDelay() {
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt),
    RECONNECT_MAX_MS
  );
  reconnectAttempt++;
  return delay + Math.random() * 1000;
}

async function createWhatsAppClient(mongoCollection, onMessage, onSocketUpdate) {
  const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
  } = await import('@whiskeysockets/baileys');

  await restoreAuthFromMongo(mongoCollection);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info({ version, isLatest }, 'Using Baileys version');

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    logger: logger.child({ module: 'baileys' }),
    maxMsgRetryCount: 3,
  });

  if (onSocketUpdate) onSocketUpdate(sock);

  let lastCredsSave = 0;

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    const now = Date.now();
    if (now - lastCredsSave > 5000) {
      lastCredsSave = now;
      debouncedSaveAuth(mongoCollection);
    }
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      onQR(qr);
    }

    if (connection === 'open') {
      logger.info('WhatsApp connected successfully');
      reconnectAttempt = 0;
      await saveCreds();
      await saveAuthToMongo(mongoCollection);
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      logger.info(
        { willReconnect: shouldReconnect, attempt: reconnectAttempt },
        'Connection closed'
      );

      if (shouldReconnect) {
        sock.ev.removeAllListeners('creds.update');
        sock.ev.removeAllListeners('connection.update');
        sock.ev.removeAllListeners('messages.upsert');

        const delay = getReconnectDelay();
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          createWhatsAppClient(mongoCollection, onMessage, onSocketUpdate).catch((e) =>
            logger.error({ err: e.message }, 'Reconnect failed')
          );
        }, delay);
      } else {
        logger.warn('Logged out, deleting stored auth');
        reconnectAttempt = 0;
        if (mongoCollection) {
          await mongoCollection.deleteOne({ _id: 'baileys-auth' });
        }
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        if (!msg.key || !msg.key.remoteJid) continue;
        if (msg.key.remoteJid.endsWith('@g.us')) continue;
        if (msg.key.fromMe) continue;

        let processedMsg = msg;

        if (msg.key.remoteJid.endsWith('@lid')) {
          const senderPn = msg.key.senderPn;
          if (senderPn) {
            processedMsg = {
              ...msg,
              key: { ...msg.key, remoteJid: senderPn },
            };
          }
        }

        onMessage(sock, processedMsg);
      } catch (e) {
        logger.error({ err: e.message }, 'Error processing message');
      }
    }
  });

  return sock;
}

module.exports = { createWhatsAppClient, getLatestQR };
