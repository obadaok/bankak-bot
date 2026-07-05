const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const logger = require('./logger');

let worker = null;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const OCR_TIMEOUT_MS = 20000;

async function getWorker() {
  if (!worker) {
    worker = await Tesseract.createWorker('ara+eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') return;
        logger.debug({ ...m }, 'OCR progress');
      },
    });
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      tessedit_ocr_engine_mode: '3',
    });
  }
  return worker;
}

async function terminateWorker() {
  if (worker) {
    try {
      await worker.terminate();
    } catch (_) {}
    worker = null;
  }
}

async function preprocessImage(buffer) {
  try {
    const metadata = await sharp(buffer).metadata();
    let img = sharp(buffer).grayscale().normalise().sharpen();

    if (metadata.width && metadata.width < 1000) {
      img = img.resize(Math.round(metadata.width * 1.5), null, { fit: 'inside' });
    }

    const processed = await img.png().toBuffer();
    return processed;
  } catch (e) {
    logger.error({ err: e.message }, 'Image preprocessing failed, using original');
    return buffer;
  }
}

function cleanOcrText(raw) {
  return raw
    .replace(/[\u200e\u200f\u202a-\u202e]+/g, '')
    .replace(/[|©®™]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractTextFromImage(imageBuffer) {
  if (imageBuffer.length > MAX_IMAGE_BYTES) {
    logger.warn({ size: imageBuffer.length }, 'Image too large for OCR');
    return '';
  }

  try {
    const processed = await preprocessImage(imageBuffer);

    const w = await getWorker();

    const result = await Promise.race([
      w.recognize(processed),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('OCR timeout')), OCR_TIMEOUT_MS)
      ),
    ]);

    const cleaned = cleanOcrText(result.data.text);
    logger.info({ textLength: cleaned.length, preview: cleaned.slice(0, 150) }, 'OCR result');
    return cleaned;
  } catch (e) {
    logger.error({ err: e.message }, 'OCR failed');
    return '';
  }
}

module.exports = { extractTextFromImage, terminateWorker };
