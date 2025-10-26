const express = require('express');
const fs = require('fs');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { readDocuments, writeDocuments } = require('../utils/storage');
const { extractTextFromFile } = require('../utils/fileExtractor');
const { extractCommunityName } = require('../utils/communityNameExtractor');
const upload = require('../config/multer');

const router = express.Router();

// Check for duplicates endpoint
router.post('/check-duplicates', authenticateToken, authorizeRole(['manager']), (req, res) => {
  try {
    const { filenames } = req.body;
    
    if (!filenames || !Array.isArray(filenames)) {
      return res.status(400).json({ error: 'Invalid request: filenames array required' });
    }

    const documents = readDocuments();
    const existingNames = documents.map(doc => doc.original_name.toLowerCase());
    
    const duplicates = filenames.filter(name => 
      existingNames.includes(name.toLowerCase())
    );

    res.json({
      hasDuplicates: duplicates.length > 0,
      duplicates: duplicates
    });
  } catch (error) {
    console.error('Duplicate check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload document (managers only)
router.post('/upload', authenticateToken, authorizeRole(['manager']), upload.single('file'), async (req, res) => {
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

    // Determine community name based on skip_extraction flag
    let communityName;
    if (req.body.skip_extraction === 'true') {
      // Manual mode: use provided name or default "COMMUNITY NAME"
      communityName = req.body.community_name && req.body.community_name.trim() 
        ? req.body.community_name.trim() 
        : 'COMMUNITY NAME';
      console.log('🏘️  Using manual community name:', communityName);
    } else {
      // Auto-extract mode: extract from document text
      communityName = extractCommunityName(extractedText);
      if (communityName) {
        console.log('🏘️  Extracted community name:', communityName);
      } else {
        console.log('🏘️  No community name found in document');
      }
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
        community_name: communityName
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk upload documents (managers only) - up to 10 files at once
router.post('/bulk-upload', authenticateToken, authorizeRole(['manager']), upload.array('files', 10), async (req, res) => {
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

        // Determine community name based on skip_extraction flag
        let communityName;
        if (req.body.skip_extraction === 'true') {
          // Manual mode: use provided name or default "COMMUNITY NAME"
          communityName = req.body.community_name && req.body.community_name.trim() 
            ? req.body.community_name.trim() 
            : 'COMMUNITY NAME';
          console.log(`🏘️  Using manual community name for ${file.originalname}:`, communityName);
        } else {
          // Auto-extract mode: extract from document text
          communityName = extractCommunityName(extractedText);
          if (communityName) {
            console.log(`🏘️  Extracted community name from ${file.originalname}:`, communityName);
          } else {
            console.log(`🏘️  No community name found in ${file.originalname}`);
          }
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
          community_name: communityName,
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
          file_type: file.mimetype,
          community_name: communityName
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

    // Write all successful uploads at once
    writeDocuments(documents);

    console.log(`✅ Bulk upload complete: ${results.successful.length} successful, ${results.failed.length} failed, ${results.duplicates.length} duplicates`);

    res.json({
      message: 'Bulk upload completed',
      successful: results.successful,
      failed: results.failed,
      duplicates: results.duplicates,
      summary: {
        total: req.files.length,
        successful: results.successful.length,
        failed: results.failed.length,
        duplicates: results.duplicates.length
      }
    });
  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all documents
router.get('/', authenticateToken, (req, res) => {
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

// Update document community name (managers only)
router.patch('/:id/community-name', authenticateToken, authorizeRole(['manager']), (req, res) => {
  try {
    const { community_name } = req.body;
    const documents = readDocuments();
    const docIndex = documents.findIndex(d => d.id === parseInt(req.params.id));
    
    if (docIndex === -1) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Update community name (can be null/empty to clear it)
    documents[docIndex].community_name = community_name ? community_name.trim() : null;
    writeDocuments(documents);

    console.log(`📝 Updated community name for document ${req.params.id}: ${documents[docIndex].community_name || '(cleared)'}`);

    res.json({
      message: 'Community name updated successfully',
      document: {
        id: documents[docIndex].id,
        original_name: documents[docIndex].original_name,
        community_name: documents[docIndex].community_name
      }
    });
  } catch (error) {
    console.error('Update community name error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete document (managers only)
router.delete('/:id', authenticateToken, authorizeRole(['manager']), (req, res) => {
  try {
    const documents = readDocuments();
    const docIndex = documents.findIndex(d => d.id === parseInt(req.params.id));
    
    if (docIndex === -1) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete physical file
    const doc = documents[docIndex];
    if (fs.existsSync(doc.file_path)) {
      fs.unlinkSync(doc.file_path);
    }

    // Remove from database
    documents.splice(docIndex, 1);
    writeDocuments(documents);

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk delete documents (managers only)
router.post('/bulk-delete', authenticateToken, authorizeRole(['manager']), (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Document IDs array required' });
    }

    const documents = readDocuments();
    let deletedCount = 0;
    const failedDeletes = [];

    // Delete each document
    for (const id of ids) {
      const docIndex = documents.findIndex(d => d.id === parseInt(id));
      
      if (docIndex !== -1) {
        const doc = documents[docIndex];
        
        // Delete physical file
        try {
          if (fs.existsSync(doc.file_path)) {
            fs.unlinkSync(doc.file_path);
          }
          
          // Remove from array
          documents.splice(docIndex, 1);
          deletedCount++;
        } catch (error) {
          console.error(`Failed to delete document ${id}:`, error);
          failedDeletes.push({ id, error: error.message });
        }
      } else {
        failedDeletes.push({ id, error: 'Document not found' });
      }
    }

    // Write updated documents
    writeDocuments(documents);

    res.json({ 
      message: `Successfully deleted ${deletedCount} document(s)`,
      deletedCount,
      failedCount: failedDeletes.length,
      failed: failedDeletes
    });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;