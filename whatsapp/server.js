
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100MB for images/audio
});

const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Create uploads folder
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer for file uploads
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// --- Data Storage (in-memory, for production use DB like MongoDB/Supabase) ---
let users = {}; // socketId -> { id, name, avatar, socketId, lastSeen }
let messages = {}; // chatKey -> [messages]
let userSockets = {}; // userId -> socketId

function getChatKey(id1, id2) {
  return [id1, id2].sort().join('_');
}

// --- API Routes ---
app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'online', 
    onlineUsers: Object.keys(users).length,
    message: 'Nexus Messenger Server is REAL and ACTIVE - السيرفر فعال حقيقي',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/users', (req, res) => {
  const list = Object.values(users).map(u => ({ id: u.id, name: u.name, avatar: u.avatar, online: true }));
  res.json(list);
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.originalname });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Socket.IO Real-time Logic ---
io.on('connection', (socket) => {
  console.log(`✅ مستخدم جديد اتصل: ${socket.id}`);

  socket.on('register', (userData) => {
    const { id, name, avatar } = userData;
    
    // If user already exists with same ID, disconnect old
    if (userSockets[id]) {
      const oldSocketId = userSockets[id];
      if (users[oldSocketId]) {
        io.to(oldSocketId).emit('force-disconnect', 'تم تسجيل الدخول من جهاز آخر');
      }
    }

    users[socket.id] = {
      id: id || socket.id.substring(0, 8),
      name: name || 'مستخدم',
      avatar: avatar || `https://i.pravatar.cc/150?u=${id}`,
      socketId: socket.id,
      joinedAt: new Date()
    };
    userSockets[users[socket.id].id] = socket.id;

    // Send to the new user his info + all users
    socket.emit('registered', users[socket.id]);
    io.emit('users-update', Object.values(users));

    // Send chat history if exists
    socket.emit('all-messages', messages);

    console.log(`👤 تم تسجيل: ${users[socket.id].name} (${users[socket.id].id})`);
  });

  socket.on('private-message', (data) => {
    const sender = users[socket.id];
    if (!sender) return;

    const { to, content, type, filename } = data;
    const chatKey = getChatKey(sender.id, to);
    
    if (!messages[chatKey]) messages[chatKey] = [];

    const msgObj = {
      id: Date.now().toString(),
      from: sender.id,
      to: to,
      senderName: sender.name,
      content,
      type: type || 'text', // text, image, audio, file
      filename,
      time: new Date().toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now()
    };

    messages[chatKey].push(msgObj);

    // Send to recipient if online
    const recipientSocketId = userSockets[to];
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('new-message', msgObj);
    }
    // Send back to sender for confirmation
    socket.emit('new-message', msgObj);
  });

  socket.on('typing', ({ to, isTyping }) => {
    const sender = users[socket.id];
    if (!sender) return;
    const recipientSocketId = userSockets[to];
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('user-typing', { from: sender.id, isTyping });
    }
  });

  // --- WebRTC Signaling for Real Voice/Video Calls ---
  socket.on('call-request', ({ to, type }) => {
    const sender = users[socket.id];
    const recipientSocketId = userSockets[to];
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('incoming-call', { from: sender, type });
    }
  });

  socket.on('call-accept', ({ to }) => {
    const recipientSocketId = userSockets[to];
    if (recipientSocketId) io.to(recipientSocketId).emit('call-accepted');
  });

  socket.on('call-reject', ({ to }) => {
    const recipientSocketId = userSockets[to];
    if (recipientSocketId) io.to(recipientSocketId).emit('call-rejected');
  });

  socket.on('call-end', ({ to }) => {
    const recipientSocketId = userSockets[to];
    if (recipientSocketId) io.to(recipientSocketId).emit('call-ended');
  });

  socket.on('webrtc-offer', ({ to, offer }) => {
    const recipientSocketId = userSockets[to];
    if (recipientSocketId) io.to(recipientSocketId).emit('webrtc-offer', { from: users[socket.id].id, offer });
  });

  socket.on('webrtc-answer', ({ to, answer }) => {
    const recipientSocketId = userSockets[to];
    if (recipientSocketId) io.to(recipientSocketId).emit('webrtc-answer', { from: users[socket.id].id, answer });
  });

  socket.on('webrtc-ice-candidate', ({ to, candidate }) => {
    const recipientSocketId = userSockets[to];
    if (recipientSocketId) io.to(recipientSocketId).emit('webrtc-ice-candidate', { candidate });
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      console.log(`❌ انقطع: ${user.name}`);
      delete userSockets[user.id];
      delete users[socket.id];
      io.emit('users-update', Object.values(users));
      io.emit('user-disconnected', user.id);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔════════════════════════════════════════╗
  ║   Nexus Messenger - سيرفر فعال حقيقي  ║
  ║   🚀 السيرفر يعمل الآن               ║
  ║   📡 Port: ${PORT}                      ║
  ║   🌍 متاح من أي مكان في العالم        ║
  ╚════════════════════════════════════════╝
  رابط محلي: http://localhost:${PORT}
  `);
});
