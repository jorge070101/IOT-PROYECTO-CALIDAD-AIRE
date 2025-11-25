// ==========================================
// SERVIDOR IOT - MONITOREO DE CALIDAD DEL AIRE
// ==========================================

// 1. DEPENDENCIAS
const WebSocket = require('ws');
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');

// 2. CONFIGURACIÓN DEL SERVIDOR
const app = express();
const server = http.createServer(app);

// Configuración dinámica del puerto (Nube/Local)
const PORT = process.env.PORT || 8080;

// Middleware para procesar JSON
app.use(express.json()); 

// 3. CONEXIÓN A BASE DE DATOS
// Uso de variable de entorno para seguridad en producción
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/calidad_aire_db"; 

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB: Conexión establecida.'))
  .catch(err => console.error('MongoDB: Error de conexión:', err));

// ==========================================
// MÓDULO DE AUTENTICACIÓN (AUTH)
// ==========================================

// Esquema de Usuario
const userSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true } 
});

// Middleware: Hashing de contraseña antes de guardar
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

const User = mongoose.model('User', userSchema);

// Endpoint: Registro de usuarios
app.post('/api/auth/register', async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;

        // Validación de existencia
        let user = await User.findOne({ email: email });
        if (user) return res.status(400).json({ message: "El usuario ya existe." });

        // Creación y persistencia
        user = new User({ firstName, lastName, email, password });
        await user.save();

        console.log(`Auth: Nuevo usuario registrado (${email})`);
        res.status(201).json({ message: "Registro exitoso." });
    } catch (err) {
        console.error("Auth Error:", err);
        res.status(500).json({ message: "Error del servidor." });
    }
});

// Endpoint: Inicio de sesión
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Búsqueda de usuario
        const user = await User.findOne({ email: email });
        if (!user) return res.status(400).json({ message: "Credenciales inválidas." });

        // Verificación de hash
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Credenciales inválidas." });
        
        console.log(`Auth: Login exitoso (${email})`);
        res.status(200).json({ message: "Login exitoso." });
    } catch (err) {
        res.status(500).json({ message: "Error interno." });
    }
});


// ==========================================
// MÓDULO DE DATOS IOT
// ==========================================

// Esquema de Datos del Sensor
const sensorDataSchema = new mongoose.Schema({
  nodeID: String,
  pm1: Number,
  pm25: Number,
  pm10: Number,
  temp: Number,
  hum: Number,
  timestamp: { type: Date, default: Date.now }
});

const DataPoint = mongoose.model('DataPoint', sensorDataSchema);

// Servicio de archivos estáticos (Frontend)
app.use(express.static(path.join(__dirname, 'public'))); 

// Endpoint: Obtención de datos históricos (con filtros opcionales)
app.get('/api/data/:nodeID', async (req, res) => { 
  try {
    const { nodeID } = req.params; 
    const { start, end } = req.query; 

    let findQuery = { nodeID: nodeID };

    // Filtro por rango de fecha
    if (start && end) {
      findQuery.timestamp = { $gte: new Date(start), $lte: new Date(end) };
    }

    // Consulta y ordenamiento descendente
    let query = DataPoint.find(findQuery).sort({timestamp: -1});

    // Límite por defecto para visualización rápida
    if (!start) query = query.limit(20);
        
    const data = await query.exec(); 
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: "Error al recuperar datos." });
  }
});


// ==========================================
// SERVIDOR WEBSOCKET (TIEMPO REAL)
// ==========================================
const wss = new WebSocket.Server({ server });

wss.on('connection', function connection(ws) {
  console.log("WS: Cliente conectado.");

  ws.on('message', async function incoming(message) { 
    const messageString = message.toString('utf8');
    
    // Validación de formato JSON
    if (!messageString.startsWith('{')) return; 

    try {
      // 1. Parseo de datos entrantes
      const data = JSON.parse(messageString);
      console.log(`WS: Dato recibido de ${data.nodeID}`);

      // 2. Persistencia en MongoDB
      const newDataPoint = new DataPoint({
        nodeID: data.nodeID,
        pm1: data.pm1,
        pm25: data.pm25,
        pm10: data.pm10,
        temp: data.temp,
        hum: data.hum 
      });
      const savedData = await newDataPoint.save();

      // 3. Broadcast a clientes conectados
      const dataToSend = JSON.stringify(savedData);
      
      wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(dataToSend); 
        }
      });

    } catch (e) {
      console.error("WS Error:", e.message);
    }
  });
});

// 4. INICIALIZACIÓN
server.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto: ${PORT}`);
    console.log(`Entorno: ${process.env.PORT ? 'Producción' : 'Desarrollo'}`);
});