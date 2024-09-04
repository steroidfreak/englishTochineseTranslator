import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import OpenAI from 'openai';

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
const upload = multer({ dest: 'uploads/' });

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint to process audio
app.post('/process-audio', upload.single('audio'), async (req, res) => {
  let outputPath; // Declare outputPath here
  try {
    const inputPath = req.file.path;
    outputPath = path.join(__dirname, 'processed.mp3'); // Assign outputPath here

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
        { role: "system", content: "You are a translator, English to Chinese or Chinese to English expert, just translate only and do not say other things" },
        { role: "user", content: transcription },
      ],
      model: "gpt-4o-mini",
    });

    const translation = completion.choices[0].message.content;

    // Text-to-speech
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "alloy",
      input: translation,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    // Send back audio buffer, transcription, and translation
    res.json({
      audio: buffer.toString('base64'), // Convert buffer to base64 string
      transcription,
      translation,
    });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).send('An error occurred');
  } finally {
    // Clean up uploaded files
    fs.unlink(req.file.path, (err) => {
      if (err) console.error("Error deleting file:", err);
    });
    if (outputPath) {
      fs.unlink(outputPath, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
    }
  }
});

// Set the port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));