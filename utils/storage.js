const fs = require('fs');
const path = require('path');

// File paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DOCUMENTS_FILE = path.join(DATA_DIR, 'documents.json');
const CHAT_HISTORY_FILE = path.join(DATA_DIR, 'chat_history.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize files if they don't exist
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(DOCUMENTS_FILE)) {
  fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(CHAT_HISTORY_FILE)) {
  fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify([], null, 2));
}

// User storage functions
function readUsers() {
  const data = fs.readFileSync(USERS_FILE, 'utf8');
  return JSON.parse(data);
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Document storage functions
function readDocuments() {
  const data = fs.readFileSync(DOCUMENTS_FILE, 'utf8');
  return JSON.parse(data);
}

function writeDocuments(documents) {
  fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(documents, null, 2));
}

// Chat history storage functions
function readChatHistory() {
  const data = fs.readFileSync(CHAT_HISTORY_FILE, 'utf8');
  return JSON.parse(data);
}

function writeChatHistory(history) {
  fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(history, null, 2));
}

module.exports = {
  readUsers,
  writeUsers,
  readDocuments,
  writeDocuments,
  readChatHistory,
  writeChatHistory
};