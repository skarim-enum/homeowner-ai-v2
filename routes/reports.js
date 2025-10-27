const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { extractTextFromFile } = require('../utils/fileExtractor');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Helper to read documents
function readDocuments() {
  const dataPath = path.join(__dirname, '../data/documents.json');
  if (!fs.existsSync(dataPath)) {
    return [];
  }
  const data = fs.readFileSync(dataPath, 'utf8');
  return JSON.parse(data);
}

// Generate Late Fee Summary Report
router.post('/late-fee-summary', async (req, res) => {
  try {
    console.log('📊 Generating Late Fee Summary report...');
    
    const documents = readDocuments();
    
    if (documents.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No documents found to analyze'
      });
    }

    const reportData = [];

    // Process each document
    for (const doc of documents) {
      try {
        console.log(`📄 Processing: ${doc.original_name}`);
        
        // Extract text from document
        const text = await extractTextFromFile(doc.file_path, doc.file_type);
        
        if (!text || text.trim().length === 0) {
          console.log(`⚠️  No text extracted from ${doc.original_name}`);
          reportData.push({
            filename: doc.original_name,
            community_name: doc.community_name || 'N/A',
            hoa_fee: 'N/A',
            hoa_due_date: 'N/A',
            late_fee: 'N/A',
            late_fee_due_date: 'N/A',
            error: 'Could not extract text from document'
          });
          continue;
        }

        // Use OpenAI to extract structured data
        const prompt = `Analyze the following HOA document text and extract these specific fields:
1. HOA payment amount (the regular monthly/quarterly/annual HOA fee)
2. HOA payment due date
3. Late fee amount (the fee charged for late payment)
4. Late fee due date (when the late fee is applied or due)

Return the data in JSON format with these exact keys:
{
  "hoa_fee": "amount as string with currency symbol",
  "hoa_due_date": "date in readable format",
  "late_fee": "amount as string with currency symbol",
  "late_fee_due_date": "date in readable format"
}

If any field is not found in the document, use "Not found" as the value.

Document text:
${text.substring(0, 4000)}`;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are an expert at analyzing HOA documents and extracting financial information. Always return valid JSON with the requested fields."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        });

        const extractedData = JSON.parse(completion.choices[0].message.content);
        
        console.log(`✅ Extracted data for ${doc.original_name}:`, extractedData);

        reportData.push({
          filename: doc.original_name,
          community_name: doc.community_name || 'N/A',
          hoa_fee: extractedData.hoa_fee || 'Not found',
          hoa_due_date: extractedData.hoa_due_date || 'Not found',
          late_fee: extractedData.late_fee || 'Not found',
          late_fee_due_date: extractedData.late_fee_due_date || 'Not found'
        });

      } catch (docError) {
        console.error(`❌ Error processing ${doc.original_name}:`, docError);
        reportData.push({
          filename: doc.original_name,
          community_name: doc.community_name || 'N/A',
          hoa_fee: 'Error',
          hoa_due_date: 'Error',
          late_fee: 'Error',
          late_fee_due_date: 'Error',
          error: docError.message
        });
      }
    }

    console.log('✅ Late Fee Summary report generated successfully');
    
    res.json({
      success: true,
      data: reportData,
      totalDocuments: documents.length,
      processedDocuments: reportData.length
    });

  } catch (error) {
    console.error('❌ Error generating Late Fee Summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;