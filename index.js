import express from 'express';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore,
    DisconnectReason,
    Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, './')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/pair', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });

    num = num.replace(/[^0-9]/g, '');
    const sessionId = `asura_${Math.random().toString(36).substring(7)}`;
    const sessionPath = path.join('./sessions', sessionId);
    
    // സെഷൻ ഫോൾഡർ ഉണ്ടാക്കുന്നു
    if (!fs.existsSync('./sessions')) fs.mkdirSync('./sessions');

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        // ബ്രൗസർ ഡീറ്റെയിൽസ് മാറ്റുന്നത് കണക്ഷൻ എളുപ്പമാക്കും
        browser: Browsers.ubuntu("Chrome")
    });

    // പെയറിംഗ് കോഡ് എടുക്കുന്ന ഭാഗം
    setTimeout(async () => {
        try {
            if (!sock.authState.creds.registered) {
                const code = await sock.requestPairingCode(num);
                if (!res.headersSent) {
                    res.send({ code: code });
                }
            }
        } catch (err) {
            console.log("Error in requestPairingCode:", err);
            if (!res.headersSent) res.status(500).json({ error: "Service Busy" });
        }
    }, 3000); // 3 സെക്കൻഡ് ഡിലേ നൽകുന്നു

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            console.log("✅ Connection Successful!");
            await delay(5000);

            // creds.json റീഡ് ചെയ്യുന്നു
            const credsFile = path.join(sessionPath, 'creds.json');
            if (fs.existsSync(credsFile)) {
                const credsData = fs.readFileSync(credsFile);
                const base64Session = Buffer.from(credsData).toString('base64');
                const sessionID = `Asura-MD~${base64Session}`;

                // യൂസർക്ക് സെഷൻ ഐഡി അയക്കുന്നു
                await sock.sendMessage(sock.user.id, { 
                    text: `*ASURA-MD CONNECTED SUCCESSFULLY!* ✅\n\n*Session ID:* \n\`${sessionID}\`\n\n> Don't share this ID with anyone!` 
                });
            }
            
            await delay(2000);
            // സെഷൻ ക്ലീൻ അപ്പ്
            fs.rmSync(sessionPath, { recursive: true, force: true });
            // sock.logout() ഒഴിവാക്കി sock.end() ഉപയോഗിക്കുക, എങ്കിൽ മാത്രമേ വാട്സാപ്പിൽ കണക്ഷൻ നിലനിൽക്കൂ
            sock.end();
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                // കണക്ഷൻ എറർ വന്നാൽ ഇവിടെ ഹാൻഡിൽ ചെയ്യാം
            }
        }
    });
});

app.listen(port, () => console.log(`Server started on port ${port}`));
