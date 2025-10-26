#v2.0
#Smart community name extraction
✅ Automatic extraction - Extracts community name from document text
✅ Smart pattern matching - Recognizes various HOA name formats
✅ Manager view display - Shows community name next to each document
✅ Upload modal display - Shows community names in bulk upload results
✅ Beautiful badges - Purple gradient badges for community names
✅ Works for both - Single and bulk uploads


#v1.7
#Bulk Delete
✅ Checkbox selection for each document
✅ "Select All" checkbox to select/deselect everything
✅ Selection counter shows how many documents selected
✅ Bulk delete button deletes all selected documents
✅ Clear selection button to deselect all
✅ Visual feedback - selected documents highlighted in blue
✅ Confirmation dialog before deleting multiple documents
✅ Progress tracking during bulk delete
✅ Individual delete still available for single documents


# v1.6
# Duplicate detection
✅ Automatic duplicate detection based on filename
✅ Warning modal for single file uploads before processing
✅ Choice to proceed or cancel upload
✅ Batch duplicate detection for bulk uploads
✅ Separate "Duplicates" section in bulk upload results
✅ Case-insensitive matching (HOA-Rules.pdf = hoa-rules.pdf)
✅ Within-batch duplicate prevention (can't upload same file twice in one batch)
✅ Clean error messages explaining why files were skipped

# v1.5
# Bulk Upload Confirmation Modal - Update Guide
### New Features:
✅ Animated modal popup after bulk upload
✅ Visual summary cards (Total, Successful, Failed)
✅ Detailed list of successfully uploaded files
✅ Detailed list of failed files with error messages
✅ Color-coded status indicators (green ✅, red ❌, yellow ⚠️)
✅ File sizes displayed for successful uploads
✅ Clean, modern design with smooth animations
✅ Click outside modal or "Close" button to dismiss

# Resident Support AI

AI-powered HOA document management and chat assistant system.

## Features

### For HOA Managers
- Upload HOA documents (PDF, Word) up to 50MB
- Manage document library
- View chat activity from residents
- Automatic text extraction from documents

### For Residents
- Ask questions about HOA documents using AI chatbot
- Get instant answers powered by OpenAI GPT-3.5
- Browse available community documents
- Natural conversation interface

## Technology Stack

- **Backend:** Node.js, Express
- **Database:** SQLite
- **AI:** OpenAI GPT-3.5-turbo
- **Frontend:** React (vanilla JS via CDN)
- **Authentication:** JWT tokens
- **File Processing:** pdf-parse, mammoth

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- OpenAI API key

## Installation

Module Responsibilities
========================

server.js (47 lines)
├── Load environment variables
├── Setup Express app
├── Mount routes
└── Start HTTP server

config/multer.js (40 lines)
├── Configure file storage
├── Set file size limits
└── Validate file types

middleware/auth.js (38 lines)
├── authenticateToken() - Verify JWT tokens
└── authorizeRole() - Check user permissions

utils/storage.js (60 lines)
├── readUsers() / writeUsers()
├── readDocuments() / writeDocuments()
└── readChatHistory() / writeChatHistory()

utils/fileExtractor.js (37 lines)
├── extractTextFromFile() - Extract text from PDF/Word
└── truncateText() - Limit text length for AI

routes/auth.js (96 lines)
├── POST /api/register - User registration
└── POST /api/login - User authentication

routes/documents.js (330 lines)
├── POST /api/documents/check-duplicates
├── POST /api/documents/upload
├── POST /api/documents/bulk-upload
├── GET  /api/documents
├── DELETE /api/documents/:id
└── POST /api/documents/bulk-delete

routes/chat.js (89 lines)
├── POST /api/chat - Ask AI questions
└── GET  /api/chat/history - Retrieve chat history


API Endpoints
=============

Authentication:
  POST   /api/register              - Create new user
  POST   /api/login                 - Login & get JWT token

Documents:
  POST   /api/documents/check-duplicates  - Check for duplicate files
  POST   /api/documents/upload            - Upload single document (+ community_name)
  POST   /api/documents/bulk-upload       - Upload multiple documents (+ community_name)
  GET    /api/documents                   - List all documents
  DELETE /api/documents/:id               - Delete single document
  POST   /api/documents/bulk-delete       - Delete multiple documents

Chat:
  POST   /api/chat                  - Ask AI question about documents
  GET    /api/chat/history          - Get chat history

Health:
  GET    /api/health                - Server health check


Data Flow
=========

Upload Single Document:
  1. User selects file + enters community name
  2. Frontend sends FormData to /api/documents/upload
  3. Middleware: authenticateToken() → authorizeRole(['manager'])
  4. Route: routes/documents.js
     ├── Multer saves file to /uploads/
     ├── Check for duplicates
     ├── Extract text (utils/fileExtractor.js)
     ├── Store metadata + community_name (utils/storage.js)
     └── Return success response
  5. Frontend displays document with community badge

Upload Bulk Documents:
  1. User selects multiple files + enters community name
  2. Frontend sends FormData to /api/documents/bulk-upload
  3. Middleware: authenticateToken() → authorizeRole(['manager'])
  4. Route: routes/documents.js
     ├── Loop through each file
     ├── Check duplicates
     ├── Extract text
     ├── Store with same community_name for all
     └── Return batch results
  5. Frontend shows modal with success/failures

Chat with AI:
  1. User asks question
  2. Frontend sends to /api/chat
  3. Middleware: authenticateToken()
  4. Route: routes/chat.js
     ├── Load all documents (utils/storage.js)
     ├── Prepare context from document texts
     ├── Call OpenAI API
     ├── Store chat history
     └── Return AI response + referenced docs
  5. Frontend displays answer + document references

1. **Clone or navigate to the project directory:**
   ```bash
   cd resident-support-ai
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Edit the `.env` file and add your OpenAI API key:
   ```
   OPENAI_API_KEY=your-actual-openai-api-key-here
   ```

4. **Start the server:**
   ```bash
   npm start
   ```
   
   For development with auto-reload:
   ```bash
   npm run dev
   ```

5. **Access the application:**
   Open your browser and go to: `http://localhost:3001`

## Default Login Credentials

### Manager Account
- Username: `manager`
- Password: `password123`

### Resident Account
- Username: `resident`
- Password: `password123`

**⚠️ Important:** Change these default passwords in production!

## Usage

### As a Manager

1. Log in with manager credentials
2. Navigate to "Upload Documents" tab
3. Click "Select File" and choose a PDF or Word document
4. Wait for the upload and text extraction to complete
5. Switch to "Manage Documents" to view and delete documents

### As a Resident

1. Log in with resident credentials
2. Type your question in the chat interface
3. The AI will search through all uploaded HOA documents and provide an answer
4. View all available documents in the "Available Documents" section

## API Endpoints

### Authentication
- `POST /api/login` - User login

### Documents
- `GET /api/documents` - List all documents
- `POST /api/documents/upload` - Upload document (manager only)
- `DELETE /api/documents/:id` - Delete document (manager only)

### Chat
- `POST /api/chat` - Ask a question about documents
- `GET /api/chat/history` - Get chat history

### Health
- `GET /api/health` - Server health check

## Project Structure

```
resident-support-ai/
├── server.js           # Main Express server
├── package.json        # Dependencies
├── .env               # Environment variables
├── uploads/           # Uploaded documents
├── public/
│   └── index.html     # Frontend application
└── hoa_documents.db   # SQLite database (auto-created)
```

## Configuration

All configuration is done via the `.env` file:

- `OPENAI_API_KEY` - Your OpenAI API key (required)
- `JWT_SECRET` - Secret key for JWT tokens
- `PORT` - Server port (default: 3001)
- `MAX_FILE_SIZE` - Maximum file size in bytes (default: 50MB)
- `DB_PATH` - SQLite database path

## Security Features

- JWT token authentication
- Role-based access control
- Password hashing with bcrypt
- Rate limiting on API endpoints
- File type validation
- File size limits
- Helmet.js security headers

## Troubleshooting

### "OpenAI API error"
- Make sure you have a valid OpenAI API key in the `.env` file
- Check that you have sufficient credits in your OpenAI account

### "Could not extract text from document"
- Ensure the PDF is not image-based (scanned) or password-protected
- Try a different document format

### Database errors
- Delete `hoa_documents.db` to reset the database
- Check file permissions in the project directory

## Future Enhancements

- PostgreSQL support for production
- Document categorization and tagging
- Advanced search and filtering
- Email notifications
- Mobile app
- Multi-tenancy for multiple HOA communities
- Document versioning
- Audit logs

## License

MIT

## Support

For issues or questions, please check the documentation or contact support.



