const fs = require('fs');
const path = require('path');
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const logger = require('../utils/logger');
const QRCode = require('qrcode');

const AUTH_DIR = '/tmp/bankak-auth';

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

let latestQR = null;
let qrResolvers = [];

function onQR(qr) {
  latestQR = qr;
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

function waitForQR(timeoutMs = 60000) {
  if (latestQR) return Promise.resolve(latestQR);
  return new Promise((resolve, reject) => {
    qrResolvers.push(resolve);
    setTimeout(() => {
      const idx = qrResolvers.indexOf(resolve);
      if (idx !== -1) qrResolvers.splice(idx, 1);
      reject(new Error('QR timeout'));
    }, timeoutMs);
  });
}

async function createWhatsAppClient(mongoCollection, onMessage, onSocketUpdate) {
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
  });

  if (onSocketUpdate) onSocketUpdate(sock);

  const mongoSave = async () => {
    await saveCreds();
    await saveAuthToMongo(mongoCollection);
  };

  sock.ev.on('creds.update', mongoSave);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      onQR(qr);
    }

    if (connection === 'open') {
      logger.info('WhatsApp connected successfully');
      await mongoSave();
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      logger.info({ willReconnect: shouldReconnect }, 'Connection closed');

      if (shouldReconnect) {
        setTimeout(() => {
          createWhatsAppClient(mongoCollection, onMessage, onSocketUpdate).catch((e) =>
            logger.error({ err: e.message }, 'Reconnect failed')
          );
        }, 3000);
      } else {
        logger.warn('Logged out, deleting stored auth');
        if (mongoCollection) {
          await mongoCollection.deleteOne({ _id: 'baileys-auth' });
        }
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
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

module.exports = { createWhatsAppClient, getLatestQR, waitForQR };
