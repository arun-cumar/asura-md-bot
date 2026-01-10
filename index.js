import express from 'express';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore,
    DisconnectReason 
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, './')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/pair', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });

    num = num.replace(/[^0-9]/g, '');
    const sessionId = `asura_${Math.random().toString(36).substring(7)}`;
    const sessionPath = path.join('./sessions', sessionId);
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        browser: ["Chrome (Linux)", "", ""],
        // കണക്ഷൻ വേഗത്തിലാക്കാൻ താഴെ പറയുന്നവ ചേർക്കുന്നു
        connectTimeoutMs: 60000, 
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    // പ്രധാന മാറ്റം: ഉടനെ തന്നെ പെയറിംഗ് കോഡ് ചോദിക്കുന്നു
    if (!sock.authState.creds.registered) {
        try {
            await delay(1500); // വളരെ കുറഞ്ഞ സമയം മാത്രം വെയിറ്റ് ചെയ്യുന്നു
            const code = await sock.requestPairingCode(num);
            if (!res.headersSent) {
                return res.send({ code: code });
            }
        } catch (err) {
            console.log("Error requesting code:", err);
            if (!res.headersSent) return res.status(500).json({ error: "Try again" });
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            console.log("Connected!");
            // സെഷൻ ഐഡി ജനറേറ്റ് ചെയ്ത് അയക്കുന്ന ഭാഗം
            const credsData = fs.readFileSync(path.join(sessionPath, 'creds.json'));
            const base64Session = Buffer.from(credsData).toString('base64');
            const sessionID = `Asura-MD~${base64Session}`;

            await sock.sendMessage(sock.user.id, { text: `*CONNECTED SUCCESSFULLY!* \n\n*Session ID:* \n${sessionID}` });
            
            await delay(3000);
            sock.end();
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        }
    });
});

app.listen(port, () => console.log(`Server on ${port}`));
