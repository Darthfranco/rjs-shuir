const express = require('express');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const { put } = require('@vercel/blob');

dotenv.config();
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

// MongoDB setup
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let db;

async function connectDB() {
  if (db) return db;
  try {
    await client.connect();
    db = client.db('rjs-shuir');
    console.log('Connected to MongoDB');
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error.message, error.stack);
    throw error;
  }
}

// Middleware to ensure DB connection
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(500).json({ message: 'Database connection failed.' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.post('/api/send-support', async (req, res) => {
  const { name, email, problem } = req.body;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: email,
    to: process.env.EMAIL_USER,
    subject: `Tech Support Request from ${name}`,
    text: `Name: ${name}\nEmail: ${email}\nProblem: ${problem}`,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ message: 'Support request sent successfully!' });
  } catch (error) {
    console.error('Error sending support email:', error.message, error.stack);
    res.status(500).json({ message: 'Error sending support request.' });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const { date, type, 'shiur-number': shiurNumber, 'mussar-name': mussarName } = req.body;
    if (!req.file || !date || !type) {
      console.error('Missing required fields:', { file: !!req.file, date, type });
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    // Verify Blob token
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error('BLOB_READ_WRITE_TOKEN is missing');
      return res.status(500).json({ message: 'Server configuration error.' });
    }

    // Upload to Vercel Blob
    console.log('Uploading to Vercel Blob:', req.file.originalname);
    const blob = await put(`recordings/${Date.now()}_${req.file.originalname}`, req.file.buffer, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    console.log('Blob upload successful:', blob.url);

    // Store metadata in MongoDB
    const collection = db.collection('recordings');
    const recording = {
      date,
      type,
      ...(type === 'Shiur' && { shiurNumber }),
      ...(type === 'Mussar' && { mussarName }),
      fileUrl: blob.url,
      uploadedAt: new Date(),
    };
    console.log('Inserting to MongoDB:', recording);
    await collection.insertOne(recording);
    console.log('MongoDB insert successful');

    res.json({ message: 'Recording uploaded successfully!' });
  } catch (error) {
    console.error('Error uploading recording:', error.message, error.stack);
    res.status(500).json({ message: 'Error uploading recording.', error: error.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.query || '';
    const collection = db.collection('recordings');
    const recordings = await collection
      .find({
        $or: [
          { date: { $regex: query, $options: 'i' } },
          { type: { $regex: query, $options: 'i' } },
          { shiurNumber: { $regex: query, $options: 'i' } },
          { mussarName: { $regex: query, $options: 'i' } },
        ],
      })
      .toArray();
    res.json(recordings);
  } catch (error) {
    console.error('Error searching recordings:', error.message, error.stack);
    res.status(500).json({ message: 'Error searching recordings.' });
  }
});

// Export for Vercel serverless
module.exports = app;