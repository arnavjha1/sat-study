const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const { PDFParse } = require('pdf-parse');

const OUTPUT_JSON = 'output.json';
const IMAGE_DIR = 'question_images';

async function getPdfText(filePath) {
  const dataBuffer = fs.readFileSync(filePath);

  const parser = new PDFParse({ data: dataBuffer });
  const result = await parser.getText();

  await parser.destroy();

  return result.text;
}

async function renderPdfPages(filePath) {
  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR);
  }

  console.log("🖼️ Rendering PDF pages to images...");

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(fs.readFileSync(filePath));

  const loadingTask = pdfjsLib.getDocument({
    data,
    disableWorker: true
  });

  const pdf = await loadingTask.promise;
  const renderedPages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.0 });

    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    const imagePath = path.join(IMAGE_DIR, `page-${pageNumber}.png`);
    fs.writeFileSync(imagePath, canvas.toBuffer('image/png'));

    renderedPages.push({
      pageNumber,
      path: imagePath
    });
  }

  console.log(`✅ Rendered ${renderedPages.length} PDF pages`);
  return renderedPages;
}

function cleanText(text) {
  return text
    .replace(/--- PAGE \d+ ---/g, '')
    .replace(/-- \d+ of \d+ --/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function extractAnswerChoices(answerBlock) {
  const choices = [];

  const choiceRegex =
    /(?:^|\n)\s*([A-D])\s*\n([\s\S]*?)(?=\n\s*[A-D]\s*\n|\n\s*Correct Answer:|$)/g;

  let match;
  while ((match = choiceRegex.exec(answerBlock)) !== null) {
    choices.push({
      choice: match[1],
      text: cleanText(match[2])
    });
  }

  return choices;
}

function getPageNumberFromBlock(block) {
  const pageMatch = block.match(/--\s*(\d+)\s*of\s*\d+\s*--/);
  return pageMatch ? Number(pageMatch[1]) : null;
}

function copyPageImageForQuestion(questionId, pageNumber, renderedPages) {
  if (!questionId || !pageNumber) return null;

  const page = renderedPages.find(p => p.pageNumber === pageNumber);

  if (!page || !page.path) {
    console.log(`⚠️ Could not find rendered image for page ${pageNumber}`);
    return null;
  }

  const targetPath = path.join(IMAGE_DIR, `${questionId}.png`);

  fs.copyFileSync(page.path, targetPath);

  return targetPath.replace(/\\/g, '/');
}

async function processQuestionBank(filePath) {
  try {
    console.log("🚀 Starting PDF processing...");

    const renderedPages = await renderPdfPages(filePath);
    const text = await getPdfText(filePath);

    console.log(`📝 Extracted text length: ${text.length}`);

    const questionBlocks = text
      .split(/Question ID:\s+/)
      .filter(q => q.trim());

    console.log(`🔍 Found ${questionBlocks.length} question blocks`);

    const results = [];

    for (const block of questionBlocks) {
      const idMatch = block.match(/^([a-z0-9]+)/i);
      const answerBlockMatch = block.match(/Answer\s*([\s\S]*?)\s*Rationale/);
      const correctAnswerMatch = block.match(/Correct Answer:\s*([A-D])/);
      const rationaleMatch = block.match(/Rationale\s*([\s\S]*)$/);

      const id = idMatch ? idMatch[1] : null;
      const pageNumber = getPageNumberFromBlock(block);
      const answerBlock = answerBlockMatch ? answerBlockMatch[1] : '';
      const answerChoices = extractAnswerChoices(answerBlock);

      const questionImage = copyPageImageForQuestion(
        id,
        pageNumber,
        renderedPages
      );

      results.push({
        id,
        questionImage,
        pageNumber,
        answerChoices,
        correctAnswer: correctAnswerMatch ? correctAnswerMatch[1] : null,
        rationale: rationaleMatch ? cleanText(rationaleMatch[1]) : null
      });
    }

    return results;

  } catch (error) {
    console.error("❌ Error processing file:", error);
  }
}

processQuestionBank('./college_board_pdfs/sat-information-ideas.pdf')
  .then(results => {
    if (!results) {
      console.log("⚠️ No results returned");
      return;
    }

    fs.writeFileSync(
      OUTPUT_JSON,
      JSON.stringify(results, null, 2),
      'utf8'
    );

    console.log(`🎯 Extracted ${results.length} questions`);
    console.log(`✅ Saved JSON to ${OUTPUT_JSON}`);
    console.log(`✅ Saved full-page question images to ./${IMAGE_DIR}`);
  });