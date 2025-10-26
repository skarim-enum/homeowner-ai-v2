const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// Extract text from uploaded files
async function extractTextFromFile(filePath, fileType) {
  try {
    if (fileType === 'application/pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return data.text;
    } else if (fileType.includes('word') || fileType.includes('document')) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }
    return '';
  } catch (error) {
    console.error('Error extracting text:', error);
    return '';
  }
}

// Truncate text to fit within token limits
function truncateText(text, maxTokens = 8000) {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) {
    return text;
  }
  return text.substring(0, maxChars) + '\n... (document truncated due to length)';
}

module.exports = {
  extractTextFromFile,
  truncateText
};