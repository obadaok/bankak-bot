const Tesseract = require('tesseract.js');
const sharp = require('sharp');
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
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      tessedit_ocr_engine_mode: '3',
    });
  }
  return worker;
}

async function preprocessImage(buffer) {
  try {
    const processed = await sharp(buffer)
      .grayscale()
      .normalise()
      .linear(1.5, -0.3)
      .sharpen()
      .png()
      .toBuffer();
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
  try {
    const processed = await preprocessImage(imageBuffer);
    const w = await getWorker();
    const { data } = await w.recognize(processed);
    const cleaned = cleanOcrText(data.text);
    logger.info({ textLength: cleaned.length, preview: cleaned.slice(0, 150) }, 'OCR result');
    return cleaned;
  } catch (e) {
    logger.error({ err: e.message }, 'OCR failed');
    return '';
  }
}

module.exports = { extractTextFromImage };
