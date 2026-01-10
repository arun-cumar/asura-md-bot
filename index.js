import express from 'express';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    Browsers, 
    makeCacheableSignalKeyStore,
    DisconnectReason 
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

// ⚠️ തിരുത്തിയത്: Raw ലിങ്ക് ഉപയോഗിക്കുക
const GITHUB_TOKEN = "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"; 
const REPO_BASE_URL = "https://raw.githubusercontent.com/blackmama12/AsuraMd/main/commands/";

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/pair', async (req, res) => {
    let phone = req.query.number;
    if (!phone) return res.send({ error: "Number required!" });

    phone = phone.replace(/[^0-9]/g, '');
    const sessionPath = path.join(__dirname, 'session', phone);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    try {
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            // വേഗത്തിൽ കണക്ട് ആകാൻ ഉബുണ്ടു ക്രോം ഐഡന്റിറ്റി 👇
            browser: Browsers.ubuntu("Chrome") 
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered) {
            await delay(1500); // ഡിലേ കുറച്ചു
            const code = await sock.requestPairingCode(phone);
            if (!res.headersSent) res.send({ code: code });
        }

        // 🚀 കമാൻഡ് ഹാൻഡ്‌ലർ
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            if (!text.startsWith('.')) return;

            const args = text.trim().split(/ +/).slice(1);
            const command = text.split(" ")[0].slice(1).toLowerCase();

            try {
                const response = await axios.get(`${REPO_BASE_URL}${command}.js`, {
                    headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
                });

                let rawCode = response.data;
                const cleanCode = rawCode.replace(/export default/, "const handler =").concat("\nreturn handler;");
                const commandRoutine = new Function('fs', 'axios', 'path', cleanCode)(fs, axios, path);
                
                await commandRoutine(sock, msg, args);

            } catch (err) {
                console.log(`Command Error [${command}]:`, err.message);
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'open') {
                console.log(`✅ ${phone} Connected!`);
                await sock.sendMessage(sock.user.id, { text: "*👺 Asura MD Cloud Active!*" });
            }
            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason === DisconnectReason.loggedOut) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                }
            }
        });

    } catch (err) {
        if (!res.headersSent) res.status(500).send({ error: "Server Busy" });
    }
});

app.listen(port, () => console.log(`Asura MD Cloud running on ${port}`));
