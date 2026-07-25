require('dotenv').config();
const express = require('express');
const cors = require('cors');

const masterProfileRoutes = require('./routes/masterProfile');
const extractJdRoutes = require('./routes/extractJd');
const generateResumeRoutes = require('./routes/generateResume');
const approveResumeRoutes = require('./routes/approveResume');
const searchResumesRoutes = require('./routes/searchResumes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*', // Chrome extension origin
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/master-profile', masterProfileRoutes);
app.use('/api/extract-jd', extractJdRoutes);
app.use('/api/generate-resume', generateResumeRoutes);
app.use('/api/approve-resume', approveResumeRoutes);
app.use('/api/search-resumes', searchResumesRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`FirSeCV backend running on http://localhost:${PORT}`);
});

module.exports = app;
