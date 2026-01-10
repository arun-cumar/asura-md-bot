import express from 'express';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

const app = express();
const port = process.env.PORT || 3000;

// സെഷൻ സൂക്ഷിക്കാൻ താൽക്കാലിക ഫോൾഡർ
const SESSION_DIR = './sessions';
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// Express-ന് നിങ്ങളുടെ HTML ഫയൽ എവിടെയാണെന്ന് പറഞ്ഞു കൊടുക്കുന്നു
app.use(express.static('./')); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/', (req, res) => {
    res.status(200).send("Asura MD Connection Service is Online! 🚀");
});

app.get('/pair', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "ഫോൺ നമ്പർ ആവശ്യമാണ്!" });

    num = num.replace(/[^0-9]/g, '');
    const sessionId = `asura_${Date.now()}`;
    const sessionPath = path.join(SESSION_DIR, sessionId);
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        // ലോഡിങ് പ്രശ്നം ഒഴിവാക്കാൻ ബ്രൗസർ ഡീറ്റെയിൽസ് കൃത്യമായി നൽകുന്നു
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // പെയറിംഗ് കോഡ് എടുക്കുന്ന ഭാഗം
    if (!sock.authState.creds.registered) {
        try {
            await delay(3000); // സർവർ സ്റ്റേബിൾ ആകാൻ 3 സെക്കൻഡ്
            const code = await sock.requestPairingCode(num);
            if (!res.headersSent) {
                res.send({ code: code });
            }
        } catch (err) {
            console.error("Pairing Request Error:", err);
            if (!res.headersSent) res.status(500).json({ error: "സെർവർ ബിസിയാണ്, വീണ്ടും ശ്രമിക്കുക." });
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log(`✅ Success: ${num} Connected`);
            
            // ലോഡിങ് മാറി കണക്ട് ആയ ശേഷം യൂസർക്ക് മെസേജ് അയക്കുന്നു
            await delay(5000);
            await sock.sendMessage(sock.user.id, { text: "Asura MD Connected Successfully! ✅" });

            // സെഷൻ ഐഡി അയച്ചു കൊടുക്കുന്ന ലോജിക് ഇവിടെ ചേർക്കാം (വേണമെങ്കിൽ)
            
            await delay(2000);
            sock.end(); // കണക്ഷൻ ക്ലോസ് ചെയ്യുന്നു
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                // കണക്ഷൻ പരാജയപ്പെട്ടാൽ സെഷൻ ക്ലീൻ ചെയ്യും
            } else {
                if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        }
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
