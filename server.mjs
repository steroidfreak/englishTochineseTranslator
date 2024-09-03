import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import OpenAI from 'openai';
import os from 'os';

// Load environment variables from .env file
dotenv.config();

// Configure ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize the OpenAI client with the API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();

// Try to use cors, but continue if it's not available
try {
  const cors = await import('cors');
  app.use(cors.default());
} catch (error) {
  console.warn('CORS module not found. Continuing without CORS.');
}

// Use os.tmpdir() for temporary file storage
const upload = multer({ dest: os.tmpdir() });

app.use(express.static('public'));

app.post('/process-audio', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const outputPath = path.join(os.tmpdir(), 'processed.mp3');

    // Convert to MP3
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // Transcribe
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(outputPath),
      model: "whisper-1",
      response_format: "text",
      language: "en",
    });

    // Translate
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: "You are a translator, English to Chinese or Chinese to English expert." },
        { role: "user", content: transcription },
      ],
      model: "gpt-4",
    });

    const translation = completion.choices[0].message.content;

    // Text-to-speech
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "alloy",
      input: translation,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    // Clean up temporary files
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    // Send back audio buffer, transcription, and translation
    res.json({
      audio: buffer.toString('base64'), // Convert buffer to base64 string
      transcription,
      translation,
    });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));