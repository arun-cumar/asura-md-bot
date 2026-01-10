import express from 'express';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    Browsers, 
    makeCacheableSignalKeyStore 
} from '@whiskeysockets/baileys';
import pino from 'pino';
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
    if (!phone) return res.send({ error: "Number required!" });

    // ഓരോ യൂസർക്കും പ്രത്യേക സെഷൻ ഫോൾഡർ (ഉദാ: session_91xxx)
    const sessionName = `session_${phone.replace(/[^0-9]/g, '')}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionName);

    try {
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: ["Ubuntu", "Chrome", "110.0.5481.177"]
        });

        if (!sock.authState.creds.registered) {
            await delay(2000);
            const code = await sock.requestPairingCode(phone.replace(/[^0-9]/g, ''));
            if (!res.headersSent) res.send({ code: code });
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                console.log(`✅ Connected: ${phone}`);
                // ഇവിടെ നിങ്ങൾക്ക് ബോട്ടിന്റെ മെയിൻ ഫംഗ്ഷനുകൾ (ഉദാ: .tagall) സ്റ്റാർട്ട് ചെയ്യാം
                await sock.sendMessage(sock.user.id, { text: "*Asura MD Connected Successfully!* 👺" });
            }
        });
    } catch (err) {
        res.status(500).send({ error: "Server Error" });
    }
});

app.listen(port, () => console.log(`Asura MD Web-Pairing on port ${port}`));
