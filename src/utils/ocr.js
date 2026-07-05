const Tesseract = require('tesseract.js');
const logger = require('./logger');

let worker = null;

async function getWorker() {
  if (!worker) {
    worker = await Tesseract.createWorker('ara+eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') return;
        logger.debug({ ...m }, 'OCR progress');
      },
    });
  }
  return worker;
}

async function extractTextFromImage(imageBuffer) {
  try {
    const w = await getWorker();
    const { data } = await w.recognize(imageBuffer);
    const text = data.text.trim();
    logger.info({ textLength: text.length, preview: text.slice(0, 100) }, 'OCR result');
    return text;
  } catch (e) {
    logger.error({ err: e.message }, 'OCR failed');
    return '';
  }
}

module.exports = { extractTextFromImage };
