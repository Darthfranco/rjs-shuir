const express = require('express');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');
const { put, del, head, list } = require('@vercel/blob');

dotenv.config();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

// Enhanced CORS middleware for better debugging
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Log incoming requests for debugging
  console.log(`${req.method} ${req.path} - Headers:`, req.headers);
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// MongoDB setup
const uri = process.env.MONGODB_URI || 'mongodb+srv://rjsadmin:VYdJT03rN8a6VMVd@rjsshuir.2fk6fuf.mongodb.net/rjs-shuir?retryWrites=true&w=majority';
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

// Fixed generate-upload-url endpoint that creates a signed URL for client-side uploads
app.post('/generate-upload-url', async (req, res) => {
  console.log('Received generate-upload-url request');
  console.log('Request body:', req.body);
  
  try {
    const { filename } = req.body;
    if (!filename) {
      console.log('Missing filename in request');
      return res.status(400).json({ message: 'Filename is required.' });
    }
    
    // Create a clean filename with timestamp to prevent conflicts
    const cleanFilename = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const timestampedFilename = `recordings/${Date.now()}_${cleanFilename}`;
    
    console.log('Generating signed URL for:', timestampedFilename);
    
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error('BLOB_READ_WRITE_TOKEN is missing');
      return res.status(500).json({ message: 'Server configuration error: Missing Blob token' });
    }
    
    // Create a signed URL directly using the put function
    const signedURL = await put(timestampedFilename, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
    }, { type: 'application/octet-stream' });
    
    console.log('Generated URL successfully:', { uploadUrl: signedURL.url });
    res.json({ 
      uploadUrl: signedURL.url,
      downloadUrl: signedURL.url
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({ 
      message: 'Error generating upload URL: ' + error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Modified upload endpoint to store metadata only
app.post('/store-recording', async (req, res) => {
  try {
    console.log('Received store-recording request');
    console.log('Request body:', req.body);
    
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
    
    const result = await collection.insertOne(recording);
    console.log('Recording stored with ID:', result.insertedId);

    res.json({ 
      message: 'Recording uploaded and metadata stored successfully!',
      recordingId: result.insertedId
    });
  } catch (error) {
    console.error('Error storing recording metadata:', error);
    res.status(500).json({ message: 'Error storing recording metadata: ' + error.message });
  }
});

app.get('/search', async (req, res) => {
  try {
    const query = req.query.query || '';
    console.log('Searching recordings with query:', query);
    
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
      .sort({ uploadedAt: -1 }) // Show newest first
      .toArray();
    
    console.log(`Found ${recordings.length} matching recordings`);
    res.json(recordings);
  } catch (error) {
    console.error('Error searching recordings:', error);
    res.status(500).json({ message: 'Error searching recordings: ' + error.message });
  }
});

// Enhanced health check endpoint for debugging
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    blobEnabled: !!process.env.BLOB_READ_WRITE_TOKEN,
    nodeVersion: process.version,
    blobVersion: require('@vercel/blob/package.json').version || 'unknown'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;