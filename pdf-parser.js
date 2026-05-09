const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const sharp = require('sharp');

const OUTPUT_JSON = 'output.json';
const IMAGE_DIR = 'question_images';

async function getPdfText(filePath) {
  console.log("📖 Extracting text with pdfjs-dist...");

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));

  const loadingTask = pdfjsLib.getDocument({
    data,
    disableWorker: true
  });

  const pdf = await loadingTask.promise;

  let fullText = '';

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .map(item => item.str)
      .join('\n');

    fullText += `\n${pageText}\n-- ${pageNumber} of ${pdf.numPages} --\n`;
  }

  return fullText;
}

async function renderPdfPages(filePath) {
  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR);
  }

  console.log("🖼️ Rendering PDF pages to images with Poppler...");

  const { Poppler } = await import('node-poppler');
  const poppler = new Poppler();

  const outputPrefix = path.join(IMAGE_DIR, 'page');

  await poppler.pdfToCairo(filePath, outputPrefix, {
    pngFile: true,
    resolutionXYAxis: 200
  });

  const files = fs
    .readdirSync(IMAGE_DIR)
    .filter(file => /^page-\d+\.png$/.test(file))
    .sort((a, b) => {
      const aNum = Number(a.match(/page-(\d+)\.png/)[1]);
      const bNum = Number(b.match(/page-(\d+)\.png/)[1]);
      return aNum - bNum;
    });

  const renderedPages = files.map((file, index) => ({
    pageNumber: index + 1,
    path: path.join(IMAGE_DIR, file)
  }));

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

function extractMetadata(block) {
  const cleanBlock = cleanText(block);

  const metadataMatch = cleanBlock.match(
    /Assessment\s+Test\s+Domain\s+Skill\s+Difficulty\s+(SAT.*?)\s+Question/
  );

  if (!metadataMatch) {
    return {
      test: null,
      domain: null,
      skill: null,
      difficulty: null
    };
  }

  const metadataText = metadataMatch[1];

  const difficultyMatch = metadataText.match(/\b(Easy|Medium|Hard)\b$/);

  return {
    test: "SAT",
    domain: metadataText.includes("Reading and Writing")
      ? "Reading and Writing"
      : null,
    skill: metadataText.includes("Information and Ideas")
      ? "Information and Ideas"
      : null,
    difficulty: difficultyMatch ? difficultyMatch[1] : null
  };
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

async function cropPageImageForQuestion(questionId, pageNumber, renderedPages) {
  if (!questionId || !pageNumber) return null;

  const page = renderedPages.find(p => p.pageNumber === pageNumber);

  if (!page || !page.path) {
    console.log(`⚠️ Could not find rendered image for page ${pageNumber}`);
    return null;
  }

  const targetPath = path.join(IMAGE_DIR, `${questionId}.png`);

  const metadata = await sharp(page.path).metadata();

  const left = 80;
  const top = 80;
  const width = metadata.width - 160;
  const height = metadata.height - 180;

  await sharp(page.path)
    .extract({
      left,
      top,
      width,
      height
    })
    .png()
    .toFile(targetPath);

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

      const metadata = extractMetadata(block);

      const questionTextMatch = block.match(/Question\s*([\s\S]*?)\s*Answer/);
      const questionText = questionTextMatch
        ? cleanText(questionTextMatch[1])
        : null;

      const questionImage = await cropPageImageForQuestion(
        id,
        pageNumber,
        renderedPages
      );

      results.push({
        id,
        metadata,
        pageNumber,
        questionText,
        questionImage,
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