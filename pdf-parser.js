const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function getPdfText(filePath) {
  const dataBuffer = fs.readFileSync(filePath);

  const parser = new PDFParse({ data: dataBuffer });
  const result = await parser.getText();

  await parser.destroy();

  return result.text;
}

async function processQuestionBank(filePath) {
  try {
    console.log("🚀 Starting PDF processing...");

    const text = await getPdfText(filePath);

    console.log(`📝 Extracted text length: ${text.length}`);

    const cleanedText = text
      .replace(/--- PAGE \d+ ---/g, '')
      .replace(/-- \d+ of \d+ --/g, '');

    const questionBlocks = cleanedText
      .split(/Question ID:\s+/)
      .filter(q => q.trim());

    console.log(`🔍 Found ${questionBlocks.length} question blocks`);

    const results = questionBlocks.map(block => {
      const idMatch = block.match(/^([a-z0-9]+)/i);
      const questionMatch = block.match(/Question\s*([\s\S]*?)\s*Answer/);
      const answerMatch = block.match(/Correct Answer:\s*([A-D])/);
      const rationaleMatch = block.match(/Rationale\s*([\s\S]*)$/);

      return {
        id: idMatch ? idMatch[1] : null,
        question: questionMatch ? questionMatch[1].trim() : null,
        correctAnswer: answerMatch ? answerMatch[1] : null,
        rationale: rationaleMatch ? rationaleMatch[1].trim() : null
      };
    });

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
      'output.json',
      JSON.stringify(results, null, 2),
      'utf8'
    );

    console.log(`🎯 Extracted ${results.length} questions`);
    console.log("✅ Saved pretty JSON to output.json");
  });