const fs = require('fs');
const AWS = require('aws-sdk');

// Initialize AWS services
const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const textract = new AWS.Textract({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

/**
 * Upload file to S3
 * @param {string} filePath - Local file path
 * @param {string} fileName - Desired S3 object key
 * @returns {Promise<string>} - S3 object key
 */
async function uploadToS3(filePath, fileName) {
  const bucketName = process.env.AWS_S3_BUCKET;
  
  if (!bucketName) {
    throw new Error('AWS_S3_BUCKET not configured');
  }
  
  console.log(`📤 Uploading to S3: ${fileName}`);
  
  const fileContent = fs.readFileSync(filePath);
  
  const params = {
    Bucket: bucketName,
    Key: fileName,
    Body: fileContent,
    ContentType: getContentType(filePath)
  };
  
  await s3.upload(params).promise();
  console.log(`✅ Uploaded to S3: s3://${bucketName}/${fileName}`);
  
  return fileName;
}

/**
 * Get content type based on file extension
 */
function getContentType(filePath) {
  if (filePath.endsWith('.pdf')) return 'application/pdf';
  if (filePath.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (filePath.endsWith('.doc')) return 'application/msword';
  return 'application/octet-stream';
}

/**
 * Extract text from a document using Amazon Textract
 * Uses SYNC API for files < 5MB (faster)
 * Uses ASYNC API for files >= 5MB (required for large files)
 * @param {string} s3Key - S3 object key (or local path for fallback)
 * @param {string} fileType - MIME type of the document
 * @param {boolean} isS3 - Whether file is in S3 or local
 * @param {number} fileSize - File size in bytes (optional, for optimization)
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromFile(s3Key, fileType, isS3 = true, fileSize = null) {
  try {
    // Check if AWS credentials are configured
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.warn('⚠️  AWS credentials not configured, using fallback extraction');
      return await fallbackExtraction(s3Key, fileType);
    }
    
    if (!isS3) {
      console.warn('⚠️  File not in S3, using fallback extraction');
      return await fallbackExtraction(s3Key, fileType);
    }
    
    const bucketName = process.env.AWS_S3_BUCKET;
    if (!bucketName) {
      console.warn('⚠️  AWS_S3_BUCKET not configured, using fallback extraction');
      return await fallbackExtraction(s3Key, fileType);
    }
    
    // Optimization: Use sync API for files < 5MB (much faster, no polling)
    const SYNC_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB
    const useSync = fileSize && fileSize < SYNC_SIZE_LIMIT;
    
    if (useSync) {
      console.log(`📄 Extracting text from S3: s3://${bucketName}/${s3Key} using Textract SYNC (fast)...`);
      
      try {
        const syncParams = {
          Document: {
            S3Object: {
              Bucket: bucketName,
              Name: s3Key
            }
          },
          FeatureTypes: ['TABLES', 'FORMS']
        };
        
        console.log('🔍 Calling Textract sync API...');
        const result = await textract.analyzeDocument(syncParams).promise();
        
        const lines = [];
        if (result.Blocks) {
          for (const block of result.Blocks) {
            if (block.BlockType === 'LINE') {
              lines.push(block.Text);
            }
          }
        }
        
        const extractedText = lines.join('\n');
        console.log(`✅ Textract sync extracted ${extractedText.length} characters (fast path)`);
        return extractedText;
        
      } catch (syncError) {
        // If sync fails (e.g., file actually > 5MB), fall through to async
        console.warn('⚠️  Sync API failed, falling back to async API:', syncError.message);
      }
    }
    
    // Use async API for large files or if sync failed
    console.log(`📄 Extracting text from S3: s3://${bucketName}/${s3Key} using Textract ASYNC...`);
    
    // Start async document analysis job
    const startParams = {
      DocumentLocation: {
        S3Object: {
          Bucket: bucketName,
          Name: s3Key
        }
      },
      FeatureTypes: ['TABLES', 'FORMS']
    };
    
    console.log('🔍 Starting Textract async job...');
    const startResponse = await textract.startDocumentAnalysis(startParams).promise();
    const jobId = startResponse.JobId;
    
    // Poll for job completion with adaptive polling
    const extractedText = await pollTextractJob(jobId);
    
    console.log(`✅ Textract async extracted ${extractedText.length} characters`);
    
    if (extractedText.length === 0) {
      console.warn('⚠️  No text extracted from document');
    }
    
    return extractedText;
    
  } catch (error) {
    console.error('❌ Error extracting text with Textract:', error.message);
    
    // Fallback to basic extraction if Textract fails
    console.log('⚠️  Falling back to basic extraction...');
    return await fallbackExtraction(s3Key, fileType);
  }
}

/**
 * Poll Textract job until completion with adaptive polling
 * Starts fast (0.5s), gradually slows to 2s for efficiency
 * @param {string} jobId - Textract job ID
 * @returns {Promise<string>} - Extracted text
 */
async function pollTextractJob(jobId) {
  const maxAttempts = 60;
  let attempts = 0;
  
  // Adaptive polling intervals (in milliseconds)
  // Fast at start, slower later for efficiency
  const getDelay = (attempt) => {
    if (attempt <= 3) return 500;   // First 3 checks: 0.5 sec (jobs often done quickly)
    if (attempt <= 8) return 1000;  // Next 5 checks: 1 sec
    if (attempt <= 15) return 1500; // Next 7 checks: 1.5 sec
    return 2000;                     // Remaining: 2 sec
  };
  
  console.log(`⏳ Job started: ${jobId}. Using adaptive polling...`);
  
  // First check immediately (no delay)
  try {
    const immediateResponse = await textract.getDocumentAnalysis({ JobId: jobId }).promise();
    if (immediateResponse.JobStatus === 'SUCCEEDED') {
      console.log('✅ Job completed immediately!');
      return extractTextFromResponse(immediateResponse, jobId);
    }
  } catch (err) {
    // Job might not be ready yet, continue polling
    console.log('📊 Job status: IN_PROGRESS (initial check)');
  }
  
  // Polling loop
  while (attempts < maxAttempts) {
    attempts++;
    const delay = getDelay(attempts);
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      const response = await textract.getDocumentAnalysis({ JobId: jobId }).promise();
      const status = response.JobStatus;
      
      console.log(`📊 Job status: ${status} (attempt ${attempts}/${maxAttempts}, delay ${delay}ms)`);
      
      if (status === 'SUCCEEDED') {
        console.log('✅ Textract job completed successfully');
        return extractTextFromResponse(response, jobId);
        
      } else if (status === 'FAILED') {
        throw new Error(`Textract job failed: ${response.StatusMessage || 'Unknown error'}`);
        
      } else if (status === 'PARTIAL_SUCCESS') {
        console.warn('⚠️  Textract job completed with partial success');
        return extractTextFromResponse(response, jobId);
      }
      // Status is IN_PROGRESS, continue polling
      
    } catch (pollError) {
      if (pollError.code === 'InvalidJobIdException') {
        throw new Error('Invalid Textract job ID');
      }
      console.error('❌ Error polling Textract job:', pollError.message);
      throw pollError;
    }
  }
  
  throw new Error(`Textract job timed out after ${maxAttempts} attempts (~${Math.round(maxAttempts * 1.5 / 60)} minutes)`);
}

/**
 * Extract text from Textract response, handling pagination
 * @param {Object} response - Initial Textract response
 * @param {string} jobId - Job ID for pagination
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromResponse(response, jobId) {
  const lines = [];
  
  // Process first page
  if (response.Blocks) {
    for (const block of response.Blocks) {
      if (block.BlockType === 'LINE') {
        lines.push(block.Text);
      }
    }
  }
  
  // Get additional pages if they exist (pagination)
  let nextToken = response.NextToken;
  let pageCount = 1;
  
  while (nextToken) {
    pageCount++;
    console.log(`📄 Fetching page ${pageCount}...`);
    
    const nextResponse = await textract.getDocumentAnalysis({ 
      JobId: jobId,
      NextToken: nextToken 
    }).promise();
    
    if (nextResponse.Blocks) {
      for (const block of nextResponse.Blocks) {
        if (block.BlockType === 'LINE') {
          lines.push(block.Text);
        }
      }
    }
    
    nextToken = nextResponse.NextToken;
  }
  
  if (pageCount > 1) {
    console.log(`✅ Processed ${pageCount} pages`);
  }
  
  return lines.join('\n');
}

/**
 * Fallback extraction using pdf-parse and mammoth if Textract fails
 * Downloads from S3 if needed, or uses local file
 */
async function fallbackExtraction(filePathOrKey, fileType) {
  try {
    let localPath = filePathOrKey;
    
    // If it looks like an S3 key, download it first
    if (!filePathOrKey.includes('/uploads/') && !filePathOrKey.startsWith('./')) {
      const bucketName = process.env.AWS_S3_BUCKET;
      if (bucketName) {
        console.log('📥 Downloading from S3 for fallback extraction...');
        const tempPath = `/tmp/${filePathOrKey}`;
        const params = { Bucket: bucketName, Key: filePathOrKey };
        const data = await s3.getObject(params).promise();
        fs.writeFileSync(tempPath, data.Body);
        localPath = tempPath;
      }
    }
    
    if (fileType === 'application/pdf' || fileType.includes('pdf')) {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(localPath);
      const data = await pdfParse(dataBuffer);
      console.log(`✅ Fallback: Extracted ${data.text.length} characters from PDF`);
      return data.text;
    } else if (fileType.includes('word') || fileType.includes('document')) {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: localPath });
      console.log(`✅ Fallback: Extracted ${result.value.length} characters from Word`);
      return result.value;
    }
    return '';
  } catch (fallbackError) {
    console.error('❌ Fallback extraction also failed:', fallbackError.message);
    return '';
  }
}

/**
 * Delete file from S3
 * @param {string} s3Key - S3 object key
 */
async function deleteFromS3(s3Key) {
  try {
    const bucketName = process.env.AWS_S3_BUCKET;
    if (!bucketName) {
      console.warn('⚠️  AWS_S3_BUCKET not configured, cannot delete from S3');
      return;
    }
    
    console.log(`🗑️  Deleting from S3: ${s3Key}`);
    
    const params = {
      Bucket: bucketName,
      Key: s3Key
    };
    
    await s3.deleteObject(params).promise();
    console.log(`✅ Deleted from S3: ${s3Key}`);
  } catch (error) {
    console.error('❌ Error deleting from S3:', error.message);
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
  uploadToS3,
  extractTextFromFile,
  deleteFromS3,
  truncateText
};