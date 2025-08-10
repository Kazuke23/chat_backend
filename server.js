const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Almacenamiento en memoria mejorado
let connectedUsers = [];
let userMessages = {}; // { 'usuario1': { 'usuario2': [mensajes], 'usuario3': [mensajes] } }

io.on('connection', (socket) => {
  console.log('Nuevo cliente conectado:', socket.id);

  // ================= REGISTRO DE USUARIO =================
  socket.on('register', (username) => {
    // Validaciones
    if (!username || username.trim() === '') {
      socket.emit('registrationError', 'El nombre de usuario no puede estar vacío');
      return;
    }

    if (connectedUsers.some(user => user.username === username)) {
      socket.emit('registrationError', 'Este nombre de usuario ya está en uso');
      return;
    }

    const user = { 
      id: socket.id, 
      username: username,
      timestamp: new Date().toISOString()
    };
    
    connectedUsers.push(user);
    userMessages[username] = userMessages[username] || {};
    
    // Respuesta al nuevo usuario con conteo de mensajes no leídos
    const unreadCounts = {};
    if (userMessages[username]) {
      for (const contact in userMessages[username]) {
        unreadCounts[contact] = userMessages[username][contact].filter(m => !m.read).length;
      }
    }

    socket.emit('registrationSuccess', {
      currentUser: username,
      otherUsers: connectedUsers.filter(u => u.username !== username),
      unreadCounts
    });
    
    // Notificar a los demás
    socket.broadcast.emit('userConnected', user);
    console.log(`Usuario registrado: ${username}`);
  });

  // ================= MENSAJES PRIVADOS CON NOTIFICACIONES =================
  socket.on('privateMessage', ({ to, from, message }) => {
    const receiver = connectedUsers.find(user => user.username === to);
    const sender = connectedUsers.find(user => user.username === from);
    
    if (receiver && sender) {
      const messageData = {
        from,
        to,
        message,
        timestamp: new Date().toISOString(),
        read: false
      };

      // Almacenar mensajes solo para los usuarios involucrados
      if (!userMessages[from]) userMessages[from] = {};
      if (!userMessages[to]) userMessages[to] = {};
      
      if (!userMessages[from][to]) userMessages[from][to] = [];
      if (!userMessages[to][from]) userMessages[to][from] = [];
      
      userMessages[from][to].push(messageData);
      userMessages[to][from].push(messageData);

      // Enviar mensaje al receptor con notificación
      io.to(receiver.id).emit('newMessage', {
        ...messageData,
        unreadCount: userMessages[to][from].filter(m => !m.read).length
      });

      // Confirmación al remitente
      io.to(sender.id).emit('messageSent', messageData);
    }
  });

  // ================= MARCADO DE MENSAJES COMO LEÍDOS =================
  socket.on('markAsRead', ({ sender, receiver }) => {
    if (userMessages[receiver] && userMessages[receiver][sender]) {
      userMessages[receiver][sender].forEach(msg => msg.read = true);
      
      // Notificar al remitente que sus mensajes fueron leídos
      const senderSocket = connectedUsers.find(u => u.username === sender);
      if (senderSocket) {
        io.to(senderSocket.id).emit('messagesRead', { by: receiver });
      }
    }
  });

  // ================= NOTIFICACIÓN "ESCRIBIENDO..." =================
  socket.on('typing', ({ to, from }) => {
    const receiver = connectedUsers.find(user => user.username === to);
    if (receiver) {
      io.to(receiver.id).emit('userTyping', from);
    }
  });

  socket.on('stopTyping', ({ to, from }) => {
    const receiver = connectedUsers.find(user => user.username === to);
    if (receiver) {
      io.to(receiver.id).emit('userStoppedTyping', from);
    }
  });

  // ================= OBTENER HISTORIAL DE CHAT PRIVADO =================
  socket.on('getChatHistory', ({ withUser, currentUser }, callback) => {
    const history = userMessages[currentUser]?.[withUser] || [];
    
    // Marcar mensajes como leídos al obtener el historial
    if (userMessages[currentUser]?.[withUser]) {
      userMessages[currentUser][withUser].forEach(msg => msg.read = true);
    }
    
    callback(history);
  });

  // ================= DESCONEXIÓN =================
  socket.on('disconnect', () => {
    const disconnectedUser = connectedUsers.find(user => user.id === socket.id);
    
    if (disconnectedUser) {
      connectedUsers = connectedUsers.filter(user => user.id !== socket.id);
      io.emit('userDisconnected', disconnectedUser.username);
      console.log(`Usuario desconectado: ${disconnectedUser.username}`);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});