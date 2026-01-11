import { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    Browsers, 
    makeCacheableSignalKeyStore 
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import axios from 'axios';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// ⚙️ Environment Variables (Render/VPS-ൽ സെറ്റ് ചെയ്യുക)
const GH_TOKEN = process.env.GH_TOKEN; 
const PRIVATE_REPO_PATH = process.env.REPO_PATH; // Example: "username/privaterepo"

const commands = new Map();

// 📁 Static ഫയലുകൾ (index.html) ലോഡ് ചെയ്യാൻ
app.use(express.static('public'));

/**
 * 1. RAM Loading Logic
 * കമാൻഡുകൾ ഡിസ്കിൽ സേവ് ചെയ്യാതെ നേരിട്ട് മെമ്മറിയിലേക്ക് എടുക്കുന്നു.
 */
async function loadCommandsToRAM() {
    if (!GH_TOKEN || !PRIVATE_REPO_PATH) {
        console.error("❌ GitHub Config Missing! GH_TOKEN and REPO_PATH required.");
        return;
    }
    
    try {
        console.log("📡 Fetching commands from Private Repo...");
        const url = `https://api.github.com/repos/${PRIVATE_REPO_PATH}/contents/commands`;
        const { data } = await axios.get(url, {
            headers: { 'Authorization': `token ${GH_TOKEN}` }
        });

        for (const file of data) {
            if (file.name.endsWith('.js')) {
                const { data: code } = await axios.get(file.download_url, {
                    headers: { 'Authorization': `token ${GH_TOKEN}` }
                });
                
                // 'export default' മാറ്റി ഒരു ഫങ്ക്ഷൻ ആയി മെമ്മറിയിൽ സൂക്ഷിക്കുന്നു
                const cleanCode = code.replace(/export default/, "const handler =").concat("\nreturn handler;");
                const handler = new Function('fs', 'axios', 'path', cleanCode)(fs, axios, path);
                commands.set(file.name.replace('.js', '').toLowerCase(), handler);
            }
        }
        console.log(`✅ Success: ${commands.size} commands loaded to RAM.`);
    } catch (e) {
        console.error("❌ GitHub Loading Error: Check Token or Repo Path.");
    }
}

/**
 * 2. Pairing API
 * വെബ്സൈറ്റിൽ നിന്ന് നമ്പർ വരുമ്പോൾ പെയറിംഗ് കോഡ് നൽകുന്നു.
 */
app.get('/get-pair', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.json({ error: "Number is required" });

    // ഓരോ യൂസർക്കും പ്രത്യേകം സെഷൻ ഫോൾഡർ (താൽക്കാലികം)
    const sessionDir = `./temp_sessions/${num}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    
    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu("Chrome")
    });

    // പെയറിംഗ് കോഡ് റിക്വസ്റ്റ് ചെയ്യുന്നു
    if (!sock.authState.creds.registered) {
        try {
            setTimeout(async () => {
                let code = await sock.requestPairingCode(num);
                res.json({ code: code });
            }, 2000); // ചെറിയൊരു ഡിലേ നൽകുന്നത് സ്റ്റെബിലിറ്റിക്ക് നല്ലതാണ്
        } catch (err) {
            res.json({ error: "Pairing failed. Try again." });
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            
            // 3. Auto-Delete Session on Logout
            if (reason === DisconnectReason.loggedOut) {
                console.log(`🧹 Cleaning: User ${num} logged out. Deleting session...`);
                fs.rmSync(sessionDir, { recursive: true, force: true });
            } else {
                // ലോഗൗട്ട് അല്ലെങ്കിൽ മാത്രം റീകണക്ഷൻ ശ്രമിക്കാം (ഓപ്ഷണൽ)
            }
        }

        if (connection === 'open') {
            console.log(`🚀 Bot Connected for: ${num}`);
            await loadCommandsToRAM(); // കണക്ട് ആയാൽ ഉടൻ കമാൻഡുകൾ ലോഡ് ചെയ്യും
        }
    });

    // 📩 മെസേജ് ഹാൻഡ്‌ലിംഗ്
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text.startsWith('.')) return;

        const args = text.trim().split(/ +/).slice(1);
        const cmd = text.split(" ")[0].slice(1).toLowerCase();

        if (commands.has(cmd)) {
            try {
                const handler = commands.get(cmd);
                await handler(sock, msg, args);
            } catch (err) {
                console.error(`Error in command ${cmd}:`, err);
            }
        }
    });
});

// സർവർ സ്റ്റാർട്ട് ചെയ്യുന്നു
app.listen(PORT, () => {
    console.log(`
    Asura MD Pairing Service
    -----------------------
    Port: ${PORT}
    Status: Running...
    `);
});
