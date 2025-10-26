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
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
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
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800 },
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

    // Extract text from the document
    const extractedText = await extractTextFromFile(req.file.path, req.file.mimetype);
    
    if (!extractedText || extractedText.trim().length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Could not extract text from document' });
    }

    // Add document to storage
    const newDocument = {
      id: documents.length + 1,
      filename: req.file.filename,
      original_name: req.file.originalname,
      file_path: req.file.path,
      file_type: req.file.mimetype,
      file_size: req.file.size,
      extracted_text: extractedText,
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
        file_type: req.file.mimetype
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
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

    const results = {
      successful: [],
      failed: [],
      duplicates: []
    };

    const documents = readDocuments();
    const existingNames = documents.map(doc => doc.original_name.toLowerCase());
    let nextId = documents.length > 0 ? Math.max(...documents.map(d => d.id)) + 1 : 1;

    // Process each file
    for (const file of req.files) {
      try {
        console.log(`📄 Processing: ${file.originalname}`);

        // Check for duplicate
        const isDuplicate = existingNames.includes(file.originalname.toLowerCase());
        
        if (isDuplicate) {
          fs.unlinkSync(file.path); // Clean up uploaded file
          results.duplicates.push({
            filename: file.originalname,
            error: 'Duplicate document - file with this name already exists'
          });
          console.log(`⚠️  Duplicate detected: ${file.originalname}`);
          continue;
        }

        // Extract text from the document
        const extractedText = await extractTextFromFile(file.path, file.mimetype);
        
        if (!extractedText || extractedText.trim().length === 0) {
          fs.unlinkSync(file.path);
          results.failed.push({
            filename: file.originalname,
            error: 'Could not extract text from document'
          });
          continue;
        }

        // Add document to storage
        const newDocument = {
          id: nextId++,
          filename: file.filename,
          original_name: file.originalname,
          file_path: file.path,
          file_type: file.mimetype,
          file_size: file.size,
          extracted_text: extractedText,
          uploaded_by: req.user.id,
          uploaded_at: new Date().toISOString()
        };
        documents.push(newDocument);
        existingNames.push(file.originalname.toLowerCase()); // Track newly added to prevent duplicates within the batch

        results.successful.push({
          id: newDocument.id,
          filename: file.filename,
          original_name: file.originalname,
          file_size: file.size,
          file_type: file.mimetype
        });

        console.log(`✅ Successfully processed: ${file.originalname}`);
      } catch (error) {
        console.error(`❌ Error processing ${file.originalname}:`, error);
        // Clean up file if it exists
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        results.failed.push({
          filename: file.originalname,
          error: error.message
        });
      }
    }

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
    uploaded_at: doc.uploaded_at
  }));
  res.json({ documents: documentsForClient });
});

// Delete document (managers only)
app.delete('/api/documents/:id', authenticateToken, authorizeRole(['manager']), (req, res) => {
  const documentId = parseInt(req.params.id);
  const documents = readDocuments();
  const docIndex = documents.findIndex(d => d.id === documentId);

  if (docIndex === -1) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const doc = documents[docIndex];

  // Delete file from filesystem
  if (fs.existsSync(doc.file_path)) {
    fs.unlinkSync(doc.file_path);
  }

  // Remove from storage
  documents.splice(docIndex, 1);
  writeDocuments(documents);

  res.json({ message: 'Document deleted successfully' });
});

// Chat endpoint - Ask questions about documents
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: 'Question is required' });
    }

    console.log('💬 Question:', question);

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
app.get('/api/chat/history', authenticateToken, (req, res) => {
  const chatHistory = readChatHistory();
  
  if (req.user.role === 'manager') {
    res.json({ history: chatHistory.slice(-50) });
  } else {
    const userHistory = chatHistory.filter(h => h.user_id === req.user.id).slice(-50);
    res.json({ history: userHistory });
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