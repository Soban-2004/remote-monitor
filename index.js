
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const connectedComputers = new Map();
const registeredComputers = new Map();
const connectionCodes = new Map();

app.get('/api/computers', (req, res) => {
    const allComputers = [];

    for (const computer of connectedComputers.values()) {
        allComputers.push({
            id: computer.id,
            name: computer.name,
            ip: computer.ip,
            status: 'online',
            lastSeen: computer.lastSeen
        });
    }

    for (const [id, computer] of registeredComputers.entries()) {
        if (!connectedComputers.has(id)) {
            allComputers.push({
                id: computer.id,
                name: computer.name,
                ip: computer.ip || 'unknown',
                status: 'offline',
                lastSeen: computer.lastSeen
            });
        }
    }

    res.json(allComputers);
});

app.post('/api/computers/register', (req, res) => {
    const { name, connectionCode } = req.body;

    if (!name || !connectionCode) {
        return res.status(400).json({ message: 'Computer name and connection code are required' });
    }

    const computerId = `reg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    registeredComputers.set(computerId, {
        id: computerId,
        name,
        status: 'offline',
        lastSeen: new Date(),
        connectionCode
    });

    connectionCodes.set(connectionCode, computerId);

    io.emit('computers-updated');

    return res.status(201).json({
        message: 'Computer registered successfully',
        id: computerId
    });
});

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);
    let computerInfo = null;

    socket.on('register-computer', (data) => {
        let id = socket.id;

        if (data.connectionCode && connectionCodes.has(data.connectionCode)) {
            const registeredId = connectionCodes.get(data.connectionCode);

            if (registeredComputers.has(registeredId)) {
                id = registeredId;
                const registered = registeredComputers.get(registeredId);
                data.name = registered.name;
            }
        }

        computerInfo = {
            id: id,
            name: data.name,
            ip: socket.handshake.address,
            lastSeen: new Date(),
            capabilities: data.capabilities || {},
            connectionCode: data.connectionCode
        };

        connectedComputers.set(socket.id, computerInfo);

        if (registeredComputers.has(id)) {
            registeredComputers.set(id, {
                ...registeredComputers.get(id),
                status: 'online',
                lastSeen: new Date()
            });
        }

        io.emit('computers-updated');
    });

    socket.on('webcam-frame', (data) => {
        io.to(data.viewerId).emit('webcam-frame', {
            frame: data.frame,
            computerId: socket.id
        });

        if (computerInfo) {
            computerInfo.lastSeen = new Date();
            connectedComputers.set(socket.id, computerInfo);

            if (registeredComputers.has(computerInfo.id)) {
                const registered = registeredComputers.get(computerInfo.id);
                registered.lastSeen = new Date();
                registeredComputers.set(computerInfo.id, registered);
            }
        }
    });

    socket.on('request-stream', (data) => {
        const { computerId } = data;
        const targetComputer = connectedComputers.get(computerId);

        if (targetComputer) {
            io.to(computerId).emit('start-stream', {
                viewerId: socket.id
            });

            socket.emit('stream-ready', {
                computerName: targetComputer.name
            });
        } else {
            socket.emit('stream-error', {
                message: 'Computer is not connected'
            });
        }
    });

    socket.on('stop-stream', (data) => {
        const { computerId } = data;
        if (computerId) {
            io.to(computerId).emit('stop-stream', {
                viewerId: socket.id
            });
        }
    });

    socket.on('disconnect', () => {
        if (computerInfo) {
            connectedComputers.delete(socket.id);

            if (registeredComputers.has(computerInfo.id)) {
                const registered = registeredComputers.get(computerInfo.id);
                registered.status = 'offline';
                registered.lastSeen = new Date();
                registeredComputers.set(computerInfo.id, registered);
            }

            io.emit('computers-updated');
        }
    });
});

setInterval(() => {
    const now = new Date();
    for (const [id, computer] of connectedComputers.entries()) {
        const timeDiff = now - computer.lastSeen;
        if (timeDiff > 60000) {
            connectedComputers.delete(id);

            if (registeredComputers.has(computer.id)) {
                const registered = registeredComputers.get(computer.id);
                registered.status = 'offline';
                registered.lastSeen = new Date();
                registeredComputers.set(computer.id, registered);
            }

            io.emit('computers-updated');
        }
    }
}, 30000);

const PORT = process.env.PORT || 10000; // Match Render's expected port
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
