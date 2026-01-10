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

// സെഷൻ സൂക്ഷിക്കാൻ താൽക്കാലിക ഫോൾഡർ
const SESSION_DIR = './temp_sessions';
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

app.get('/', (req, res) => {
    res.send("Asura MD Pair Code Service is Running! 🚀");
});

app.get('/pair', async (req, res) => {
    let phone = req.query.number;
    
    if (!phone) {
        return res.status(400).send({ error: "Phone number is required!" });
    }

    // ഫോൺ നമ്പറിൽ നിന്ന് അനാവശ്യ ചിഹ്നങ്ങൾ ഒഴിവാക്കുന്നു
    phone = phone.replace(/[^0-9]/g, '');

    // ഓരോ റിക്വസ്റ്റിനും പ്രത്യേകം ഫോൾഡർ (Conflict ഒഴിവാക്കാൻ)
    const sessionId = `${phone}_${Date.now()}`;
    const specificSession = path.join(SESSION_DIR, sessionId);
    
    const { state, saveCreds } = await useMultiFileAuthState(specificSession);

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        // ബ്രൗസർ ഐഡന്റിറ്റി മാറ്റുന്നത് കണക്ഷൻ എളുപ്പമാക്കും
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    });

    // പെയറിംഗ് കോഡ് റിക്വസ്റ്റ് ചെയ്യാനുള്ള ലോജിക്
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phone);
                if (!res.headersSent) {
                    res.send({ code: code });
                }
            } catch (err) {
                console.error("Pairing Error:", err);
                if (!res.headersSent) res.status(500).send({ error: "Service Busy. Try Again." });
            }
        }, 3000); // 3 സെക്കൻഡ് വെയിറ്റ് ചെയ്യുന്നു
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log(`✅ Success: ${phone} Connected`);
            
            // ലിങ്ക് ആയിക്കഴിഞ്ഞാൽ വാട്സാപ്പിലേക്ക് ഒരു കൺഫർമേഷൻ അയക്കുന്നു
            await delay(5000);
            await sock.sendMessage(sock.user.id, { text: "Asura MD Pair Code Successful! ✅" });
            
            // സെഷൻ ഫയലുകൾ ക്ലീൻ ചെയ്യുന്നു (Memory മാനേജ്‌മെന്റ്)
            await delay(2000);
            await sock.logout();
            
            if (fs.existsSync(specificSession)) {
                fs.rmSync(specificSession, { recursive: true, force: true });
            }
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                // കണക്ഷൻ എറർ വന്നാൽ സെഷൻ ക്ലീൻ ചെയ്യുക
                if (fs.existsSync(specificSession)) {
                    fs.rmSync(specificSession, { recursive: true, force: true });
                }
            }
        }
    });
});

app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});
