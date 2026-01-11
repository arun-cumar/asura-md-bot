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

const app = express();
const PORT = process.env.PORT || 10000;

// Render അല്ലെങ്കിൽ VPS-ലെ Environment Variables-ൽ ഇവ സെറ്റ് ചെയ്യുക
const GH_TOKEN = process.env.GH_TOKEN; 
const PRIVATE_REPO_PATH = process.env.REPO_PATH; // Example: "username/privaterepo"

const commands = new Map();

// 1. RAM Loading Logic (No local files created for commands)
async function loadCommandsToRAM() {
    if (!GH_TOKEN || !PRIVATE_REPO_PATH) return console.log("❌ Missing Git Config");
    
    try {
        const url = `https://api.github.com/repos/${PRIVATE_REPO_PATH}/contents/commands`;
        const { data } = await axios.get(url, {
            headers: { 'Authorization': `token ${GH_TOKEN}` }
        });

        for (const file of data) {
            if (file.name.endsWith('.js')) {
                const { data: code } = await axios.get(file.download_url, {
                    headers: { 'Authorization': `token ${GH_TOKEN}` }
                });
                // കമാൻഡുകൾ റാമിലേക്ക് മാത്രം ലോഡ് ചെയ്യുന്നു
                const cleanCode = code.replace(/export default/, "const handler =").concat("\nreturn handler;");
                const handler = new Function('fs', 'axios', 'path', cleanCode)(fs, axios, {});
                commands.set(file.name.replace('.js', ''), handler);
            }
        }
        console.log(`✅ Loaded ${commands.size} commands directly to RAM.`);
    } catch (e) {
        console.error("❌ GitHub Loading Error");
    }
}

// 2. Fast Pairing API
app.get('/get-pair', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.json({ error: "Number required" });

    // ഓരോ യൂസർക്കും പ്രത്യേകം സെഷൻ ഫോൾഡർ
    const { state, saveCreds } = await useMultiFileAuthState(`./temp_sessions/${num}`);
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu("Chrome")
    });

    if (!sock.authState.creds.registered) {
        try {
            let code = await sock.requestPairingCode(num);
            res.json({ code: code });
        } catch (err) {
            res.json({ error: "Pairing failed" });
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        // 3. Automatic Session Delete on Logout
        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                console.log(`🧹 Cleaning up: User ${num} logged out.`);
                fs.rmSync(`./temp_sessions/${num}`, { recursive: true, force: true });
            } else {
                // ലോഗൗട്ട് അല്ലെങ്കിൽ മാത്രം റീകണക്ട് ചെയ്യുക
                // startAsura(num); 
            }
        }

        if (connection === 'open') {
            console.log(`🚀 Bot is live for: ${num}`);
            await loadCommandsToRAM();
            // ഇവിടെ DM അയക്കുന്ന ഭാഗം ഒഴിവാക്കി
        }
    });

    // മെസേജ് ഹാൻഡ്‌ലിംഗ്
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text.startsWith('.')) return;

        const cmd = text.split(" ")[0].slice(1).toLowerCase();
        if (commands.has(cmd)) {
            await commands.get(cmd)(sock, msg, text.split(" ").slice(1));
        }
    });
});

app.listen(PORT, () => console.log(`Asura Pairing Service on port ${PORT}`));
