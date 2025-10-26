const express = require('express');
const OpenAI = require('openai');
const { authenticateToken } = require('../middleware/auth');
const { readDocuments, readChatHistory, writeChatHistory } = require('../utils/storage');
const { truncateText } = require('../utils/fileExtractor');

const router = express.Router();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Chat endpoint
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Get all documents
    const documents = readDocuments();
    
    if (documents.length === 0) {
      return res.json({
        answer: 'No documents have been uploaded yet. Please ask your HOA manager to upload the relevant documents.',
        documentsReferenced: []
      });
    }

    // Prepare context from all documents
    let combinedContext = 'Based on the following HOA documents:\n\n';
    const docReferences = [];

    documents.forEach((doc, index) => {
      const truncated = truncateText(doc.extracted_text, 2000);
      combinedContext += `[Document ${index + 1}: ${doc.original_name}]\n${truncated}\n\n`;
      docReferences.push({
        id: doc.id,
        name: doc.original_name
      });
    });

    // Call OpenAI API
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful HOA (Homeowners Association) assistant. Answer questions based on the provided HOA documents. Be concise and friendly. If the answer is not in the documents, say so politely.'
          },
          {
            role: 'user',
            content: `${combinedContext}\n\nQuestion: ${question}`
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      });

      const answer = completion.choices[0].message.content;

      // Store chat history
      const chatHistory = readChatHistory();
      chatHistory.push({
        user_id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        question,
        answer,
        documents_referenced: docReferences,
        created_at: new Date().toISOString()
      });
      writeChatHistory(chatHistory);

      res.json({
        answer,
        documentsReferenced: docReferences
      });
    } catch (openaiError) {
      console.error('OpenAI API error:', openaiError);
      res.status(500).json({ 
        error: 'Failed to get response from AI',
        details: openaiError.message 
      });
    }
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get chat history
router.get('/history', authenticateToken, (req, res) => {
  const chatHistory = readChatHistory();
  
  if (req.user.role === 'manager') {
    res.json({ history: chatHistory.slice(-50) });
  } else {
    const userHistory = chatHistory.filter(h => h.user_id === req.user.id).slice(-50);
    res.json({ history: userHistory });
  }
});

module.exports = router;