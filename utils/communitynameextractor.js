const AWS = require('aws-sdk');

// Initialize AWS Textract
const textract = new AWS.Textract({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

/**
 * Extract community name from document text using pattern matching
 * Text should already be extracted by Textract
 */
function extractCommunityName(text) {
  if (!text || text.trim().length === 0) {
    console.log('⚠️  No text provided for community name extraction');
    return null;
  }
  
  console.log('🏘️  Extracting community name using pattern matching...');
  
  // Search first 3000 characters for community name
  const searchText = text.substring(0, 3000);
  
  // Common patterns for community names in HOA documents
  const patterns = [
    // Pattern 1: Direct declaration with "Community Name:" or similar
    /(?:community|association|hoa)(?:\s+name)?[:\s]+([A-Z][A-Za-z\s&'-]+(?:HOA|Association|Community|Estates|Village|Villas|Condos|Condominiums|Apartments|Homes|Park|Place|Ridge|Heights|Hills|Gardens|Grove|Manor|Court|Commons|Landing|Crossing|Creek|Lake|View))/i,
    
    // Pattern 2: Name followed by descriptive text
    /([A-Z][A-Za-z\s&'-]+(?:HOA|Association|Community|Estates|Village|Villas|Condos|Condominiums|Apartments|Homes|Park|Place|Ridge|Heights|Hills|Gardens|Grove|Manor|Court|Commons|Landing|Crossing|Creek|Lake|View))\s+(?:homeowners|home owners|residents|rules|regulations|bylaws|policies|guidelines|covenant)/i,
    
    // Pattern 3: Welcome/introduction phrases
    /(?:welcome to|located in|property of|this document is for|prepared for)\s+(?:the\s+)?([A-Z][A-Za-z\s&'-]+(?:HOA|Association|Community|Estates|Village|Villas|Condos|Condominiums|Apartments|Homes|Park|Place|Ridge|Heights|Hills|Gardens|Grove|Manor|Court|Commons|Landing|Crossing|Creek|Lake|View))/i,
    
    // Pattern 4: Incorporated entities
    /([A-Z][A-Za-z\s&'-]+(?:HOA|Association|Community|Estates|Village|Villas|Condos|Condominiums|Apartments|Homes))[,\s]+(?:Inc\.|Incorporated|LLC)/i,
    
    // Pattern 5: Letterhead style (at start of document)
    /^([A-Z][A-Za-z\s&'-]+(?:HOA|Association|Community|Estates|Village|Villas|Condos|Condominiums|Apartments|Homes|Park|Place|Ridge|Heights|Hills|Gardens|Grove|Manor|Court|Commons|Landing|Crossing|Creek|Lake|View))\s*$/mi,
    
    // Pattern 6: "of the [Community Name]"
    /of\s+the\s+([A-Z][A-Za-z\s&'-]+(?:HOA|Association|Community|Estates|Village|Villas|Condos|Condominiums|Apartments|Homes))/i
  ];
  
  // Try each pattern
  for (const pattern of patterns) {
    const match = searchText.match(pattern);
    if (match && match[1]) {
      let name = match[1].trim();
      // Clean up the name
      name = name.replace(/\s+/g, ' '); // normalize spaces
      name = name.replace(/^the\s+/i, ''); // remove leading "the"
      name = name.substring(0, 100); // limit length
      
      // Validate it looks like a real name (not just random text)
      if (name.length >= 5 && name.length <= 100) {
        console.log('✅ Extracted community name:', name);
        return name;
      }
    }
  }
  
  // Fallback: look for any capitalized phrase with community-related keywords
  const fallbackMatch = searchText.match(/([A-Z][A-Za-z\s&'-]{5,60})\s+(?:HOA|Association|Community)/i);
  if (fallbackMatch && fallbackMatch[1]) {
    let name = fallbackMatch[1].trim();
    name = name.replace(/\s+/g, ' ');
    name = name.replace(/^the\s+/i, '');
    if (name.length >= 5 && name.length <= 100) {
      console.log('✅ Extracted community name (fallback):', name);
      return name;
    }
  }
  
  console.log('⚠️  No community name found in document');
  return null;
}

module.exports = { extractCommunityName };