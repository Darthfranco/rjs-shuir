const express = require('express');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');
const { put, del, head, generateClientUpload } = require('@vercel/blob');

dotenv.config();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

// MongoDB setup
const uri = 'mongodb+srv://rjsadmin:VYdJT03rN8a6VMVd@rjsshuir.2fk6fuf.mongodb.net/rjs-shuir?retryWrites=true&w=majority';
const client = new MongoClient(uri);
let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db('rjs-shuir');
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
  }
}
connectDB();

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.post('/send-support', async (req, res) => {
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
    console.error(error);
    res.status(500).json({ message: 'Error sending support request.' });
  }
});

// New endpoint to generate client-side upload URL
app.post('/generate-upload-url', async (req, res) => {
  const { filename } = req.body;
  if (!filename) {
    return res.status(400).json({ message: 'Filename is required.' });
  }
  try {
    const { url } = await generateClientUpload(`recordings/${Date.now()}_${filename}`, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    res.json({ uploadUrl: url });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({ message: 'Error generating upload URL.' });
  }
});

// GET endpoint to handle invalid method for generate-upload-url
app.get('/generate-upload-url', (req, res) => {
  res.status(405).json({ message: 'Method Not Allowed. Use POST to generate upload URL.' });
});

// Modified upload endpoint to store metadata only
app.post('/store-recording', async (req, res) => {
  try {
    const { date, type, 'shiur-number': shiurNumber, 'mussar-name': mussarName, fileUrl } = req.body;
    if (!fileUrl || !date || !type) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    // Store metadata in MongoDB
    const collection = db.collection('recordings');
    const recording = {
      date,
      type,
      ...(type === 'Shiur' && { shiurNumber }),
      ...(type === 'Mussar' && { mussarName }),
      fileUrl,
      uploadedAt: new Date(),
    };
    await collection.insertOne(recording);

    res.json({ message: 'Recording metadata stored successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error storing recording metadata.' });
  }
});

app.get('/search', async (req, res) => {
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
    console.error(error);
    res.status(500).json({ message: 'Error searching recordings.' });
  }
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

module.exports = app;