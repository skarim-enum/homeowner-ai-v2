const OpenAI = require('openai');

// Initialize OpenAI
const apiKey = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : null;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

// Extract community name from document text using OpenAI
async function extractCommunityName(text) {
  if (!text) {
    console.log('⚠️  No text provided for community name extraction');
    return null;
  }
  
  // Check if OpenAI is configured
  if (!openai || !apiKey) {
    console.log('⚠️  OpenAI not configured, skipping community name extraction');
    return null;
  }

  try {
    console.log('🤖 Using OpenAI to extract community name...');
    
    // Use first 3000 characters of document
    const textSample = text.substring(0, 3000);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert at extracting HOA/community names from documents. Extract only the community or HOA name, nothing else. Return ONLY the name, or 'NOT_FOUND' if no community name is present."
        },
        {
          role: "user",
          content: `Extract the HOA or community name from this document text. Look for phrases like "Community Name:", "HOA:", names followed by "HOA", "Association", "Community", etc. Return ONLY the name itself, without labels.

Document text:
${textSample}

Community name:`
        }
      ],
      max_tokens: 50,
      temperature: 0.1
    });

    const extractedName = completion.choices[0].message.content.trim();
    
    // Check if extraction was successful
    if (extractedName && 
        extractedName !== 'NOT_FOUND' && 
        extractedName.toLowerCase() !== 'not found' &&
        extractedName.length >= 5 && 
        extractedName.length <= 100) {
      console.log('✅ OpenAI extracted community name:', extractedName);
      return extractedName;
    }
    
    console.log('⚠️  OpenAI could not find a community name');
    return null;
    
  } catch (error) {
    console.error('❌ Error extracting community name with OpenAI:', error.message);
    return null;
  }
}

module.exports = { extractCommunityName };