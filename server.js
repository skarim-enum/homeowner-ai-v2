require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize OpenAI
const apiKey = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : null;

if (!apiKey) {
  console.error('❌ OPENAI_API_KEY is not set in .env file');
  console.log('⚠️  The Late Fee Summary report will not work without an OpenAI API key');
} else if (!apiKey.startsWith('sk-')) {
  console.error('❌ OPENAI_API_KEY appears to be invalid (should start with "sk-")');
  console.error('   Key starts with:', apiKey.substring(0, 10));
} else {
  console.log('✅ OpenAI API key found');
  console.log('   Key starts with:', apiKey.substring(0, 10));
}

const openai = new OpenAI({
  apiKey: apiKey
});

// Data files
const DATA_DIR = './data';
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DOCUMENTS_FILE = path.join(DATA_DIR, 'documents.json');
const CHAT_HISTORY_FILE = path.join(DATA_DIR, 'chat_history.json');

// Initialize data directory and files
function initializeData() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Initialize users
  if (!fs.existsSync(USERS_FILE)) {
    const defaultPassword = bcrypt.hashSync('password123', 10);
    const users = [
      { id: 1, username: 'manager', password: defaultPassword, role: 'manager', created_at: new Date().toISOString() },
      { id: 2, username: 'resident', password: defaultPassword, role: 'resident', created_at: new Date().toISOString() }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    console.log('✅ Default users created');
    console.log('📝 Manager - username: manager, password: password123');
    console.log('📝 Resident - username: resident, password: password123');
  }

  // Initialize documents
  if (!fs.existsSync(DOCUMENTS_FILE)) {
    fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify([], null, 2));
  }

  // Initialize chat history
  if (!fs.existsSync(CHAT_HISTORY_FILE)) {
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify([], null, 2));
  }
}

// Helper functions for data access
function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function readDocuments() {
  return JSON.parse(fs.readFileSync(DOCUMENTS_FILE, 'utf8'));
}

function writeDocuments(documents) {
  fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(documents, null, 2));
}

function readChatHistory() {
  return JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8'));
}

function writeChatHistory(history) {
  fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// Initialize data
initializeData();
console.log('✅ Data storage initialized');

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit for Textract async API
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and Word documents are allowed.'));
    }
  }
});

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Role-based authorization middleware
function authorizeRole(allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Extract text from uploaded files
const { extractTextFromFile, truncateText, uploadToS3, deleteFromS3 } = require('./utils/fileExtractor');

// ==================== API ROUTES ====================

// Register endpoint
app.post('/api/register', (req, res) => {
  const { username, password, role } = req.body;

  // Validation
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const userRole = role || 'resident'; // Default to resident if not specified
  if (!['manager', 'resident'].includes(userRole)) {
    return res.status(400).json({ error: 'Invalid role. Must be "manager" or "resident"' });
  }

  // Check if username already exists
  const users = readUsers();
  const existingUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (existingUser) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  // Hash password
  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) {
      return res.status(500).json({ error: 'Error creating account' });
    }

    // Create new user
    const newUser = {
      id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
      username: username,
      password: hashedPassword,
      role: userRole,
      created_at: new Date().toISOString()
    };

    users.push(newUser);
    
    // Save to file
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (error) {
      return res.status(500).json({ error: 'Error saving user' });
    }

    // Generate token
    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`✅ New user registered: ${username} (${userRole})`);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role
      }
    });
  });
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const users = readUsers();
  const user = users.find(u => u.username === username);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  bcrypt.compare(password, user.password, (err, isMatch) => {
    if (err || !isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  });
});

// Check for duplicate documents
app.post('/api/documents/check-duplicates', authenticateToken, authorizeRole(['manager']), (req, res) => {
  try {
    const { filenames } = req.body;

    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ error: 'Filenames array required' });
    }

    const documents = readDocuments();
    const existingNames = documents.map(doc => doc.original_name.toLowerCase());
    
    const duplicates = filenames.filter(filename => 
      existingNames.includes(filename.toLowerCase())
    );

    res.json({
      hasDuplicates: duplicates.length > 0,
      duplicates: duplicates,
      count: duplicates.length
    });
  } catch (error) {
    console.error('Duplicate check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload document (managers only)
app.post('/api/documents/upload', authenticateToken, authorizeRole(['manager']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('📄 Processing file:', req.file.originalname);
    console.log(`📦 File size: ${(req.file.size / 1024 / 1024).toFixed(2)}MB`);

    // Get community name from request (optional)
    const communityName = req.body.community_name ? req.body.community_name.trim() : null;
    if (communityName) {
      console.log('🏘️  Community name:', communityName);
    }

    // Check for duplicate
    const documents = readDocuments();
    const isDuplicate = documents.some(doc => 
      doc.original_name.toLowerCase() === req.file.originalname.toLowerCase()
    );

    if (isDuplicate) {
      fs.unlinkSync(req.file.path); // Clean up uploaded file
      return res.status(409).json({ 
        error: 'Duplicate file detected',
        message: `A document named "${req.file.originalname}" already exists. Please rename the file or delete the existing document first.`,
        isDuplicate: true
      });
    }

    // Upload to S3
    let s3Key;
    try {
      s3Key = await uploadToS3(req.file.path, req.file.filename);
      console.log('✅ File uploaded to S3:', s3Key);
    } catch (s3Error) {
      console.error('❌ S3 upload failed:', s3Error.message);
      fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: 'Failed to upload file to S3: ' + s3Error.message });
    }

    // Extract text from the document using S3 reference (pass file size for optimization)
    const extractedText = await extractTextFromFile(s3Key, req.file.mimetype, true, req.file.size);
    
    if (!extractedText || extractedText.trim().length === 0) {
      // Clean up S3 file if extraction failed
      await deleteFromS3(s3Key);
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Could not extract text from document' });
    }

    // Clean up local file after successful S3 upload and extraction
    fs.unlinkSync(req.file.path);
    console.log('🗑️  Local file cleaned up:', req.file.path);

    // Add document to storage
    const newDocument = {
      id: documents.length + 1,
      filename: req.file.filename,
      original_name: req.file.originalname,
      s3_key: s3Key, // Store S3 key instead of local path
      file_path: `s3://${process.env.AWS_S3_BUCKET}/${s3Key}`, // Full S3 path for reference
      file_type: req.file.mimetype,
      file_size: req.file.size,
      extracted_text: extractedText,
      community_name: communityName,
      uploaded_by: req.user.id,
      uploaded_at: new Date().toISOString()
    };
    documents.push(newDocument);
    writeDocuments(documents);

    res.json({
      message: 'Document uploaded successfully',
      document: {
        id: newDocument.id,
        filename: req.file.filename,
        original_name: req.file.originalname,
        file_size: req.file.size,
        file_type: req.file.mimetype,
        community_name: communityName,
        s3_key: s3Key
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    // Clean up local file if exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

// Bulk upload documents (managers only) - up to 10 files at once
app.post('/api/documents/bulk-upload', authenticateToken, authorizeRole(['manager']), upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    if (req.files.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 files allowed per upload' });
    }

    console.log(`📦 Processing ${req.files.length} files for bulk upload...`);

    // Get community name from request (optional, applies to all files in batch)
    const communityName = req.body.community_name ? req.body.community_name.trim() : null;
    if (communityName) {
      console.log('🏘️  Community name for batch:', communityName);
    }

    const results = {
      successful: [],
      failed: [],
      duplicates: []
    };

    const documents = readDocuments();
    const existingNames = documents.map(doc => doc.original_name.toLowerCase());
    let nextId = documents.length > 0 ? Math.max(...documents.map(d => d.id)) + 1 : 1;

    console.log('⚡ Processing files in parallel for faster upload...');

    // Process all files in parallel using Promise.allSettled
    const processingPromises = req.files.map(async (file) => {
      try {
        console.log(`📄 Starting: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

        // Check for duplicate
        const isDuplicate = existingNames.includes(file.originalname.toLowerCase());
        
        if (isDuplicate) {
          fs.unlinkSync(file.path);
          return {
            status: 'duplicate',
            filename: file.originalname,
            error: 'Duplicate document - file with this name already exists'
          };
        }

        // Upload to S3
        let s3Key;
        try {
          s3Key = await uploadToS3(file.path, file.filename);
          console.log(`✅ S3 upload complete: ${file.originalname}`);
        } catch (s3Error) {
          console.error(`❌ S3 upload failed for ${file.originalname}:`, s3Error.message);
          fs.unlinkSync(file.path);
          return {
            status: 'failed',
            filename: file.originalname,
            error: 'Failed to upload to S3: ' + s3Error.message
          };
        }

        // Extract text from the document using S3 reference (happens in parallel, pass size for optimization)
        const extractedText = await extractTextFromFile(s3Key, file.mimetype, true, file.size);
        
        if (!extractedText || extractedText.trim().length === 0) {
          await deleteFromS3(s3Key);
          fs.unlinkSync(file.path);
          return {
            status: 'failed',
            filename: file.originalname,
            error: 'Could not extract text from document'
          };
        }

        // Clean up local file after successful S3 upload and extraction
        fs.unlinkSync(file.path);

        console.log(`✅ Successfully processed: ${file.originalname}`);
        
        return {
          status: 'success',
          data: {
            filename: file.filename,
            original_name: file.originalname,
            s3_key: s3Key,
            file_path: `s3://${process.env.AWS_S3_BUCKET}/${s3Key}`,
            file_type: file.mimetype,
            file_size: file.size,
            extracted_text: extractedText,
            community_name: communityName,
            uploaded_by: req.user.id,
            uploaded_at: new Date().toISOString()
          }
        };
        
      } catch (error) {
        console.error(`❌ Error processing ${file.originalname}:`, error);
        // Clean up file if it exists
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        return {
          status: 'failed',
          filename: file.originalname,
          error: error.message
        };
      }
    });

    // Wait for all files to complete processing
    const settledResults = await Promise.allSettled(processingPromises);

    // Categorize results
    settledResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const fileResult = result.value;
        
        if (fileResult.status === 'success') {
          const newDocument = {
            id: nextId++,
            ...fileResult.data
          };
          documents.push(newDocument);
          existingNames.push(fileResult.data.original_name.toLowerCase());
          
          results.successful.push({
            id: newDocument.id,
            filename: fileResult.data.filename,
            original_name: fileResult.data.original_name,
            file_size: fileResult.data.file_size,
            file_type: fileResult.data.file_type,
            community_name: communityName,
            s3_key: fileResult.data.s3_key
          });
        } else if (fileResult.status === 'duplicate') {
          results.duplicates.push({
            filename: fileResult.filename,
            error: fileResult.error
          });
        } else if (fileResult.status === 'failed') {
          results.failed.push({
            filename: fileResult.filename,
            error: fileResult.error
          });
        }
      } else {
        // Promise rejected
        results.failed.push({
          filename: req.files[index].originalname,
          error: result.reason?.message || 'Unknown error'
        });
      }
    });

    // Save all successfully processed documents
    if (results.successful.length > 0) {
      writeDocuments(documents);
    }

    // Send response
    const totalFiles = req.files.length;
    const successCount = results.successful.length;
    const failCount = results.failed.length;
    const duplicateCount = results.duplicates.length;

    console.log(`📊 Bulk upload complete: ${successCount} successful, ${failCount} failed, ${duplicateCount} duplicates`);

    res.json({
      message: `Bulk upload complete: ${successCount}/${totalFiles} files processed successfully`,
      successful: results.successful,
      failed: results.failed,
      duplicates: results.duplicates,
      summary: {
        total: totalFiles,
        successful: successCount,
        failed: failCount,
        duplicates: duplicateCount
      }
    });
  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all documents
app.get('/api/documents', authenticateToken, (req, res) => {
  const documents = readDocuments();
  const documentsForClient = documents.map(doc => ({
    id: doc.id,
    filename: doc.filename,
    original_name: doc.original_name,
    file_type: doc.file_type,
    file_size: doc.file_size,
    community_name: doc.community_name,
    uploaded_at: doc.uploaded_at
  }));
  res.json({ documents: documentsForClient });
});

// Delete document (managers only)
app.delete('/api/documents/:id', authenticateToken, authorizeRole(['manager']), async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const documents = readDocuments();
    const docIndex = documents.findIndex(d => d.id === documentId);

    if (docIndex === -1) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = documents[docIndex];

    // Delete file from S3 if s3_key exists
    if (doc.s3_key) {
      await deleteFromS3(doc.s3_key);
    }
    
    // Also delete from local filesystem if path exists (for backward compatibility)
    if (doc.file_path && !doc.file_path.startsWith('s3://') && fs.existsSync(doc.file_path)) {
      fs.unlinkSync(doc.file_path);
    }

    // Remove from storage
    documents.splice(docIndex, 1);
    writeDocuments(documents);

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update document community name
app.patch('/api/documents/:id/community-name', authenticateToken, authorizeRole(['manager']), (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const { community_name } = req.body;
    
    console.log(`📝 Updating community name for document ${documentId} to:`, community_name);

    const documents = readDocuments();
    const docIndex = documents.findIndex(d => d.id === documentId);

    if (docIndex === -1) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Update community name
    documents[docIndex].community_name = community_name || null;
    documents[docIndex].updated_at = new Date().toISOString();
    
    writeDocuments(documents);

    console.log(`✅ Community name updated for ${documents[docIndex].original_name}`);
    
    res.json({ 
      message: 'Community name updated successfully',
      document: documents[docIndex]
    });
  } catch (error) {
    console.error('❌ Error updating community name:', error);
    res.status(500).json({ error: error.message });
  }
});

// Chat endpoint - Ask questions about documents
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: 'Question is required' });
    }

    console.log('💬 Question:', question);

    // Check if OpenAI API key is configured
    const apiKey = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : null;
    if (!apiKey) {
      console.error('❌ Chat failed: OPENAI_API_KEY not configured');
      return res.status(500).json({ 
        error: 'AI service not configured. Please add OPENAI_API_KEY to .env file.' 
      });
    }

    const documents = readDocuments();

    if (documents.length === 0) {
      return res.json({
        answer: 'I don\'t have any documents to reference yet. Please ask your HOA manager to upload community documents first.',
        documentsReferenced: []
      });
    }

    // Combine all document texts with truncation
    let combinedContext = 'Here are the HOA documents:\n\n';
    const docReferences = [];

    for (const doc of documents) {
      const truncatedText = truncateText(doc.extracted_text, 2000);
      combinedContext += `Document: ${doc.original_name}\n${truncatedText}\n\n---\n\n`;
      docReferences.push({ id: doc.id, name: doc.original_name });
    }

    // Truncate the entire context if still too long
    combinedContext = truncateText(combinedContext, 10000);

    console.log('🤖 Calling OpenAI API for chat...');

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

      console.log('✅ Chat response generated successfully');

      // Save to chat history
      const chatHistory = readChatHistory();
      chatHistory.push({
        id: chatHistory.length + 1,
        user_id: req.user.id,
        question,
        answer,
        documents_referenced: JSON.stringify(docReferences),
        created_at: new Date().toISOString()
      });
      writeChatHistory(chatHistory);

      res.json({
        answer,
        documentsReferenced: docReferences
      });
    } catch (openaiError) {
      console.error('❌ OpenAI API error in chat:', {
        message: openaiError.message,
        type: openaiError.type,
        code: openaiError.code,
        status: openaiError.status
      });
      res.status(500).json({ 
        error: 'Failed to get response from AI: ' + openaiError.message
      });
    }
  } catch (error) {
    console.error('❌ Chat endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get chat history
app.get('/api/chat/history', authenticateToken, (req, res) => {
  const chatHistory = readChatHistory();
  
  if (req.user.role === 'manager') {
    res.json({ history: chatHistory.slice(-50) });
  } else {
    const userHistory = chatHistory.filter(h => h.user_id === req.user.id).slice(-50);
    res.json({ history: userHistory });
  }
});

// Generate Late Fee Summary Report
app.post('/api/reports/late-fee-summary', authenticateToken, authorizeRole(['manager']), async (req, res) => {
  try {
    console.log('📊 Generating Late Fee Summary report...');
    
    // Validate OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : null;
    
    if (!apiKey) {
      console.error('❌ OPENAI_API_KEY not found in environment');
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key not configured. Please add OPENAI_API_KEY to .env file.'
      });
    }
    
    console.log('🔑 Using OpenAI API key:', apiKey.substring(0, 15) + '...' + apiKey.substring(apiKey.length - 4));
    console.log('🔑 Key length:', apiKey.length, 'characters');
    
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
        
        // Use cached extracted text if available, otherwise extract from S3
        let text;
        if (doc.extracted_text && doc.extracted_text.trim().length > 0) {
          text = doc.extracted_text;
          console.log(`✅ Using cached text (${text.length} characters)`);
        } else if (doc.s3_key) {
          // Extract from S3 if text not cached
          text = await extractTextFromFile(doc.s3_key, doc.file_type, true);
        } else if (doc.file_path && !doc.file_path.startsWith('s3://')) {
          // Fallback to local file extraction (for old documents)
          text = await extractTextFromFile(doc.file_path, doc.file_type, false);
        }
        
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

        console.log(`🤖 Calling OpenAI API for ${doc.original_name}...`);
        
        let completion;
        try {
          completion = await openai.chat.completions.create({
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
        } catch (openaiError) {
          console.error(`❌ OpenAI API Error for ${doc.original_name}:`, {
            message: openaiError.message,
            type: openaiError.type,
            code: openaiError.code,
            status: openaiError.status
          });
          throw openaiError;
        }

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Resident Support AI Server running on port ${PORT}`);
  console.log(`📍 API available at http://localhost:${PORT}/api`);
  console.log(`🌐 Frontend available at http://localhost:${PORT}\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Shutting down gracefully...');
  process.exit(0);
});