// Extract community name from document text
function extractCommunityName(text) {
  if (!text) return null;
  
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
    
    // Pattern 5: Letterhead style
    /^([A-Z][A-Za-z\s&'-]+(?:HOA|Association|Community|Estates|Village|Villas|Condos|Condominiums|Apartments|Homes|Park|Place|Ridge|Heights|Hills|Gardens|Grove|Manor|Court|Commons|Landing|Crossing|Creek|Lake|View))\s*$/mi
  ];
  
  // Try each pattern
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      let name = match[1].trim();
      // Clean up the name
      name = name.replace(/\s+/g, ' '); // normalize spaces
      name = name.replace(/^the\s+/i, ''); // remove leading "the"
      name = name.substring(0, 100); // limit length
      
      // Validate it looks like a real name (not just random text)
      if (name.length >= 5 && name.length <= 100) {
        return name;
      }
    }
  }
  
  // Fallback: look for any capitalized phrase with community-related keywords in first 2000 chars
  const firstPart = text.substring(0, 2000);
  const fallbackMatch = firstPart.match(/([A-Z][A-Za-z\s&'-]{5,60})\s+(?:HOA|Association|Community)/i);
  if (fallbackMatch && fallbackMatch[1]) {
    let name = fallbackMatch[1].trim();
    name = name.replace(/\s+/g, ' ');
    name = name.replace(/^the\s+/i, '');
    if (name.length >= 5 && name.length <= 100) {
      return name;
    }
  }
  
  return null;
}

module.exports = { extractCommunityName };