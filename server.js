import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// Simple static page
app.get("/", (_req, res) => {
  res.send(`
    <html>
      <head><title>Raspberry Pi Audio Kiosk</title></head>
      <body style="font-family:sans-serif;text-align:center;padding-top:4rem;">
        <h1>🎵 Raspberry Pi Audio Kiosk</h1>
        <p>Your kiosk is working!</p>
      </body>
    </html>
  `);
});

const PORT = 3000;
app.listen(PORT, () => console.log("Server running at http://localhost:" + PORT));

