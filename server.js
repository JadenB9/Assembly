const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3001;

const connectedUsers = new Map();

app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));
app.use(express.static('public'));
app.use(express.json());

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
  }
})

const upload = multer({ storage: storage });

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', upload.single('asmFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = req.file.path;
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(500).json({ error: 'Uploaded file not found' });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    res.json({ 
      filename: req.file.filename,
      originalName: req.file.originalname,
      content: content,
      path: filePath,
      size: req.file.size
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Error processing uploaded file: ' + error.message });
  }
});

app.get('/example', (req, res) => {
  const exampleAsm = `section .data
    msg db 'Hello, Assembly World!', 0
    msg_len equ $ - msg

section .text
    global _start

_start:
    mov eax, 4          ; sys_write
    mov ebx, 1          ; stdout
    mov ecx, msg        ; message
    mov edx, msg_len    ; message length
    int 0x80            ; system call
    
    mov eax, 1          ; sys_exit
    mov ebx, 0          ; exit status
    int 0x80            ; system call`;
  
  res.json({ content: exampleAsm });
});

// Socket.IO multiplayer functionality
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Generate unique user data
  const userColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffa500', '#800080'];
  const userColor = userColors[Math.floor(Math.random() * userColors.length)];
  const userName = `User${Math.floor(Math.random() * 1000)}`;
  
  const userData = {
    id: socket.id,
    name: userName,
    color: userColor,
    position: { x: 0, y: 10, z: 20 },
    isConnected: true,
    joinTime: Date.now()
  };
  
  connectedUsers.set(socket.id, userData);
  
  // Send user their own data
  socket.emit('userAssigned', userData);
  
  // Broadcast new user to all others
  socket.broadcast.emit('userJoined', userData);
  
  // Send current users list to new user
  socket.emit('usersList', Array.from(connectedUsers.values()));
  
  // Handle user name change
  socket.on('changeName', (newName) => {
    if (connectedUsers.has(socket.id)) {
      connectedUsers.get(socket.id).name = newName;
      io.emit('userUpdated', connectedUsers.get(socket.id));
    }
  });
  
  // Handle camera position updates
  socket.on('cameraMove', (position) => {
    if (connectedUsers.has(socket.id)) {
      connectedUsers.get(socket.id).position = position;
      socket.broadcast.emit('userMoved', {
        id: socket.id,
        position: position
      });
    }
  });
  
  // Handle code sharing
  socket.on('shareCode', (codeData) => {
    socket.broadcast.emit('codeShared', {
      userId: socket.id,
      userName: connectedUsers.get(socket.id)?.name || 'Unknown',
      code: codeData.code,
      timestamp: Date.now()
    });
  });
  
  // Handle user interactions
  socket.on('userInteraction', (interactionData) => {
    socket.broadcast.emit('userInteracted', {
      userId: socket.id,
      userName: connectedUsers.get(socket.id)?.name || 'Unknown',
      interaction: interactionData,
      timestamp: Date.now()
    });
  });
  
  // Handle shooting
  socket.on('playerShot', (shotData) => {
    socket.broadcast.emit('playerShotReceived', {
      shooter: socket.id,
      shooterName: connectedUsers.get(socket.id)?.name || 'Unknown',
      position: shotData.position,
      direction: shotData.direction,
      timestamp: Date.now()
    });
  });
  
  // Handle hits
  socket.on('playerHit', (hitData) => {
    io.emit('playerHitReceived', {
      target: hitData.target,
      shooter: hitData.shooter,
      shooterName: connectedUsers.get(socket.id)?.name || 'Unknown',
      targetName: connectedUsers.get(hitData.target)?.name || 'Unknown',
      position: hitData.position,
      timestamp: Date.now()
    });
  });
  
  // Handle shared assembly code loading
  socket.on('loadSharedCode', (codeData) => {
    io.emit('sharedCodeLoaded', {
      loader: socket.id,
      loaderName: connectedUsers.get(socket.id)?.name || 'Unknown',
      code: codeData.code,
      filename: codeData.filename,
      timestamp: Date.now()
    });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    connectedUsers.delete(socket.id);
    socket.broadcast.emit('userLeft', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Assembly Game Server running at:`);
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Network:  http://192.168.3.10:${PORT}`);
  console.log(`  Network:  http://10.211.55.2:${PORT}`);
  console.log(`Connected users will be tracked in real-time`);
});