const fs = require('fs');
const pdf = require('pdf-parse');

/**
 * Extracts text from the PDF, removes page headers, 
 * and returns structured data.
 */
async function processQuestionBank(filePath) {
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);
        
        // 1. Clean the text by removing "--- PAGE X ---" headers
        // This regex matches the pattern found in your file
        const cleanedText = data.text.replace(/--- PAGE \d+ ---/g, '');

        // 2. Split the text into individual question blocks
        // The file uses "Question ID:" as the primary separator
        const questions = cleanedText.split(/Question ID:\s+/).filter(q => q.trim());

        return questions.map(block => parseBlock(block));
    } catch (error) {
        console.error("Error processing file:", error);
    }
}

/**
 * Helper to parse individual question components
 */
function parseBlock(block) {
    return {
        id: block.match(/^([a-z0-9]+)/i)?.[1],
        // Extracts the "Question" section text
        questionText: block.match(/Question\n([\s\S]*?)\nAnswer/)?.[1].trim(),
        // Extracts the "Correct Answer" letter
        correctAnswer: block.match(/Correct Answer:\s+([A-D])/)?.[1],
        // Extracts the Rationale
        rationale: block.match(/Rationale\n([\s\S]*)$/)?.[1].trim()
    };
}

// Example Usage:
processQuestionBank('./questionbank-export-2026-5-5.pdf').then(results => {
    console.log("Extracted Questions (Headers Removed):", results);
});