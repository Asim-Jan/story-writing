import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import session from 'express-session';
import RedisStore from 'connect-redis';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import epub from 'epub-gen-memory';
import { AIBookOrchestrator } from './ai-agent-orchestrator.js';
import { AIImportAnalyzer } from './ai-import-analyzer.js';
import { AIChapterDetector } from './parsers/ai-chapter-detector.js';
import multer from 'multer';
import { parseEPUB } from './parsers/epub-parser.js';
import { parsePDF } from './parsers/pdf-parser.js';
import { parseDOCX } from './parsers/docx-parser.js';
import { parseTXT } from './parsers/txt-parser.js';
import { extractChapters, validateChapters, getChapterStats } from './parsers/chapter-extractor.js';
import { mediaStorage } from './services/mediaStorage.js';
import { VideoSceneParser } from './services/videoSceneParser.js';
import { VideoGenerator } from './services/videoGenerator.js';
import { VideoAssembler } from './services/videoAssembler.js';
import rateLimit from 'express-rate-limit';
import { validate, schemas } from './middleware/validation.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { initializeAuthorization } from './middleware/authorization.js';
import { ApiResponse } from './utils/responses.js';
import { encrypt, decrypt } from './utils/encryption.js';
import { setMediaBookMapping, getMediaBookMapping } from './utils/mediaMapping.js';
import { requireAdmin, preventSelfModification } from './middleware/adminAuth.js';
import {
  getUserQuotas,
  checkBookQuota,
  checkWordQuota,
  checkChapterQuota,
  checkAIQuota,
  checkJobQuota,
  requireFeature,
  incrementAICounter,
  updateQuotaUsage
} from './middleware/quotaEnforcement.js';
import { getTierQuotas, getTierLimitsDisplay } from './config/tierQuotas.js';
import UserRepository from './db/repositories/UserRepository.js';
import BookRepository from './db/repositories/BookRepository.js';
import { getPool } from './db/postgres.js';
import {
  imageQueue,
  audioQueue,
  contentQueue,
  importQueue,
  videoQueue,
  storeJobMetadata,
  getUserJobs,
  getJobStatus,
  cleanupJob,
} from './jobs/queue.js';
import {
  queueImageGeneration,
  queueAudioGeneration,
  queueContentGeneration,
  queueImportAnalysis,
  queueVideoGeneration,
  canQueueJob,
} from './jobs/jobHelper.js';
import {
  initializeRedis,
  getRedisClient,
  // User operations
  getUser,
  getUserByEmail,
  createUser,
  updateUser,
  updateUserSettings,
  getUserSettings,
  // Book operations
  getBook,
  getUserBooks,
  createBook,
  updateBook,
  deleteBook,
  checkBookAccess,
  // Chapter operations
  getBookChapters,
  createChapter,
  updateChapter,
  // Temporary data (stays in Redis)
  setPasswordResetToken,
  getPasswordResetToken,
  deletePasswordResetToken,
  setImportData,
  getImportData,
  setApiKeyData,
  getApiKeyData,
  deleteApiKeyData,
  setUserApiKeys as setUserApiKeysRedis,
  getUserApiKeys as getUserApiKeysRedis,
  getStats,
  setStats,
  getRPGData,
  setRPGData,
  deleteRPGData,
  // Raw Redis access
  getRedisValue,
  setRedisValue,
  // Status
  getMigrationStatus,
} from './services/dataAdapter.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Google GenAI for image generation
const genai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Create public/images directory if it doesn't exist
const imagesDir = path.join(__dirname, '..', 'public', 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

// Create uploads directory for imported books
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.epub', '.pdf', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only EPUB, PDF, DOCX, and TXT files are allowed.'));
    }
  }
});

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Helper function to get the base URL from request
function getBaseUrl(req) {
  // Check for custom header (set by ngrok or reverse proxy)
  if (req.headers['x-forwarded-host']) {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    return `${protocol}://${req.headers['x-forwarded-host']}`;
  }

  // Use the host header
  const protocol = req.protocol || 'http';
  const host = req.get('host');
  return `${protocol}://${host}`;
}

// Trust proxy - required for ALB/Load Balancer
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// SECURITY: Per-user rate limiting for AI endpoints (expensive operations)
// Uses user ID instead of IP to prevent unfair limits in shared networks
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  message: 'Too many AI generation requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // SECURITY: Use user ID as rate limit key instead of IP
  keyGenerator: (req) => {
    // If user is authenticated, use their user ID
    if (req.user && req.user.id) {
      return `user:${req.user.id}`;
    }
    // Fall back to IP for unauthenticated requests (shouldn't happen since auth is required)
    return `ip:${req.ip}`;
  },
  // Dynamic limit based on user tier (extensible for future tier system)
  max: async (req) => {
    if (!req.user) return 10; // Unauthenticated users get minimal access

    // Future: Check user tier from database
    // const user = await getUserById(req.user.id);
    // switch(user.tier) {
    //   case 'premium': return 200;
    //   case 'basic': return 50;
    //   default: return 10; // free tier
    // }

    // For now, all authenticated users get 50 requests per 15 minutes
    return 50;
  },
});

// SECURITY: Rate limiting for auth endpoints (prevent brute force)
// Uses email + IP combination for better security
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 failed login attempts per 15 minutes
  message: 'Too many login attempts, please try again later',
  skipSuccessfulRequests: true, // Only count failed attempts
  // SECURITY: Use email + IP to prevent both distributed attacks and targeted attacks
  keyGenerator: (req) => {
    const email = req.body?.email || 'unknown';
    return `auth:${email}:${req.ip}`;
  },
});

// Redis client - MUST be created before session middleware
// Initialize Redis Client (via Data Adapter for session, jobs, etc.)
let redisClient;
try {
  redisClient = await initializeRedis();

  // Log migration status
  const migrationStatus = getMigrationStatus();
  console.log('🔄 Migration Status:');
  console.log(`   Phase: ${migrationStatus.phase}`);
  console.log(`   PostgreSQL: ${migrationStatus.usePostgres ? 'Enabled' : 'Disabled'}`);
  console.log(`   Dual-Write: ${migrationStatus.dualWrite ? 'Active' : 'Inactive'}`);
  console.log(`   Reading from: ${migrationStatus.readFromPostgres ? 'PostgreSQL' : 'Redis'}`);

  // Initialize authorization middleware with Redis client
  initializeAuthorization(redisClient);
} catch (error) {
  console.error('❌ FATAL: Could not connect to Redis');
  console.error('Make sure Redis is running: docker-compose up -d redis');
  console.error('Error:', error.message);
  process.exit(1); // Exit if Redis unavailable
}

// Initialize job queue system
try {
  const { initializeJobTracking } = await import('./jobs/queue.js');
  await initializeJobTracking();
  console.log('✓ Job queue system initialized');
} catch (error) {
  console.error('⚠️  Job queue initialization failed:', error.message);
  console.error('   Background jobs will not be available');
}

// Initialize Redis session store
const redisStore = new RedisStore({
  client: redisClient,
  prefix: 'sess:',
});

// Session middleware - MUST come after redisStore initialization
app.use(session({
  store: redisStore,
  secret: JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to false for HTTP, true when using HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// Initialize MinIO storage
let minioAvailable = false;
try {
  await mediaStorage.initialize();
  minioAvailable = true;
} catch (error) {
  console.warn('⚠️  MinIO initialization failed. Media features will be disabled.');
  console.warn('⚠️  Make sure MinIO is running: docker-compose up -d minio');
  console.warn('⚠️  Error:', error.message);
}

// Helper to check if MinIO is required for an operation
const requireMinIO = (req, res, next) => {
  if (!minioAvailable) {
    return res.status(503).json({
      error: 'Media storage unavailable',
      message: 'MinIO is not running. Start it with: docker-compose up -d minio'
    });
  }
  next();
};

// Helper function to get book key
const getBookKey = (bookId) => `book:${bookId}`;
const getUserKey = (userId) => `user:${userId}`;
const getUserEmailKey = (email) => `user:email:${email}`;
const getPasswordResetKey = (token) => `password_reset:${token}`;

// Helper to get user's API keys - NO FALLBACK to system keys
const getUserApiKeysHelper = async (userId) => {
  try {
    // Get user with settings from database
    const user = await getUserSettings(userId);

    if (!user || !user.ai_config) {
      return {
        openaiKey: null,
        geminiKey: null,
        usingUserKeys: false
      };
    }

    const aiConfig = user.ai_config || {};

    // SECURITY: Decrypt API keys if they exist (already encrypted in DB)
    // Support both camelCase (old) and snake_case (new) field names
    const openaiKey = (aiConfig.openai_api_key || aiConfig.openaiApiKey)
      ? decrypt(aiConfig.openai_api_key || aiConfig.openaiApiKey)
      : null;
    const geminiKey = (aiConfig.gemini_api_key || aiConfig.geminiApiKey)
      ? decrypt(aiConfig.gemini_api_key || aiConfig.geminiApiKey)
      : null;

    return {
      openaiKey,
      geminiKey,
      usingUserKeys: !!(openaiKey || geminiKey)
    };
  } catch (error) {
    console.error('Error fetching user API keys:', error);
    return {
      openaiKey: null,
      geminiKey: null,
      usingUserKeys: false
    };
  }
};

// Helper to validate and get OpenAI client with user's key
const getUserOpenAI = async (userId) => {
  const apiKeys = await getUserApiKeysHelper(userId);
  if (!apiKeys.openaiKey) {
    throw new Error('MISSING_OPENAI_KEY');
  }
  return new OpenAI({ apiKey: apiKeys.openaiKey });
};

// Helper to validate and get Gemini client with user's key
const getUserGemini = async (userId) => {
  const apiKeys = await getUserApiKeysHelper(userId);
  if (!apiKeys.geminiKey) {
    throw new Error('MISSING_GEMINI_KEY');
  }
  return new GoogleGenAI({ apiKey: apiKeys.geminiKey });
};

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getUser(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check if user account is suspended or banned
    if (user.status === 'suspended') {
      return res.status(403).json({
        error: 'Account suspended',
        message: 'Your account has been suspended. Please contact support.'
      });
    }

    if (user.status === 'banned') {
      return res.status(403).json({
        error: 'Account banned',
        message: 'Your account has been permanently banned.'
      });
    }

    // Attach user with both id and userId for compatibility
    req.user = {
      ...user,
      userId: user.id,
      role: user.role || 'user', // Default to 'user' if not set
      status: user.status || 'active' // Default to 'active' if not set
    };
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// API Key authentication middleware for external apps
const authenticateApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required. Include X-API-Key header.' });
  }

  try {
    // Get API key data
    const keyInfo = await getApiKeyData(apiKey);

    if (!keyInfo) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    // Check if key is active
    if (!keyInfo.active) {
      return res.status(403).json({ error: 'API key has been revoked' });
    }

    // Update last used timestamp
    keyInfo.lastUsed = new Date().toISOString();
    keyInfo.requestCount = (keyInfo.requestCount || 0) + 1;
    await setApiKeyData(apiKey, keyInfo);

    req.apiKeyUser = keyInfo;
    req.user = { userId: keyInfo.userId };
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
};

// Web search helper function using DuckDuckGo
async function searchWeb(query) {
  try {
    const response = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    });

    // Extract snippets from HTML (simple extraction)
    const results = response.data.match(/<a class="result__snippet"[^>]*>([^<]+)<\/a>/g) || [];
    const snippets = results.slice(0, 3).map(r => r.replace(/<[^>]+>/g, '').trim());

    return snippets.length > 0 ? snippets.join('\n\n') : '';
  } catch (error) {
    console.error('Web search error:', error.message);
    return '';
  }
}

// Routes

// ============ AUTHENTICATION ROUTES ============

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with UUID (secure, non-predictable ID)
    const userId = uuidv4();
    const user = {
      id: userId,
      email,
      name,
      password: hashedPassword,
      createdAt: new Date().toISOString(),
      books: []
    };

    // Store user data
    await createUser(user);

    // Generate JWT token
    const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: false, // Set to false for HTTP, true when using HTTPS
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: 'user',
        tier: 'free',
        status: 'active',
        books: []
      },
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
// Helper function to log login attempts
async function logLoginAttempt(email, userId, success, failureReason, req) {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');

    await getPool().query(
      `INSERT INTO login_history (user_id, email, success, failure_reason, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, email, success, failureReason, ip, userAgent]
    );
  } catch (error) {
    console.error('Error logging login attempt:', error);
    // Don't fail the login if logging fails
  }
}

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    console.log('Login attempt for:', req.body?.email);
    const { email, password } = req.body;

    if (!email || !password) {
      console.log('Missing email or password');
      await logLoginAttempt(email, null, false, 'missing_credentials', req);
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Get user by email
    const user = await getUserByEmail(email);
    console.log('User found:', !!user);

    if (!user) {
      console.log('User not found for email:', email);
      await logLoginAttempt(email, null, false, 'user_not_found', req);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    console.log('Password valid:', validPassword);

    if (!validPassword) {
      await logLoginAttempt(email, user.id, false, 'invalid_password', req);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user is suspended or banned
    if (user.status === 'suspended' || user.status === 'banned') {
      await logLoginAttempt(email, user.id, false, `account_${user.status}`, req);
      return res.status(403).json({ error: `Account is ${user.status}` });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: false, // Set to false for HTTP, true when using HTTPS
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Log successful login
    await logLoginAttempt(email, user.id, true, null, req);

    console.log('Login successful for:', email);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role || 'user',
        tier: user.tier || 'free',
        status: user.status || 'active',
        books: user.books || []
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

// Get current user
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({
    user: {
      id: req.user.userId || req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role || 'user',
      tier: req.user.tier || 'free',
      status: req.user.status || 'active',
      books: req.user.books,
      createdAt: req.user.createdAt
    }
  });
});

// Request password reset
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Get user by email
    const user = await getUserByEmail(email);
    if (!user) {
      // Don't reveal if user exists
      return res.json({ message: 'If an account exists with this email, you will receive password reset instructions.' });
    }

    // Generate secure reset token with UUID
    const resetToken = uuidv4();

    // Store reset token in Redis with 1 hour expiration
    await setPasswordResetToken(resetToken, user.id, 3600);

    // In a real app, send this via email. For now, just return it
    console.log(`Password reset token for ${email}: ${resetToken}`);

    res.json({
      message: 'If an account exists with this email, you will receive password reset instructions.',
      // In production, send resetToken via email instead of API response
      ...(process.env.NODE_ENV === 'development' && { resetToken })
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// Reset password with token
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Get userId from reset token
    const userId = await getPasswordResetToken(token);
    if (!userId) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Get user data
    const user = await getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    const updatedUser = {
      ...user,
      password: hashedPassword
    };

    await updateUser(userId, updatedUser);

    // Delete reset token
    await deletePasswordResetToken(token);

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Change password (authenticated user)
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    // Get user data
    const user = await getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    const updatedUser = {
      ...user,
      password: hashedPassword
    };

    await updateUser(userId, updatedUser);

    console.log(`Password changed successfully for user ${user.email}`);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ============ ADMIN ROUTES (Protected) ============
// Note: All admin routes require authenticateToken + requireAdmin middleware

// Admin-specific rate limiter
const adminRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each admin to 100 requests per windowMs
  message: 'Too many admin requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `admin:${req.user?.id || req.ip}`
});

// Apply rate limiter to all admin routes
app.use('/api/admin', adminRateLimiter);

// Get all users (paginated with filters)
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      tier,
      status,
      search
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await UserRepository.findAll({
      limit: parseInt(limit),
      offset,
      tier,
      status,
      search
    });

    res.json({
      users: result.users.map(user => ({
        ...user,
        password_hash: undefined // Never send password hash
      })),
      pagination: {
        total: result.total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(result.total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user details by ID
app.get('/api/admin/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await UserRepository.findByIdWithSettings(req.params.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's books
    const books = await BookRepository.findByOwnerId(req.params.userId);

    res.json({
      ...user,
      password_hash: undefined,
      books
    });
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

// Update user tier
app.put('/api/admin/users/:userId/tier',
  authenticateToken,
  requireAdmin,
  preventSelfModification,
  async (req, res) => {
    try {
      const { tier } = req.body;

      if (!['free', 'basic', 'premium'].includes(tier)) {
        return res.status(400).json({ error: 'Invalid tier. Must be free, basic, or premium.' });
      }

      const updatedUser = await UserRepository.updateTier(
        req.params.userId,
        tier,
        req.user.id
      );

      res.json({
        message: 'User tier updated successfully',
        user: {
          ...updatedUser,
          password_hash: undefined
        }
      });
    } catch (error) {
      console.error('Error updating user tier:', error);
      res.status(500).json({ error: 'Failed to update user tier' });
    }
  }
);

// Update user status (suspend/ban/activate)
app.put('/api/admin/users/:userId/status',
  authenticateToken,
  requireAdmin,
  preventSelfModification,
  async (req, res) => {
    try {
      const { status, reason } = req.body;

      if (!['active', 'suspended', 'banned'].includes(status)) {
        return res.status(400).json({
          error: 'Invalid status. Must be active, suspended, or banned.'
        });
      }

      const updatedUser = await UserRepository.updateStatus(
        req.params.userId,
        status,
        req.user.id,
        reason
      );

      res.json({
        message: `User ${status === 'active' ? 'activated' : status} successfully`,
        user: {
          ...updatedUser,
          password_hash: undefined
        }
      });
    } catch (error) {
      console.error('Error updating user status:', error);
      res.status(500).json({ error: 'Failed to update user status' });
    }
  }
);

// Get system statistics
app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await UserRepository.getSystemStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching system stats:', error);
    res.status(500).json({ error: 'Failed to fetch system statistics' });
  }
});

// Get audit log
app.get('/api/admin/audit-log', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 100,
      adminId,
      targetUserId
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await UserRepository.getAuditLog({
      limit: parseInt(limit),
      offset,
      adminId,
      targetUserId
    });

    res.json({
      logs: result.logs,
      pagination: {
        total: result.total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(result.total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// Get login history (admin only)
app.get('/api/admin/login-history', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      userId,
      success,
      email
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    let query = `
      SELECT
        lh.*,
        u.name as user_name,
        u.email as user_email
      FROM login_history lh
      LEFT JOIN users u ON lh.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (userId) {
      query += ` AND lh.user_id = $${paramCount}`;
      params.push(userId);
      paramCount++;
    }

    if (success !== undefined) {
      query += ` AND lh.success = $${paramCount}`;
      params.push(success === 'true');
      paramCount++;
    }

    if (email) {
      query += ` AND lh.email ILIKE $${paramCount}`;
      params.push(`%${email}%`);
      paramCount++;
    }

    query += ` ORDER BY lh.login_at DESC`;

    // Get total count
    const countQuery = query.replace('lh.*, u.name as user_name, u.email as user_email', 'COUNT(*)');
    const countResult = await getPool().query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), offset);

    const result = await getPool().query(query, params);

    res.json({
      loginHistory: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching login history:', error);
    res.status(500).json({ error: 'Failed to fetch login history' });
  }
});

// Get login history for a specific user (admin only)
app.get('/api/admin/users/:userId/login-history', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20 } = req.query;

    const result = await getPool().query(
      `SELECT * FROM login_history
       WHERE user_id = $1
       ORDER BY login_at DESC
       LIMIT $2`,
      [userId, parseInt(limit)]
    );

    res.json({ loginHistory: result.rows });
  } catch (error) {
    console.error('Error fetching user login history:', error);
    res.status(500).json({ error: 'Failed to fetch login history' });
  }
});

// Delete user (admin only, soft delete)
app.delete('/api/admin/users/:userId',
  authenticateToken,
  requireAdmin,
  preventSelfModification,
  async (req, res) => {
    try {
      await UserRepository.delete(req.params.userId);

      // Log the action
      const { query } = await import('./db/postgres.js');
      await query(
        `INSERT INTO admin_audit_log (admin_id, action, target_user_id, changes)
         VALUES ($1, $2, $3, $4)`,
        [req.user.id, 'user_deleted', req.params.userId, JSON.stringify({})]
      );

      res.json({ message: 'User deleted successfully' });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  }
);

// ============ AI AGENT ROUTES (Protected) ============

// AI Book Generation Agent
app.post('/api/agent/create-book', authenticateToken, aiLimiter, checkAIQuota, checkBookQuota, async (req, res) => {
  try {
    const { description, options } = req.body;

    if (!description) {
      return res.status(400).json({ error: 'Story description is required' });
    }

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_OPENAI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your OpenAI API key in Profile > API Keys to generate books with AI.'
        });
      }
      throw error;
    }

    // Set response headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const orchestrator = new AIBookOrchestrator(redisClient, userOpenai);

    // Progress callback to send updates to client
    const onProgress = (progressData) => {
      res.write(`data: ${JSON.stringify(progressData)}\n\n`);
    };

    // Generate the book
    const result = await orchestrator.generateBook({
      description,
      options,
      onProgress,
    });

    // Increment AI counter after successful generation
    await incrementAICounter(req.user.userId);

    // Create book in database with UUID
    const bookId = uuidv4();
    const bookData = {
      ...result.bookData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerId: req.user.id,
      generatedByAI: true,
      // Ensure all required arrays/objects exist
      visuals: result.bookData.visuals || [],
      audioFiles: result.bookData.audioFiles || {},
      collaborators: result.bookData.collaborators || [],
    };

    console.log('Saving AI-generated book with data:', {
      bookId,
      hasVisuals: !!bookData.visuals,
      visualsLength: bookData.visuals?.length || 0,
      keys: Object.keys(bookData)
    });

    await updateBook(bookId, req.user.id, bookData);

    // Add book to user's book list
    const updatedUser = {
      ...req.user,
      books: [...(req.user.books || []), bookId],
    };
    await updateUser(req.user.id, updatedUser);

    // Send final result
    res.write(
      `data: ${JSON.stringify({
        stage: 'done',
        message: 'Book created successfully!',
        bookId,
        continuityReport: result.continuityReport,
      })}\n\n`
    );
    res.end();
  } catch (error) {
    console.error('AI book generation error:', error);
    res.write(
      `data: ${JSON.stringify({
        stage: 'error',
        message: error.message || 'Failed to generate book',
      })}\n\n`
    );
    res.end();
  }
});

// ============ BOOK ROUTES (Protected) ============

// Get all books for the authenticated user
app.get('/api/books', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const books = await getUserBooks(userId);

    // Map to frontend format
    const mappedBooks = books.map(book => ({
      id: book.id,
      title: book.title || book.bookTitle,
      updatedAt: book.updated_at || book.updatedAt
    }));

    res.json(mappedBooks);
  } catch (error) {
    console.error('Error fetching books:', error);
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

// Get a specific book
app.get('/api/books/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const book = await getBook(id);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // SECURITY: Check if user owns the book or is a collaborator
    const ownerId = book.owner_id || book.ownerId;
    const isOwner = ownerId === req.user.userId || ownerId === req.user.id;
    const isCollaborator = book.collaborators?.some(c => c.email === req.user.email);

    if (!isOwner && !isCollaborator) {
      return res.status(403).json({
        error: 'Not authorized to access this book',
        message: 'You must be the book owner or a collaborator to view this book.'
      });
    }

    // Enhanced debug logging to identify which field is undefined
    console.log('Book GET response - all array fields:', {
      chapters: { type: typeof book?.chapters, isArray: Array.isArray(book?.chapters), length: book?.chapters?.length },
      characters: { type: typeof book?.characters, isArray: Array.isArray(book?.characters), length: book?.characters?.length },
      locations: { type: typeof book?.locations, isArray: Array.isArray(book?.locations), length: book?.locations?.length },
      plotlines: { type: typeof book?.plotlines, isArray: Array.isArray(book?.plotlines), length: book?.plotlines?.length }
    });

    res.json(book);
  } catch (error) {
    console.error('Error fetching book:', error);
    res.status(500).json({ error: 'Failed to fetch book' });
  }
});

// Create a new book
app.post('/api/books', authenticateToken, checkBookQuota, async (req, res) => {
  try {
    const bookData = {
      owner_id: req.user.userId,
      title: req.body.bookTitle || req.body.title || 'Untitled',
      description: req.body.description || req.body.overview || '',
      genre: req.body.genre || '',
      target_audience: req.body.targetAudience || req.body.target_audience || '',
      characters: req.body.characters || [],
      locations: req.body.locations || [],
      plotlines: req.body.plotlines || [],
      world_building: req.body.worldBuilding || req.body.world_building || {},
      settings: req.body.settings || {},
      notes: req.body.notes || [],
      timelines: req.body.timelines || [],
      visuals: req.body.visuals || [],
      audio_files: req.body.audioFiles || {},
      comic_pages: req.body.comicPages || [],
      character_refs: req.body.characterRefs || {},
      animation_projects: req.body.animationProjects || [],
      metadata: req.body.metadata || {},
      chapters: req.body.chapters || [],
      status: req.body.status || 'draft'
    };

    const book = await createBook(bookData);

    // Update quota usage after successful book creation
    await updateQuotaUsage(req.user.userId);

    res.status(201).json(book);
  } catch (error) {
    console.error('Error creating book:', error);
    res.status(500).json({ error: 'Failed to create book' });
  }
});

// Update a book
app.put('/api/books/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await getBook(id);

    if (!existing) {
      // Create new book with the provided ID
      const bookData = {
        id: id,
        owner_id: req.user.userId,
        title: req.body.bookTitle || req.body.title || 'Untitled',
        description: req.body.description || req.body.overview || '',
        genre: req.body.genre || '',
        target_audience: req.body.targetAudience || req.body.target_audience || '',
        characters: req.body.characters || [],
        locations: req.body.locations || [],
        plotlines: req.body.plotlines || [],
        world_building: req.body.worldBuilding || req.body.world_building || {},
        settings: req.body.settings || {},
        notes: req.body.notes || [],
        timelines: req.body.timelines || [],
        visuals: req.body.visuals || [],
        audio_files: req.body.audioFiles || {},
        comic_pages: req.body.comicPages || [],
        character_refs: req.body.characterRefs || {},
        animation_projects: req.body.animationProjects || [],
        metadata: req.body.metadata || {},
        chapters: req.body.chapters || [],
        status: req.body.status || 'draft'
      };

      const book = await createBook(bookData);
      res.json(book);
    } else {
      // Update existing book

      // Check if user owns the book or is a collaborator
      const ownerId = existing.owner_id || existing.ownerId;
      const isOwner = ownerId === req.user.userId || ownerId === req.user.id;
      if (!isOwner) {
        const collaborator = existing.collaborators?.find(c => c.email === req.user.email);
        if (!collaborator || collaborator.role === 'viewer') {
          return res.status(403).json({ error: 'You do not have permission to edit this book' });
        }
      }

      // Map frontend fields to PostgreSQL fields
      const updates = {
        title: req.body.bookTitle || req.body.title,
        description: req.body.description || req.body.overview,
        genre: req.body.genre,
        target_audience: req.body.targetAudience || req.body.target_audience,
        characters: req.body.characters,
        locations: req.body.locations,
        plotlines: req.body.plotlines,
        world_building: req.body.worldBuilding || req.body.world_building,
        settings: req.body.settings,
        notes: req.body.notes,
        timelines: req.body.timelines,
        visuals: req.body.visuals,
        audio_files: req.body.audioFiles,
        comic_pages: req.body.comicPages,
        character_refs: req.body.characterRefs,
        animation_projects: req.body.animationProjects,
        metadata: req.body.metadata,
        chapters: req.body.chapters,  // Add chapters to be synced
        status: req.body.status,
        word_count: req.body.wordCount || req.body.word_count,
        chapter_count: req.body.chapterCount || req.body.chapter_count
      };

      // Remove undefined fields
      Object.keys(updates).forEach(key => {
        if (updates[key] === undefined) {
          delete updates[key];
        }
      });

      // Always use the current database version for optimistic locking
      const expectedVersion = existing.version;

      const book = await updateBook(id, req.user.userId, updates, expectedVersion);

      // Enhanced debug logging to identify which field is undefined
      console.log('Book PUT response - all array fields:', {
        chapters: { type: typeof book?.chapters, isArray: Array.isArray(book?.chapters), length: book?.chapters?.length },
        characters: { type: typeof book?.characters, isArray: Array.isArray(book?.characters), length: book?.characters?.length },
        locations: { type: typeof book?.locations, isArray: Array.isArray(book?.locations), length: book?.locations?.length },
        plotlines: { type: typeof book?.plotlines, isArray: Array.isArray(book?.plotlines), length: book?.plotlines?.length }
      });

      res.json(book);
    }
  } catch (error) {
    console.error('Error updating book:', error);
    res.status(500).json({ error: 'Failed to update book' });
  }
});

// Delete a book
app.delete('/api/books/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // SECURITY: Check if book exists and get ownership info
    const book = await getBook(id);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    

    // SECURITY: Verify ownership - only owner can delete
    if (book.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this book' });
    }

    // Delete the book
    await deleteBook(id, req.user.id);

    // Remove book from user's book list
    if (req.user.books && req.user.books.includes(id)) {
      const updatedBooks = req.user.books.filter(bookId => bookId !== id);
      const updatedUser = {
        ...req.user,
        books: updatedBooks
      };
      await updateUser(req.user.id, updatedUser);
    }

    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
    console.error('Error deleting book:', error);
    res.status(500).json({ error: 'Failed to delete book' });
  }
});

// AI Generation endpoint
app.post('/api/generate', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const { type, prompt, context, enableWebSearch } = req.body;

    if (!type || !prompt) {
      return res.status(400).json({ error: 'Type and prompt are required' });
    }

    // Build context string from book data
    let contextString = '';
    if (context) {
      if (context.bookTitle) {
        contextString += `\n\nBOOK CONTEXT:\nTitle: ${context.bookTitle}`;
      }
      if (context.overview) {
        contextString += `\nOverview: ${context.overview}`;
      }
      if (context.characters && context.characters.length > 0) {
        contextString += `\n\nExisting Characters: ${context.characters.map(c => c.name + (c.role ? ` (${c.role})` : '')).join(', ')}`;
      }
      if (context.locations && context.locations.length > 0) {
        contextString += `\n\nExisting Locations: ${context.locations.map(l => l.name + (l.type ? ` (${l.type})` : '')).join(', ')}`;
      }
      if (context.plotlines && context.plotlines.length > 0) {
        contextString += `\n\nExisting Plotlines: ${context.plotlines.map(p => p.title).join(', ')}`;
      }
    }

    // Perform web search if enabled or if prompt suggests research is needed
    let searchResults = '';
    const needsResearch = /research|real|historical|accurate|fact|about|information on/i.test(prompt);

    if (enableWebSearch || needsResearch) {
      console.log('Performing web search for:', prompt);
      searchResults = await searchWeb(prompt);
      if (searchResults) {
        contextString += `\n\nWEB SEARCH RESULTS:\n${searchResults}`;
      }
    }

    let systemPrompt = '';

    if (type === 'character') {
      systemPrompt = `You are helping a writer create fictional characters. Based on the user's description and the existing book context, generate detailed character information that fits naturally into the story world.

Make sure the characters feel consistent with the story's tone, setting, and existing characters.

${searchResults ? 'Web search results have been provided below to help with research and accuracy.' : ''}

If the request asks for MULTIPLE characters (e.g., "create characters for...", "make a character for each...", "generate all the..."), respond with an ARRAY of character objects.
If the request asks for ONE character, respond with a SINGLE character object.

For SINGLE character, respond ONLY with valid JSON in this exact format (no markdown, no backticks, nothing else):
{
  "name": "character full name",
  "role": "their role (e.g., Protagonist, Antagonist, Supporting Character, etc.)",
  "age": "age or age range",
  "gender": "gender identity",
  "skinColor": "skin tone/color description",
  "hairColor": "hair color and style",
  "eyeColor": "eye color",
  "height": "height description",
  "weight": "weight description",
  "build": "body build/physique",
  "background": "2-3 sentences about their history, upbringing, and formative experiences",
  "personality": "2-3 sentences describing their key personality traits",
  "arc": "2-3 sentences outlining their character development",
  "motivations": "what drives them, their goals",
  "fears": "their fears and vulnerabilities",
  "quirks": "unique mannerisms, habits, or characteristics"
}

For MULTIPLE characters, respond with an array like:
[
  { "name": "...", "role": "...", ... },
  { "name": "...", "role": "...", ... }
]`;
    } else if (type === 'location') {
      systemPrompt = `You are helping a writer create fictional locations. Based on the user's description and the existing book context, generate detailed location information that fits naturally into the story world.

Make sure the locations feel consistent with the story's setting and complement existing locations.

If the request asks for MULTIPLE locations (e.g., "create locations for...", "make a location for each...", "generate all the..."), respond with an ARRAY of location objects.
If the request asks for ONE location, respond with a SINGLE location object.

For SINGLE location, respond ONLY with valid JSON in this exact format (no markdown, no backticks, nothing else):
{
  "name": "location name",
  "type": "type (e.g., City, Village, Building, Forest, Planet, etc.)",
  "description": "3-4 sentences describing the location's appearance, layout, and key features",
  "significance": "why this location matters to the story",
  "atmosphere": "the mood, feel, and ambiance of the place",
  "history": "brief history or background of the location"
}

For MULTIPLE locations, respond with an array like:
[
  { "name": "...", "type": "...", ... },
  { "name": "...", "type": "...", ... }
]`;
    } else if (type === 'plotline') {
      systemPrompt = `You are helping a writer create plot threads for their story. Based on the user's description and the existing book context, generate detailed plotline information that fits with existing plot threads and characters.

Make sure the plotlines feel consistent with the story's themes and complement existing plotlines.

If the request asks for MULTIPLE plotlines (e.g., "create plotlines for...", "make a plotline for each...", "generate all the..."), respond with an ARRAY of plotline objects.
If the request asks for ONE plotline, respond with a SINGLE plotline object.

For SINGLE plotline, respond ONLY with valid JSON in this exact format (no markdown, no backticks, nothing else):
{
  "title": "plotline title",
  "type": "main, subplot, or backstory",
  "description": "3-4 sentences describing the plot thread and its progression",
  "themes": "themes explored in this plotline",
  "conflicts": "key conflicts and tensions in this plot thread"
}

For MULTIPLE plotlines, respond with an array like:
[
  { "title": "...", "type": "...", ... },
  { "title": "...", "type": "...", ... }
]`;
    } else if (type === 'chapter') {
      systemPrompt = `You are helping a writer create a chapter for their story. Based on the user's description and the existing book context, generate chapter content that features the story's characters and locations naturally.

Make sure the chapter feels consistent with the story's tone and world.

Respond ONLY with valid JSON in this exact format (no markdown, no backticks, nothing else):
{
  "title": "chapter title",
  "summary": "2-3 sentences summarizing what happens in this chapter",
  "content": "Write 3-4 paragraphs of actual chapter content based on the description"
}`;
    } else if (type === 'improve') {
      systemPrompt = `You are helping a writer improve existing content. Based on the user's request and the existing book context, suggest improvements.

Respond ONLY with valid JSON in this exact format (no markdown, no backticks, nothing else):
{
  "improved": "The improved version of the content",
  "explanation": "Brief explanation of what was changed and why"
}`;
    } else if (type === 'dialogue') {
      systemPrompt = `You are helping a writer create dialogue between characters. Based on the user's description and the existing book context, generate natural dialogue that fits each character's personality.

Respond ONLY with valid JSON in this exact format (no markdown, no backticks, nothing else):
{
  "dialogue": "The dialogue as a formatted conversation with character names and lines",
  "context": "Brief context about the scene and character dynamics"
}`;
    } else if (type === 'plot-analysis') {
      systemPrompt = `You are helping a writer analyze their story for plot holes and inconsistencies. Based on the existing book context, identify potential issues and suggest solutions.

Respond ONLY with valid JSON in this exact format (no markdown, no backticks, nothing else):
{
  "issues": ["Array of identified plot holes or inconsistencies"],
  "suggestions": ["Array of suggestions to fix or address each issue"],
  "strengths": ["Array of strong points in the current plot"]
}`;
    } else if (type === 'chapter-outline') {
      systemPrompt = `You are helping a writer create a chapter outline based on existing plotlines. Based on the user's request and the existing book context, generate a structured chapter outline.

Respond ONLY with valid JSON in this exact format (no markdown, no backticks, nothing else):
{
  "title": "Suggested chapter title",
  "number": "Suggested chapter number or placement",
  "summary": "2-3 sentence summary of the chapter",
  "scenes": ["Array of 3-5 scene descriptions for this chapter"],
  "characters": ["Array of characters that should appear"],
  "locations": ["Array of locations featured"]
}`;
    } else if (type === 'character-arc') {
      systemPrompt = `You are helping a writer develop or improve a character arc. Based on the user's request and the existing book context, suggest improvements to character development.

Respond ONLY with valid JSON in this exact format (no markdown, no backticks, nothing else):
{
  "arc": "Improved character arc description",
  "keyMoments": ["Array of 3-5 key moments in the character's journey"],
  "growth": "Description of how the character grows and changes",
  "relationships": "How this character's relationships evolve"
}`;
    } else if (type === 'relationship-map') {
      systemPrompt = `You are helping a writer map character relationships. Based on the existing characters in the book, analyze and describe their relationships.

Respond ONLY with valid JSON in this exact format (no markdown, no backticks, nothing else):
{
  "relationships": [
    {
      "character1": "Character name",
      "character2": "Character name",
      "relationship": "Type of relationship (e.g., allies, rivals, family, romantic)",
      "description": "Brief description of their dynamic"
    }
  ],
  "dynamics": "Overall assessment of character dynamics in the story"
}`;
    } else if (type === 'timeline') {
      systemPrompt = `You are helping a writer create a scene-based timeline for their story. Based on the chapters and book context provided, break down the story into individual SCENES (not full chapters).

IMPORTANT: Think in terms of SCENES within chapters, not entire chapters as single events.
- A scene is a single continuous action in one location/time
- Multiple scenes can happen within one chapter
- Group scenes that belong to the same chapter using the "chapterHint" field
- Only create new chapter breaks when there's a significant story shift (time jump, location change, POV shift, etc.)

Analyze all chapters and create scene-based timeline events:
- Individual scenes within chapters (e.g., "Characters discuss plan", "Action sequence begins", "Emotional confrontation")
- Major story shifts that warrant new chapters
- Character introductions and development moments
- Location changes
- Conflicts and resolutions

For parallel plotlines, use the "branch" field.

Respond ONLY with valid JSON array in this exact format (no markdown, no backticks, nothing else):
[
  {
    "event": "Brief scene title",
    "sceneType": "action, dialogue, exposition, or transition",
    "chapterHint": "Suggested chapter grouping (e.g., 'Chapter 1: The Fort Building', 'Chapter 2: New Adventure')",
    "date": "Time reference",
    "location": "Where this scene occurs",
    "description": "2-3 sentences describing what happens in this scene",
    "branch": "main, subplot-A, subplot-B, or backstory"
  }
]`;
    } else if (type === 'transcript') {
      systemPrompt = `You are helping convert a written chapter into a movie-style animation transcript. Based on the chapter content and book context, create a professional screenplay format transcript.

Include:
- Scene headings (INT./EXT. LOCATION - TIME OF DAY)
- Action lines (visual descriptions)
- Character dialogue with names
- Camera directions when relevant
- Transitions between scenes
- Sound effects and music cues in parentheses

Format for animation production with clear, actionable direction.

Respond ONLY with valid JSON in this exact format (no markdown, no backticks, nothing else):
{
  "title": "Episode/Chapter title",
  "sceneCount": number,
  "estimatedDuration": "e.g., 7-10 minutes",
  "transcript": "Full screenplay-formatted transcript with proper scene headings, action lines, and dialogue"
}`;
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    // Get user's OpenAI client (validates key exists)
    const userOpenai = await getUserOpenAI(req.user.userId);

    const completion = await userOpenai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt + contextString }
      ],
      temperature: 0.8,
      max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 16384,
    });

    const responseText = completion.choices[0].message.content;

    // Clean the response
    const cleanedText = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const generatedData = JSON.parse(cleanedText);

    res.json(generatedData);
  } catch (error) {
    console.error('Error generating content:', error);

    if (error.message === 'MISSING_OPENAI_KEY') {
      return res.status(403).json({
        error: 'API key required',
        message: 'Please add your OpenAI API key in Profile > API Keys to use AI features.'
      });
    }

    res.status(500).json({ error: 'Failed to generate content', details: error.message });
  }
});

// ==================== BACKGROUND JOB GENERATION ENDPOINTS ====================

// Queue image generation job
app.post('/api/jobs/queue/image', authenticateToken, aiLimiter, checkJobQuota, requireFeature('media_generation'), async (req, res) => {
  try {
    const { bookId, imageType, itemId, prompt, context } = req.body;

    if (!prompt || !bookId || !imageType) {
      return res.status(400).json({ error: 'bookId, imageType, and prompt are required' });
    }

    const jobId = await queueImageGeneration(
      req.user.userId,
      bookId,
      imageType,
      itemId,
      prompt,
      context
    );

    res.json({ jobId, message: 'Image generation queued' });
  } catch (error) {
    console.error('Queue image error:', error);
    res.status(500).json({ error: error.message || 'Failed to queue image generation' });
  }
});

// Queue audio generation job
app.post('/api/jobs/queue/audio', authenticateToken, aiLimiter, checkJobQuota, requireFeature('media_generation'), async (req, res) => {
  try {
    const { bookId, chapterId, text, voice } = req.body;

    if (!bookId || !chapterId || !text) {
      return res.status(400).json({ error: 'bookId, chapterId, and text are required' });
    }

    const jobId = await queueAudioGeneration(
      req.user.userId,
      bookId,
      chapterId,
      text,
      voice
    );

    res.json({ jobId, message: 'Audio generation queued' });
  } catch (error) {
    console.error('Queue audio error:', error);
    res.status(500).json({ error: error.message || 'Failed to queue audio generation' });
  }
});

// Queue content generation job
app.post('/api/jobs/queue/content', authenticateToken, aiLimiter, checkJobQuota, checkAIQuota, async (req, res) => {
  try {
    const { bookId, contentType, itemId, config } = req.body;

    if (!bookId || !contentType) {
      return res.status(400).json({ error: 'bookId and contentType are required' });
    }

    const jobId = await queueContentGeneration(
      req.user.userId,
      bookId,
      contentType,
      itemId,
      config
    );

    res.json({ jobId, message: `${contentType} generation queued` });
  } catch (error) {
    console.error('Queue content error:', error);
    res.status(500).json({ error: error.message || 'Failed to queue content generation' });
  }
});

// Queue import analysis job
app.post('/api/jobs/queue/import', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const { bookId, chapterIndex, chapter } = req.body;

    if (!bookId || chapterIndex === undefined || !chapter) {
      return res.status(400).json({ error: 'bookId, chapterIndex, and chapter are required' });
    }

    const jobId = await queueImportAnalysis(
      req.user.userId,
      bookId,
      chapterIndex,
      chapter
    );

    res.json({ jobId, message: 'Import analysis queued' });
  } catch (error) {
    console.error('Queue import error:', error);
    res.status(500).json({ error: error.message || 'Failed to queue import analysis' });
  }
});

// Queue video generation job
app.post('/api/jobs/queue/video', authenticateToken, aiLimiter, checkJobQuota, requireFeature('media_generation'), async (req, res) => {
  try {
    const { bookId, transcriptId, config } = req.body;

    if (!bookId || !transcriptId) {
      return res.status(400).json({ error: 'bookId and transcriptId are required' });
    }

    const jobId = await queueVideoGeneration(
      req.user.userId,
      bookId,
      transcriptId,
      config
    );

    res.json({ jobId, message: 'Video generation queued' });
  } catch (error) {
    console.error('Queue video error:', error);
    res.status(500).json({ error: error.message || 'Failed to queue video generation' });
  }
});

// Check if user can queue more jobs
app.get('/api/jobs/can-queue', authenticateToken, async (req, res) => {
  try {
    const status = await canQueueJob(req.user.userId);
    res.json(status);
  } catch (error) {
    console.error('Can queue error:', error);
    res.status(500).json({ error: 'Failed to check job status' });
  }
});

// ==================== LEGACY SYNCHRONOUS ENDPOINTS (kept for backward compatibility) ====================

// Image Generation endpoint using OpenAI DALL-E
app.post('/api/generate-image', authenticateToken, aiLimiter, requireMinIO, async (req, res) => {
  try {
    const { prompt, context } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Get user's OpenAI client (validates key exists)
    const userOpenai = await getUserOpenAI(req.user.userId);

    // Step 1: Optionally enhance the prompt with book context
    let enhancedPrompt = prompt;

    if (context) {
      console.log('Preprocessing image prompt with book context...');

      let contextString = '';
      if (context.bookTitle) contextString += `Book: ${context.bookTitle}\n`;
      if (context.overview) contextString += `Story: ${context.overview}\n`;
      if (context.characters && context.characters.length > 0) {
        contextString += `Characters: ${context.characters.map(c => `${c.name}${c.role ? ` (${c.role})` : ''}`).join(', ')}\n`;
      }
      if (context.locations && context.locations.length > 0) {
        contextString += `Locations: ${context.locations.map(l => l.name).join(', ')}\n`;
      }

      const promptEnhancement = await userOpenai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are helping enhance image generation prompts for DALL-E. Given a user's basic image request and their book context, create a detailed, vivid image prompt that incorporates relevant context details.

Your enhanced prompt should be clear, descriptive, and optimized for DALL-E image generation. Include:
- Visual details (colors, lighting, composition)
- Style references if appropriate
- Relevant context from the book (character appearances, location details, atmosphere)

Keep the prompt under 1000 characters. Respond with ONLY the enhanced prompt text, nothing else.`
          },
          {
            role: 'user',
            content: `Book Context:\n${contextString}\n\nUser's Image Request: ${prompt}\n\nCreate an enhanced image generation prompt:`
          }
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      enhancedPrompt = promptEnhancement.choices[0].message.content.trim();
      console.log('Enhanced prompt:', enhancedPrompt);
    }

    // Step 2: Generate image with DALL-E 3
    console.log('Generating image with DALL-E 3...');

    const response = await userOpenai.images.generate({
      model: 'dall-e-3',
      prompt: enhancedPrompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      response_format: 'b64_json'
    });

    // Extract image data from response
    const imageData = response.data[0].b64_json;
    const buffer = Buffer.from(imageData, 'base64');

    // Upload to MinIO
    const filename = `visual-${Date.now()}.png`;
    const uploadResult = await mediaStorage.upload('images', buffer, filename, {
      'x-amz-meta-type': 'generated-visual',
      'x-amz-meta-prompt': (prompt || '').substring(0, 200),
      // Note: No bookId for standalone image generation - backward compatibility only
    }, setMediaBookMapping);

    console.log('Image saved to MinIO:', uploadResult.storageKey);

    // Return storage key and proxy URL (portable across devices)
    res.json({
      imageUrl: `/api/media/images/${filename}`,
      filename,
      storageKey: uploadResult.storageKey,
      bucket: uploadResult.bucket,
    });
  } catch (error) {
    console.error('Error generating image:', error);

    if (error.message === 'MISSING_OPENAI_KEY') {
      return res.status(403).json({
        error: 'API key required',
        message: 'Please add your OpenAI API key in Profile > API Keys to use AI features.'
      });
    }

    res.status(500).json({ error: 'Failed to generate image', details: error.message });
  }
});

// Serve static images
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'images')));

// Serve static audio files
const audioDir = path.join(__dirname, '..', 'public', 'audio');
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}
app.use('/audio', express.static(audioDir));

// Serve static comic files
const comicDir = path.join(__dirname, '..', 'public', 'comics');
if (!fs.existsSync(comicDir)) {
  fs.mkdirSync(comicDir, { recursive: true });
}
app.use('/comics', express.static(comicDir));

// ============ COMIC GENERATION ROUTES ============

// Parse transcript into comic panels
app.post('/api/parse-transcript-to-comic', authenticateToken, async (req, res) => {
  try {
    const { transcript, chapterTitle } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_OPENAI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your OpenAI API key in Profile > API Keys to parse transcripts.'
        });
      }
      throw error;
    }

    console.log('Parsing transcript to comic format...');

    const systemPrompt = `You are a comic book adapter. Parse the movie/animation transcript into comic book panels.

Analyze the transcript and break it down into visual comic panels. Each panel should represent a distinct visual moment.

Guidelines:
- Identify scene changes, dialogue exchanges, and action moments
- Group related dialogue into single panels when appropriate
- Keep dramatic moments as separate panels
- Extract character names from dialogue
- Describe what should be visually shown in each panel
- Capture the dialogue/captions for each panel

Return JSON array of panels:
[
  {
    "sceneDescription": "Visual description of what's shown in the panel (action, setting, character positions)",
    "dialogue": "Character dialogue or narration text for this panel",
    "characterNames": ["Character names appearing in this panel"],
    "location": "Location/setting name if identifiable",
    "panelType": "action|dialogue|establishing|closeup|wide"
  }
]

Aim for 6-12 panels per page worth of content.`;

    const completion = await userOpenai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Transcript:\n\n${transcript}` }
      ],
      temperature: 0.5,
      max_tokens: 6000,
    });

    const responseText = completion.choices[0].message.content;
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const panels = JSON.parse(cleaned);

    res.json({
      success: true,
      panels,
      chapterTitle: chapterTitle || 'Untitled'
    });
  } catch (error) {
    console.error('Transcript parsing error:', error);
    res.status(500).json({ error: 'Failed to parse transcript', details: error.message });
  }
});

// Generate character reference image for consistent comic panels
app.post('/api/generate-character-reference', authenticateToken, requireMinIO, async (req, res) => {
  try {
    const { characterId, character, style = 'comic book art' } = req.body;

    if (!character || !character.name) {
      return res.status(400).json({ error: 'Character data is required' });
    }

    // Get user's Gemini client (validates key exists)
    let userGenai;
    try {
      userGenai = await getUserGemini(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_GEMINI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your Google Gemini API key in Profile > API Keys to generate character references.'
        });
      }
      throw error;
    }

    console.log(`Generating reference image for character: ${character.name}`);

    // Build detailed character description
    const characterPrompt = `${style}, character reference sheet, multiple angles, full body portrait of ${character.name}, ${character.age} years old, ${character.gender}, ${character.skinColor} skin, ${character.hairColor} hair, ${character.eyeColor} eyes, ${character.height}, ${character.build} build, ${character.personality}. Character design reference, turnaround, consistent character design, professional comic book style`;

    const response = await userGenai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: characterPrompt,
    });

    // Extract image data
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const imageData = part.inlineData.data;
        const buffer = Buffer.from(imageData, 'base64');

        const filename = `character-ref-${characterId || Date.now()}.png`;
        const uploadResult = await mediaStorage.upload('comics', buffer, filename, {
          'x-amz-meta-type': 'character-reference',
          'x-amz-meta-character-id': String(characterId || ''),
        });

        console.log('Character reference saved to MinIO:', uploadResult.storageKey);

        res.json({
          imageUrl: `/api/media/comics/${filename}`,
          filename,
          characterId,
          storageKey: uploadResult.storageKey,
          bucket: uploadResult.bucket,
        });
        return;
      }
    }

    res.status(500).json({ error: 'No image generated' });
  } catch (error) {
    console.error('Character reference generation error:', error);
    res.status(500).json({ error: 'Failed to generate character reference', details: error.message });
  }
});

// Generate comic panel/scene image with character references
app.post('/api/generate-comic-panel', authenticateToken, requireMinIO, async (req, res) => {
  try {
    const { sceneDescription, characters, location, style = 'comic book art, dynamic composition' } = req.body;

    if (!sceneDescription) {
      return res.status(400).json({ error: 'Scene description is required' });
    }

    // Get user's Gemini client (validates key exists)
    let userGenai;
    try {
      userGenai = await getUserGemini(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_GEMINI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your Google Gemini API key in Profile > API Keys to generate comic panels.'
        });
      }
      throw error;
    }

    console.log('Generating comic panel...');

    // Build comprehensive scene prompt
    let promptParts = [style];

    if (characters && characters.length > 0) {
      const characterDescriptions = characters.map(char =>
        `${char.name} (${char.age} year old ${char.gender} with ${char.skinColor} skin, ${char.hairColor} hair, ${char.eyeColor} eyes, ${char.build} build)`
      ).join(', ');
      promptParts.push(`featuring ${characterDescriptions}`);
    }

    if (location) {
      promptParts.push(`in ${location.name}: ${location.description}`);
    }

    promptParts.push(sceneDescription);
    promptParts.push('dramatic lighting, professional comic book illustration, detailed background');

    const fullPrompt = promptParts.join(', ');

    console.log('Comic panel prompt:', fullPrompt.substring(0, 200) + '...');

    const response = await userGenai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: fullPrompt,
    });

    // Extract image data
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const imageData = part.inlineData.data;
        const buffer = Buffer.from(imageData, 'base64');

        const filename = `comic-panel-${Date.now()}.png`;
        const uploadResult = await mediaStorage.upload('comics', buffer, filename, {
          'x-amz-meta-type': 'comic-panel',
        });

        console.log('Comic panel saved to MinIO:', uploadResult.storageKey);

        res.json({
          imageUrl: `/api/media/comics/${filename}`,
          filename,
          storageKey: uploadResult.storageKey,
          bucket: uploadResult.bucket,
        });
        return;
      }
    }

    res.status(500).json({ error: 'No image generated' });
  } catch (error) {
    console.error('Comic panel generation error:', error);
    res.status(500).json({ error: 'Failed to generate comic panel', details: error.message });
  }
});

// ============ TTS/AUDIOBOOK ROUTES ============

// Helper function to chunk text for TTS (OpenAI TTS has 4096 char limit)
function chunkText(text, maxLength = 4000) {
  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= maxLength) {
      currentChunk += sentence;
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());

  return chunks;
}

// Generate TTS audio for a chapter
app.post('/api/generate-audio', authenticateToken, aiLimiter, requireMinIO, async (req, res) => {
  try {
    const { text, chapterId, voice = 'alloy', speed = 1.0 } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // OpenAI TTS supports: alloy, echo, fable, onyx, nova, shimmer
    const validVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
    const selectedVoice = validVoices.includes(voice) ? voice : 'alloy';

    console.log(`Generating TTS audio with voice: ${selectedVoice}, speed: ${speed}, text length: ${text.length}`);

    // Get user's OpenAI client (validates key exists)
    const userOpenai = await getUserOpenAI(req.user.userId);

    // Check if text needs chunking
    const chunks = text.length > 4000 ? chunkText(text) : [text];
    console.log(`Processing ${chunks.length} chunk(s)`);

    const audioBuffers = [];

    for (let i = 0; i < chunks.length; i++) {
      console.log(`Generating chunk ${i + 1}/${chunks.length}`);

      try {
        const mp3 = await userOpenai.audio.speech.create({
          model: 'tts-1', // or 'tts-1-hd' for higher quality
          voice: selectedVoice,
          input: chunks[i],
          speed: speed, // 0.25 to 4.0
        });

        const buffer = Buffer.from(await mp3.arrayBuffer());
        audioBuffers.push(buffer);
      } catch (chunkError) {
        console.error(`Error generating chunk ${i + 1}:`, chunkError);
        throw new Error(`Failed to generate audio chunk ${i + 1}: ${chunkError.message}`);
      }
    }

    // Combine audio buffers if multiple chunks
    const finalBuffer = audioBuffers.length > 1
      ? Buffer.concat(audioBuffers)
      : audioBuffers[0];

    // Upload to MinIO
    const filename = `chapter-${chapterId || Date.now()}-${selectedVoice}.mp3`;
    const uploadResult = await mediaStorage.upload('audio', finalBuffer, filename, {
      'x-amz-meta-type': 'tts-audio',
      'x-amz-meta-voice': selectedVoice,
      'x-amz-meta-chapter-id': String(chapterId || ''),
    });

    console.log('Audio saved to MinIO:', uploadResult.storageKey);

    res.json({
      audioUrl: `/api/media/audio/${filename}`,
      filename,
      voice: selectedVoice,
      duration: null,
      storageKey: uploadResult.storageKey,
      bucket: uploadResult.bucket,
    });
  } catch (error) {
    console.error('TTS generation error:', error);
    console.error('Error stack:', error.stack);

    if (error.message === 'MISSING_OPENAI_KEY') {
      return res.status(403).json({
        error: 'API key required',
        message: 'Please add your OpenAI API key in Profile > API Keys to generate audio.'
      });
    }

    res.status(500).json({
      error: 'Failed to generate audio',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Generate audiobook for entire book (batch)
app.post('/api/generate-audiobook', authenticateToken, async (req, res) => {
  try {
    const { chapters, voice = 'alloy', speed = 1.0 } = req.body;

    if (!chapters || !Array.isArray(chapters)) {
      return res.status(400).json({ error: 'Chapters array is required' });
    }

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_OPENAI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your OpenAI API key in Profile > API Keys to generate audiobooks.'
        });
      }
      throw error;
    }

    const audioFiles = [];

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];

      if (!chapter.content) {
        console.log(`Skipping chapter ${i + 1}: No content`);
        continue;
      }

      console.log(`Generating audio for chapter ${i + 1}/${chapters.length}`);

      const mp3 = await userOpenai.audio.speech.create({
        model: 'tts-1',
        voice: voice,
        input: `Chapter ${chapter.number || i + 1}: ${chapter.title}.\n\n${chapter.content}`,
        speed: speed,
      });

      const buffer = Buffer.from(await mp3.arrayBuffer());
      const filename = `chapter-${chapter.number || i + 1}-${voice}.mp3`;

      const uploadResult = await mediaStorage.upload('audio', buffer, filename, {
        'x-amz-meta-type': 'audiobook',
        'x-amz-meta-chapter': String(chapter.number || i + 1),
        'x-amz-meta-voice': voice,
      });

      audioFiles.push({
        chapterNumber: chapter.number || i + 1,
        chapterTitle: chapter.title,
        audioUrl: `/api/media/audio/${filename}`,
        filename,
        storageKey: uploadResult.storageKey,
        bucket: uploadResult.bucket,
      });
    }

    res.json({
      success: true,
      audioFiles,
      voice,
      speed,
    });
  } catch (error) {
    console.error('Audiobook generation error:', error);
    res.status(500).json({ error: 'Failed to generate audiobook', details: error.message });
  }
});

// Comprehensive health check
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {},
  };

  let isHealthy = true;

  // Check Redis
  try {
    await redisClient.ping();
    health.services.redis = { status: 'connected', host: process.env.REDIS_HOST, port: process.env.REDIS_PORT };
  } catch (error) {
    health.services.redis = { status: 'disconnected', error: error.message };
    isHealthy = false;
  }

  // Check MinIO
  try {
    if (minioAvailable) {
      await mediaStorage.client.listBuckets();
      health.services.minio = { status: 'connected', endpoint: process.env.MINIO_ENDPOINT };
    } else {
      health.services.minio = { status: 'unavailable' };
    }
  } catch (error) {
    health.services.minio = { status: 'error', error: error.message };
  }

  // Check API Keys
  health.services.apiKeys = {
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
  };

  // Overall status
  health.status = isHealthy ? 'healthy' : 'degraded';

  res.status(isHealthy ? 200 : 503).json(health);
});

// Generate EPUB
app.post('/api/generate-epub', authenticateToken, async (req, res) => {
  try {
    const { title, author, publisher, description, cover, content } = req.body;

    if (!content || content.length === 0) {
      return res.status(400).json({ error: 'No chapters provided for EPUB generation' });
    }

    const option = {
      title: title || 'Untitled Book',
      author: author || 'Unknown Author',
      publisher: publisher || 'Fiction Writing Studio',
      description: description || '',
      cover: cover || undefined,
      content: content
    };

    // epub-gen-memory returns a promise directly
    const epubBuffer = await epub(option);

    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${(title || 'book').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.epub"`);
    res.send(Buffer.from(epubBuffer));
  } catch (error) {
    console.error('EPUB generation error:', error);
    res.status(500).json({ error: 'Failed to generate EPUB', details: error.message });
  }
});

// Analyze story continuity
app.post('/api/analyze-continuity', authenticateToken, async (req, res) => {
  try {
    const { bookData } = req.body;

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_OPENAI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your OpenAI API key in Profile > API Keys to use AI continuity analysis.'
        });
      }
      throw error;
    }

    const systemPrompt = `You are an expert story editor analyzing a book for consistency, continuity, and quality issues. Analyze the provided book data and identify:
1. Timeline conflicts and chronological inconsistencies
2. Character inconsistencies (behavior, traits, development)
3. Plot holes and unresolved storylines
4. Location/setting inconsistencies
5. Style and tone inconsistencies across chapters

Return a JSON object with this structure:
{
  "summary": {
    "passed": number,
    "warnings": number,
    "critical": number,
    "score": number (0-100)
  },
  "issues": [
    {
      "title": "Brief title",
      "description": "Detailed description",
      "category": "timeline|character|location|plot|style",
      "severity": "critical|warning|info",
      "location": "Where in the story (e.g., Chapter 3, Character: John)",
      "suggestion": "How to fix it"
    }
  ]
}`;

    const userPrompt = `Analyze this book for continuity issues:

Title: ${bookData.bookTitle}
Overview: ${bookData.overview}

Characters: ${JSON.stringify(bookData.characters, null, 2)}

Locations: ${JSON.stringify(bookData.locations, null, 2)}

Plotlines: ${JSON.stringify(bookData.plotlines, null, 2)}

Timeline: ${JSON.stringify(bookData.timelines, null, 2)}

Chapters: ${bookData.chapters.map(ch => `Chapter ${ch.number}: ${ch.title}\n${ch.summary || ''}\n${(ch.content || '').substring(0, 500)}...`).join('\n\n')}

Provide a thorough analysis with specific, actionable issues.`;

    const completion = await userOpenai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    const analysisText = completion.choices[0].message.content;
    const analysis = JSON.parse(analysisText);

    res.json(analysis);
  } catch (error) {
    console.error('Continuity analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze continuity', details: error.message });
  }
});

// ============ BOOK IMPORT ROUTES (Protected) ============

// Upload and parse book file
app.post('/api/books/import/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, filename, path: filePath } = req.file;
    const ext = path.extname(originalname).toLowerCase();

    console.log(`Parsing uploaded file: ${originalname} (${ext})`);

    // Parse file based on extension
    let rawText = '';
    try {
      switch (ext) {
        case '.epub':
          rawText = await parseEPUB(filePath);
          break;
        case '.pdf':
          rawText = await parsePDF(filePath);
          break;
        case '.docx':
          rawText = await parseDOCX(filePath);
          break;
        case '.txt':
          rawText = await parseTXT(filePath);
          break;
        default:
          throw new Error('Unsupported file type');
      }
    } catch (parseError) {
      // Clean up file
      fs.unlinkSync(filePath);
      throw parseError;
    }

    if (!rawText || rawText.length < 100) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Failed to extract text from file or file is too short' });
    }

    // Create import record with UUID
    const importId = `import-${uuidv4()}`;
    const importData = {
      id: importId,
      userId: req.user.id,
      filename: originalname,
      fileType: ext.substring(1),
      uploadedAt: new Date().toISOString(),
      status: 'uploaded',
      rawText,
      rawTextLength: rawText.length,
      filePath, // Keep for potential re-parsing
    };

    await setImportData(importId, importData);

    res.json({
      importId,
      filename: originalname,
      fileType: ext.substring(1),
      textLength: rawText.length,
      status: 'uploaded',
    });
  } catch (error) {
    console.error('File upload error:', error);
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Failed to clean up file:', unlinkError);
      }
    }
    res.status(500).json({ error: 'Failed to upload and parse file', details: error.message });
  }
});

// Extract chapters from uploaded book
app.post('/api/books/import/:importId/extract', authenticateToken, async (req, res) => {
  try {
    const { importId } = req.params;
    const { minChapterLength, maxChapterLength, useAI } = req.body;

    const importData = await getImportData(importId);
    if (!importData) {
      return res.status(404).json({ error: 'Import not found' });
    }

    const importRecord = importData;

    // Verify user owns this import
    if (importRecord.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const method = useAI ? 'AI-powered' : 'Pattern-based';
    console.log(`Extracting chapters from import ${importId} using ${method} detection...`);

    let chapters, stats;

    if (useAI) {
      // Use AI to detect chapter boundaries
      const detector = new AIChapterDetector();
      const rawChapters = await detector.extractChapters(importRecord.rawText);
      chapters = validateChapters(rawChapters);
      stats = getChapterStats(chapters);
      stats.detectionMethod = 'ai';
    } else {
      // Use pattern matching
      const rawChapters = extractChapters(importRecord.rawText, {
        minChapterLength: minChapterLength || 500,
        maxChapterLength: maxChapterLength || 100000,
        detectTitle: true,
      });
      chapters = validateChapters(rawChapters);
      stats = getChapterStats(chapters);
      stats.detectionMethod = 'pattern';
    }

    // Update import record
    importRecord.status = 'extracted';
    importRecord.chapters = chapters;
    importRecord.chapterStats = stats;
    importRecord.extractedAt = new Date().toISOString();
    importRecord.detectionMethod = useAI ? 'ai' : 'pattern';

    await setImportData(importId, importRecord);

    res.json({
      importId,
      chapters,
      stats,
      detectionMethod: importRecord.detectionMethod,
    });
  } catch (error) {
    console.error('Chapter extraction error:', error);
    res.status(500).json({ error: 'Failed to extract chapters', details: error.message });
  }
});

// Update chapters after manual review
app.put('/api/books/import/:importId/chapters', authenticateToken, async (req, res) => {
  try {
    const { importId } = req.params;
    const { chapters } = req.body;

    if (!chapters || !Array.isArray(chapters)) {
      return res.status(400).json({ error: 'Chapters array is required' });
    }

    const importData = await getImportData(importId);
    if (!importData) {
      return res.status(404).json({ error: 'Import not found' });
    }

    const importRecord = importData;

    // Verify user owns this import
    if (importRecord.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update chapters and recalculate stats
    const validatedChapters = validateChapters(chapters);
    const stats = getChapterStats(validatedChapters);

    importRecord.chapters = validatedChapters;
    importRecord.chapterStats = stats;
    importRecord.status = 'reviewed';
    importRecord.reviewedAt = new Date().toISOString();

    await setImportData(importId, importRecord);

    res.json({
      success: true,
      chapters: validatedChapters,
      stats,
    });
  } catch (error) {
    console.error('Chapter update error:', error);
    res.status(500).json({ error: 'Failed to update chapters', details: error.message });
  }
});

// Create book from import (convert to regular book)
app.post('/api/books/import/:importId/create-book', authenticateToken, async (req, res) => {
  try {
    const { importId } = req.params;
    const { bookTitle, overview } = req.body;

    const importData = await getImportData(importId);
    if (!importData) {
      return res.status(404).json({ error: 'Import not found' });
    }

    const importRecord = importData;

    // Verify user owns this import
    if (importRecord.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!importRecord.chapters || importRecord.chapters.length === 0) {
      return res.status(400).json({ error: 'No chapters extracted yet' });
    }

    // Create book from import with UUID
    const bookId = uuidv4();
    const bookData = {
      bookTitle: bookTitle || importRecord.filename.replace(/\.[^/.]+$/, ''),
      overview: overview || '',
      characters: [],
      locations: [],
      plotlines: [],
      timelines: [],
      chapters: importRecord.chapters.map((ch, idx) => ({
        id: uuidv4(), // Generate UUID for each chapter
        number: ch.number || idx + 1,
        title: ch.title,
        content: ch.content,
        wordCount: ch.wordCount,
        summary: '', // Will be generated in analysis phase
      })),
      notes: [],
      transcripts: [],
      relationships: [],
      visuals: [],
      audioFiles: {},
      collaborators: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerId: req.user.id,
      importedFrom: {
        importId,
        filename: importRecord.filename,
        fileType: importRecord.fileType,
        importedAt: new Date().toISOString(),
      },
      importAnalysis: {
        status: 'pending',
        analyzedChapters: 0,
        totalChapters: importRecord.chapters.length,
      },
    };

    await updateBook(bookId, req.user.id, bookData);

    // Add book to user's book list
    const updatedUser = {
      ...req.user,
      books: [...(req.user.books || []), bookId],
    };
    await updateUser(req.user.id, updatedUser);

    // Update import record
    importRecord.bookId = bookId;
    importRecord.status = 'completed';
    await setImportData(importId, importRecord);

    res.json({
      success: true,
      bookId,
      bookTitle: bookData.bookTitle,
      chapterCount: bookData.chapters.length,
    });
  } catch (error) {
    console.error('Book creation error:', error);
    res.status(500).json({ error: 'Failed to create book from import', details: error.message });
  }
});

// Get import status
app.get('/api/books/import/:importId/status', authenticateToken, async (req, res) => {
  try {
    const { importId } = req.params;

    const importData = await getImportData(importId);
    if (!importData) {
      return res.status(404).json({ error: 'Import not found' });
    }

    const importRecord = importData;

    // Verify user owns this import
    if (importRecord.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Return status without full text/chapters (lighter response)
    res.json({
      importId: importRecord.id,
      filename: importRecord.filename,
      fileType: importRecord.fileType,
      status: importRecord.status,
      uploadedAt: importRecord.uploadedAt,
      extractedAt: importRecord.extractedAt,
      reviewedAt: importRecord.reviewedAt,
      chapterCount: importRecord.chapters?.length || 0,
      chapterStats: importRecord.chapterStats,
      bookId: importRecord.bookId,
    });
  } catch (error) {
    console.error('Status fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch import status', details: error.message });
  }
});

// Analyze imported book chapters with AI (streaming progress)
app.post('/api/books/:bookId/analyze-import', authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    const { chapterIndexes } = req.body; // Optional: specific chapters to analyze

    const book = await getBook(bookId);
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    

    // Verify user owns this book
    if (book.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!book.importedFrom) {
      return res.status(400).json({ error: 'This book was not imported' });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const analyzer = new AIImportAnalyzer(redisClient);
    const chaptersToAnalyze = chapterIndexes
      ? book.chapters.filter((ch, idx) => chapterIndexes.includes(idx))
      : book.chapters;

    const chapterAnalyses = [];
    let analyzedCount = 0;

    // Progress callback
    const sendProgress = (stage, message, data = {}) => {
      res.write(`data: ${JSON.stringify({ stage, message, ...data })}\n\n`);
    };

    try {
      // Phase 1: Analyze chapters one by one
      sendProgress('analyzing', `Analyzing ${chaptersToAnalyze.length} chapters...`);

      for (let i = 0; i < chaptersToAnalyze.length; i++) {
        const chapter = chaptersToAnalyze[i];
        sendProgress('analyzing', `Analyzing chapter ${i + 1}/${chaptersToAnalyze.length}: ${chapter.title}`);

        const analysis = await analyzer.analyzeChapter(chapter, {
          characters: chapterAnalyses.flatMap(a => a.characters || []),
          locations: chapterAnalyses.flatMap(a => a.locations || []),
        });

        chapterAnalyses.push(analysis);
        analyzedCount++;

        // Update chapter with summary
        chapter.summary = analysis.summary;

        // Send progress update
        sendProgress('chapter-complete', `Completed chapter ${i + 1}`, {
          chapterNumber: chapter.number,
          analyzed: analyzedCount,
          total: chaptersToAnalyze.length,
        });
      }

      // Phase 2: Consolidate metadata
      sendProgress('consolidating', 'Consolidating characters...');
      const newCharacters = await analyzer.consolidateCharacters(chapterAnalyses);

      sendProgress('consolidating', 'Consolidating locations...');
      const newLocations = await analyzer.consolidateLocations(chapterAnalyses);

      sendProgress('consolidating', 'Consolidating plot threads...');
      const newPlotThreads = await analyzer.consolidatePlotThreads(chapterAnalyses);

      sendProgress('consolidating', 'Generating timeline events...');
      const newTimelineEvents = await analyzer.generateTimelineFromChapters(
        chaptersToAnalyze,
        chapterAnalyses
      );

      // Phase 3: Generate overview if not exists
      if (!book.overview) {
        sendProgress('generating', 'Generating book overview...');
        book.overview = await analyzer.generateOverview(chapterAnalyses, {
          characters: newCharacters,
          locations: newLocations,
          plotThreads: newPlotThreads,
        });
      }

      // MERGE with existing data instead of replacing
      const existingCharacters = book.characters || [];
      const existingLocations = book.locations || [];
      const existingPlotlines = book.plotlines || [];
      const existingTimelines = book.timelines || [];

      // Merge characters (avoid duplicates by name)
      const mergedCharacters = [...existingCharacters.filter(c => !c.fromImport)]; // Keep manually created
      newCharacters.forEach((newChar, idx) => {
        const existingIndex = existingCharacters.findIndex(
          c => c.name.toLowerCase() === newChar.name.toLowerCase() && c.fromImport
        );

        if (existingIndex >= 0) {
          // Update existing imported character
          const existing = existingCharacters[existingIndex];
          mergedCharacters.push({
            ...existing,
            background: newChar.description,
            personality: newChar.traits?.join(', ') || existing.personality,
            importMetadata: {
              aliases: [...new Set([
                ...(existing.importMetadata?.aliases || []),
                ...(newChar.aliases || [])
              ])],
              firstAppearance: Math.min(
                existing.importMetadata?.firstAppearance || Infinity,
                newChar.firstAppearance || Infinity
              ),
              chapters: [...new Set([
                ...(existing.importMetadata?.chapters || []),
                ...(newChar.chapters || [])
              ])].sort((a, b) => a - b),
            },
          });
        } else {
          // Add new character
          mergedCharacters.push({
            id: Date.now() + idx,
            name: newChar.name,
            role: newChar.role,
            age: 'Unknown',
            gender: 'Unknown',
            background: newChar.description,
            personality: newChar.traits?.join(', ') || '',
            arc: '',
            motivations: '',
            fears: '',
            quirks: '',
            relationships: [],
            skinColor: '',
            hairColor: '',
            eyeColor: '',
            height: '',
            weight: '',
            build: '',
            fromImport: true,
            importMetadata: {
              aliases: newChar.aliases || [],
              firstAppearance: newChar.firstAppearance,
              chapters: newChar.chapters || [],
            },
          });
        }
      });

      // Merge locations
      const mergedLocations = [...existingLocations.filter(l => !l.fromImport)];
      newLocations.forEach((newLoc, idx) => {
        const existingIndex = existingLocations.findIndex(
          l => l.name.toLowerCase() === newLoc.name.toLowerCase() && l.fromImport
        );

        if (existingIndex >= 0) {
          const existing = existingLocations[existingIndex];
          mergedLocations.push({
            ...existing,
            description: newLoc.description,
            significance: newLoc.significance || existing.significance,
            importMetadata: {
              firstAppearance: Math.min(
                existing.importMetadata?.firstAppearance || Infinity,
                newLoc.firstAppearance || Infinity
              ),
              chapters: [...new Set([
                ...(existing.importMetadata?.chapters || []),
                ...(newLoc.chapters || [])
              ])].sort((a, b) => a - b),
            },
          });
        } else {
          mergedLocations.push({
            id: Date.now() + 1000 + idx,
            name: newLoc.name,
            type: newLoc.type,
            description: newLoc.description,
            significance: newLoc.significance || '',
            atmosphere: '',
            history: '',
            fromImport: true,
            importMetadata: {
              firstAppearance: newLoc.firstAppearance,
              chapters: newLoc.chapters || [],
            },
          });
        }
      });

      // Merge plotlines
      const mergedPlotlines = [...existingPlotlines.filter(p => !p.fromImport)];
      newPlotThreads.forEach((newPlot, idx) => {
        const existingIndex = existingPlotlines.findIndex(
          p => p.title.toLowerCase() === newPlot.title.toLowerCase() && p.fromImport
        );

        if (existingIndex >= 0) {
          const existing = existingPlotlines[existingIndex];
          mergedPlotlines.push({
            ...existing,
            description: newPlot.description,
            status: newPlot.status || existing.status,
            importMetadata: {
              chapters: [...new Set([
                ...(existing.importMetadata?.chapters || []),
                ...(newPlot.chapters || [])
              ])].sort((a, b) => a - b),
              startChapter: Math.min(
                existing.importMetadata?.startChapter || Infinity,
                newPlot.startChapter || Infinity
              ),
              endChapter: newPlot.endChapter || existing.importMetadata?.endChapter,
            },
          });
        } else {
          mergedPlotlines.push({
            id: Date.now() + 2000 + idx,
            title: newPlot.title,
            type: newPlot.type,
            description: newPlot.description,
            themes: '',
            conflicts: '',
            status: newPlot.status,
            fromImport: true,
            importMetadata: {
              chapters: newPlot.chapters || [],
              startChapter: newPlot.startChapter,
              endChapter: newPlot.endChapter,
            },
          });
        }
      });

      // Add timeline events (locked from import)
      const mergedTimelines = [...existingTimelines];
      newTimelineEvents.forEach((event, idx) => {
        mergedTimelines.push({
          id: Date.now() + 3000 + idx,
          ...event,
          fromImport: true,
          locked: true, // Lock imported timeline events
        });
      });

      // Apply merged data
      book.characters = mergedCharacters;
      book.locations = mergedLocations;
      book.plotlines = mergedPlotlines;
      book.timelines = mergedTimelines;

      // Update import analysis status
      // Determine if analysis is complete or partial
      const currentAnalyzedCount = (book.importAnalysis?.analyzedChapters || 0) + analyzedCount;
      const isFullyAnalyzed = currentAnalyzedCount >= book.chapters.length;

      book.importAnalysis = {
        status: isFullyAnalyzed ? 'completed' : 'partial',
        analyzedChapters: currentAnalyzedCount,
        totalChapters: book.chapters.length,
        lastAnalyzedAt: new Date().toISOString(),
        ...(isFullyAnalyzed && { completedAt: new Date().toISOString() }),
      };

      book.updatedAt = new Date().toISOString();

      // Save updated book
      await updateBook(bookId, req.user.id, book);

      // Send completion
      sendProgress('complete', 'Import analysis complete!', {
        charactersFound: mergedCharacters.filter(c => c.fromImport).length,
        locationsFound: mergedLocations.filter(l => l.fromImport).length,
        plotThreadsFound: mergedPlotlines.filter(p => p.fromImport).length,
        timelineEventsFound: newTimelineEvents.length,
      });

      res.end();
    } catch (analysisError) {
      console.error('Import analysis error:', analysisError);
      sendProgress('error', `Analysis failed: ${analysisError.message}`);
      res.end();
    }
  } catch (error) {
    console.error('Import analysis setup error:', error);
    res.status(500).json({ error: 'Failed to start import analysis', details: error.message });
  }
});

// ============ VIDEO/ANIMATION GENERATION ROUTES (Protected) ============

// Parse transcript into video scenes
app.post('/api/video/parse-transcript', authenticateToken, async (req, res) => {
  try {
    const { transcriptId, bookId } = req.body;

    if (!transcriptId || !bookId) {
      return res.status(400).json({ error: 'Transcript ID and book ID are required' });
    }

    // Get book data
    const book = await getBook(bookId);
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    

    // Verify ownership
    if (book.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Find transcript
    const transcript = book.transcripts?.find(t => t.id.toString() === transcriptId);
    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    const parser = new VideoSceneParser();
    const scenes = await parser.parseTranscriptToScenes(transcript, {
      characters: book.characters || [],
      locations: book.locations || [],
    });

    res.json({
      success: true,
      scenes,
      sceneCount: scenes.length,
      estimatedDuration: scenes.reduce((sum, s) => sum + (s.duration || 8), 0),
    });
  } catch (error) {
    console.error('Scene parsing error:', error);
    res.status(500).json({ error: 'Failed to parse transcript', details: error.message });
  }
});

// Generate video for scenes (streaming progress)
app.post('/api/video/generate-animation', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const { bookId, transcriptId, scenes, options = {} } = req.body;

    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({ error: 'Scenes array is required' });
    }

    // Verify book ownership
    const book = await getBook(bookId);
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    
    if (book.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendProgress = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      sendProgress({ stage: 'starting', message: `Generating ${scenes.length} video scenes...` });

      // Generate videos (pass bookId for media access control)
      const generator = new VideoGenerator(null, bookId);
      const results = await generator.generateBatch(scenes, sendProgress, options);

      const successCount = results.filter(r => r.status === 'completed').length;
      const failedCount = results.filter(r => r.status === 'failed').length;

      if (successCount === 0) {
        sendProgress({ stage: 'error', message: 'All scenes failed to generate' });
        res.end();
        return;
      }

      sendProgress({
        stage: 'generation-complete',
        message: `Generated ${successCount}/${scenes.length} scenes`,
        successCount,
        failedCount,
      });

      // Assemble video
      sendProgress({ stage: 'assembling', message: 'Assembling final video...' });

      const assembler = new VideoAssembler(bookId);
      const finalVideo = await assembler.assembleFilm(results, {
        title: book.transcripts?.find(t => t.id.toString() === transcriptId)?.title || 'Animation',
        ...options,
      });

      // Create animation project in book
      const animationProject = {
        id: Date.now(),
        transcriptId,
        title: book.transcripts?.find(t => t.id.toString() === transcriptId)?.title || 'Animation',
        scenes: scenes.map((scene, idx) => ({
          ...scene,
          ...results[idx],
        })),
        finalVideo,
        status: 'completed',
        createdAt: new Date().toISOString(),
      };

      book.animationProjects = [...(book.animationProjects || []), animationProject];
      book.updatedAt = new Date().toISOString();

      await updateBook(bookId, req.user.id, book);

      sendProgress({
        stage: 'complete',
        message: 'Animation film complete!',
        animationProject,
        videoUrl: finalVideo.videoUrl,
      });

      res.end();
    } catch (genError) {
      console.error('Video generation error:', genError);
      sendProgress({ stage: 'error', message: genError.message });
      res.end();
    }
  } catch (error) {
    console.error('Animation generation setup error:', error);
    res.status(500).json({ error: 'Failed to start animation generation', details: error.message });
  }
});

// ============ MEDIA STORAGE ROUTES (Authenticated Access) ============

// SECURITY: Get media file with authentication and authorization
// Users must be authenticated and have access to the book that owns this media
app.get('/api/media/:bucketType/:filename', authenticateToken, async (req, res) => {
  try {
    const { bucketType, filename } = req.params;

    // Validate bucket type
    if (!['images', 'audio', 'comics', 'videos'].includes(bucketType)) {
      return res.status(400).json({ error: 'Invalid bucket type' });
    }

    // SECURITY: Get the book ID that owns this media file
    const bookId = await getMediaBookMapping(bucketType, filename);

    if (!bookId) {
      // Media file has no ownership mapping - allow for backward compatibility
      // (existing media files uploaded before this security fix)
      console.warn(`⚠️  Media file has no ownership mapping: ${bucketType}/${filename}`);
    } else {
      // SECURITY: Verify user has access to this book
      const book = await getBook(bookId);

      if (!book) {
        return res.status(404).json({
          error: 'Media not found',
          message: 'The book associated with this media no longer exists'
        });
      }

      

      // Check if user is owner or collaborator
      const isOwner = book.ownerId === req.user.id;
      const isCollaborator = book.collaborators?.some(c => c.email === req.user.email);

      if (!isOwner && !isCollaborator) {
        return res.status(403).json({
          error: 'Not authorized to access this media',
          message: 'You must be the book owner or a collaborator to access this media file.'
        });
      }
    }

    // Get file stream from storage
    const stream = await mediaStorage.getStream(
      mediaStorage.buckets[bucketType],
      filename
    );

    // Set appropriate content type
    const ext = path.extname(filename).toLowerCase();
    const contentTypeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

    stream.pipe(res);
  } catch (error) {
    console.error('Media fetch error:', error);
    if (error.code === 'NotFound') {
      res.status(404).json({ error: 'Media not found' });
    } else {
      res.status(500).json({ error: 'Failed to fetch media', details: error.message });
    }
  }
});

// Upload media file to MinIO
app.post('/api/media/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { bucketType = 'images', metadata = '{}' } = req.body;

    if (!['images', 'audio', 'comics'].includes(bucketType)) {
      return res.status(400).json({ error: 'Invalid bucket type' });
    }

    const buffer = fs.readFileSync(req.file.path);
    const filename = req.file.filename;

    const result = await mediaStorage.upload(
      bucketType,
      buffer,
      filename,
      JSON.parse(metadata)
    );

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    res.json({
      ...result,
      url: `/api/media/${bucketType}/${filename}`,
    });
  } catch (error) {
    console.error('Media upload error:', error);
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    res.status(500).json({ error: 'Failed to upload media', details: error.message });
  }
});

// Delete media file from MinIO
app.delete('/api/media/:bucketType/:filename', authenticateToken, async (req, res) => {
  try {
    const { bucketType, filename } = req.params;

    if (!['images', 'audio', 'comics'].includes(bucketType)) {
      return res.status(400).json({ error: 'Invalid bucket type' });
    }

    await mediaStorage.delete(bucketType, filename);

    res.json({ success: true, message: 'Media deleted successfully' });
  } catch (error) {
    console.error('Media delete error:', error);
    res.status(500).json({ error: 'Failed to delete media', details: error.message });
  }
});

// ==================== JOB QUEUE ENDPOINTS ====================

// Get user's jobs
app.get('/api/jobs', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const jobs = await getUserJobs(userId);
    res.json({ jobs });
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Failed to get jobs' });
  }
});

// Get job status
app.get('/api/jobs/:jobId', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await getJobStatus(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Verify job belongs to user
    if (job.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json(job);
  } catch (error) {
    console.error('Get job status error:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// Delete job
app.delete('/api/jobs/:jobId', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await getJobStatus(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Verify job belongs to user
    if (job.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await cleanupJob(jobId, req.user.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

// Retry failed job
app.post('/api/jobs/:jobId/retry', authenticateToken, async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await getJobStatus(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Verify job belongs to user
    if (job.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (job.status !== 'failed') {
      return res.status(400).json({ error: 'Can only retry failed jobs' });
    }

    // Re-queue the job based on type
    let queue;
    switch (job.type) {
      case 'image':
        queue = imageQueue;
        break;
      case 'audio':
        queue = audioQueue;
        break;
      case 'content':
        queue = contentQueue;
        break;
      case 'import':
        queue = importQueue;
        break;
      case 'video':
        queue = videoQueue;
        break;
      default:
        return res.status(400).json({ error: 'Unknown job type' });
    }

    // Create new job with same data
    const newJob = await queue.add(job.data || {});
    await storeJobMetadata(newJob.id.toString(), job.userId, job.bookId, job.type, job.data || {});

    // Clean up old job
    await cleanupJob(jobId, req.user.userId);

    res.json({ success: true, newJobId: newJob.id.toString() });
  } catch (error) {
    console.error('Retry job error:', error);
    res.status(500).json({ error: 'Failed to retry job' });
  }
});

// ==================== GRAMMAR CHECK ENDPOINT ====================

// Grammar and spell check using LanguageTool
app.post('/api/grammar-check', authenticateToken, async (req, res) => {
  try {
    const { text, language = 'en-US' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Use LanguageTool's free public API (no API key needed)
    const response = await axios.post('https://api.languagetool.org/v2/check',
      new URLSearchParams({
        text,
        language,
        enabledOnly: 'false',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      }
    );

    // Process and return matches
    const matches = response.data.matches || [];

    // Filter and format results
    const suggestions = matches.map(match => ({
      message: match.message,
      shortMessage: match.shortMessage || match.message,
      offset: match.offset,
      length: match.length,
      replacements: match.replacements?.slice(0, 5).map(r => r.value) || [],
      context: {
        text: match.context?.text || '',
        offset: match.context?.offset || 0,
        length: match.context?.length || 0,
      },
      rule: {
        id: match.rule?.id || '',
        description: match.rule?.description || '',
        category: match.rule?.category?.name || 'General',
      },
      type: match.rule?.issueType || 'misspelling',
    }));

    res.json({
      suggestions,
      language: response.data.language?.name || language,
      detectedLanguage: response.data.language?.detectedLanguage,
    });
  } catch (error) {
    console.error('Grammar check error:', error);

    if (error.response?.status === 429) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Please try again in a moment.',
        retryAfter: 60,
      });
    }

    res.status(500).json({
      error: 'Grammar check failed',
      details: error.message,
    });
  }
});

// ==================== VERSION HISTORY ENDPOINTS ====================

// Save a version of chapter content
app.post('/api/books/:bookId/chapters/:chapterId/versions', authenticateToken, async (req, res) => {
  try {
    const { bookId, chapterId } = req.params;
    const { content, title } = req.body;
    const userId = req.user.userId;

    const bookKey = `book:${userId}:${bookId}`;
    const book = await getBook(bookId);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    

    // Initialize versions array if not exists
    if (!book.versions) {
      book.versions = {};
    }
    if (!book.versions[chapterId]) {
      book.versions[chapterId] = [];
    }

    // Create version
    const version = {
      id: Date.now(),
      content,
      title: title || 'Auto-save',
      timestamp: new Date().toISOString(),
      wordCount: content.trim().split(/\s+/).filter(w => w).length,
    };

    // Add to beginning of array (newest first)
    book.versions[chapterId].unshift(version);

    // Keep only last 50 versions per chapter
    if (book.versions[chapterId].length > 50) {
      book.versions[chapterId] = book.versions[chapterId].slice(0, 50);
    }

    book.updatedAt = new Date().toISOString();
    await updateBook(bookId, req.user.id, book);

    res.json({ success: true, version });
  } catch (error) {
    console.error('Save version error:', error);
    res.status(500).json({ error: 'Failed to save version' });
  }
});

// Get version history for a chapter
app.get('/api/books/:bookId/chapters/:chapterId/versions', authenticateToken, async (req, res) => {
  try {
    const { bookId, chapterId } = req.params;
    const userId = req.user.userId;

    const bookKey = `book:${userId}:${bookId}`;
    const book = await getBook(bookId);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    
    const versions = book.versions?.[chapterId] || [];

    res.json({ versions });
  } catch (error) {
    console.error('Get versions error:', error);
    res.status(500).json({ error: 'Failed to get versions' });
  }
});

// Restore a specific version
app.post('/api/books/:bookId/chapters/:chapterId/versions/:versionId/restore', authenticateToken, async (req, res) => {
  try {
    const { bookId, chapterId, versionId } = req.params;
    const userId = req.user.userId;

    const bookKey = `book:${userId}:${bookId}`;
    const book = await getBook(bookId);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    
    const version = book.versions?.[chapterId]?.find(v => v.id.toString() === versionId);

    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    // Update chapter with version content
    book.chapters = book.chapters.map(ch => {
      if (ch.id.toString() === chapterId) {
        return {
          ...ch,
          content: version.content,
          wordCount: version.wordCount,
          updatedAt: new Date().toISOString(),
        };
      }
      return ch;
    });

    book.updatedAt = new Date().toISOString();
    await updateBook(bookId, req.user.id, book);

    res.json({ success: true, chapter: book.chapters.find(ch => ch.id.toString() === chapterId) });
  } catch (error) {
    console.error('Restore version error:', error);
    res.status(500).json({ error: 'Failed to restore version' });
  }
});

// ==================== WRITING STATISTICS ENDPOINTS ====================

// Save daily writing statistics
app.post('/api/users/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { date, wordsWritten, timeSpent, chaptersEdited } = req.body;

    const statsKey = `user:${userId}:stats`;
    let statsData = await getStats(statsKey);
    let stats = statsData ? JSON.parse(statsData) : { daily: [], goals: {} };

    // Find or create entry for this date
    const existingIndex = stats.daily.findIndex(s => s.date === date);
    const entry = {
      date,
      wordsWritten: wordsWritten || 0,
      timeSpent: timeSpent || 0,
      chaptersEdited: chaptersEdited || [],
    };

    if (existingIndex >= 0) {
      // Update existing
      stats.daily[existingIndex] = entry;
    } else {
      // Add new
      stats.daily.push(entry);
    }

    // Keep only last 365 days
    if (stats.daily.length > 365) {
      stats.daily.sort((a, b) => new Date(b.date) - new Date(a.date));
      stats.daily = stats.daily.slice(0, 365);
    }

    await setStats(statsKey, stats);
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Save stats error:', error);
    res.status(500).json({ error: 'Failed to save statistics' });
  }
});

// Get writing statistics
app.get('/api/users/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const statsKey = `user:${userId}:stats`;

    let statsData = await getStats(statsKey);
    let stats = statsData ? JSON.parse(statsData) : { daily: [], goals: {} };

    res.json(stats);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Update writing goals
app.put('/api/users/goals', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { dailyWordGoal, weeklyWordGoal, monthlyWordGoal } = req.body;

    const statsKey = `user:${userId}:stats`;
    let statsData = await getStats(statsKey);
    let stats = statsData ? JSON.parse(statsData) : { daily: [], goals: {} };

    stats.goals = {
      dailyWordGoal: dailyWordGoal || 500,
      weeklyWordGoal: weeklyWordGoal || 3500,
      monthlyWordGoal: monthlyWordGoal || 15000,
    };

    await setStats(statsKey, stats);
    res.json({ success: true, goals: stats.goals });
  } catch (error) {
    console.error('Update goals error:', error);
    res.status(500).json({ error: 'Failed to update goals' });
  }
});

// ============================================================================
// RPG GAME ROUTES
// ============================================================================

import {
  convertCharactersToRPG,
  convertLocationsToRPG,
  convertPlotlinesToQuests,
  generateEncountersFromChapters
} from './utils/rpgConverter.js';

// Generate RPG from book
app.post('/api/rpg/generate', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { bookId, settings } = req.body;

    if (!bookId) {
      return res.status(400).json({ error: 'Book ID is required' });
    }

    // Get book data
    const bookKey = `book:${bookId}`;
    const book = await getBook(bookId);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    

    // Verify ownership
    if (book.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Convert book elements to RPG data
    const rpgData = {
      bookId,
      settings,
      characters: convertCharactersToRPG(book.characters || [], settings),
      locations: convertLocationsToRPG(book.locations || [], settings),
      quests: convertPlotlinesToQuests(book.plotlines || [], book.characters || [], book.locations || []),
      encounters: generateEncountersFromChapters(book.chapters || [], book.characters || [], book.locations || [], settings),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save RPG data
    const rpgKey = `rpg:${bookId}`;
    await setRPGData(bookId, rpgData);

    res.json({ success: true, rpgData });
  } catch (error) {
    console.error('Generate RPG error:', error);
    res.status(500).json({ error: 'Failed to generate RPG data' });
  }
});

// Get RPG data for a book
app.get('/api/rpg/:bookId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { bookId } = req.params;

    // Verify book ownership
    const bookKey = `book:${bookId}`;
    const book = await getBook(bookId);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    
    if (book.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Get RPG data
    const rpgKey = `rpg:${bookId}`;
    const rpgDataStr = await getRPGData(bookId);

    if (!rpgDataStr) {
      return res.json({ rpgData: null });
    }

    const rpgData = JSON.parse(rpgDataStr);
    res.json({ rpgData });
  } catch (error) {
    console.error('Get RPG data error:', error);
    res.status(500).json({ error: 'Failed to get RPG data' });
  }
});

// Update RPG data
app.put('/api/rpg/:bookId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { bookId } = req.params;
    const { rpgData } = req.body;

    // Verify book ownership
    const bookKey = `book:${bookId}`;
    const book = await getBook(bookId);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    
    if (book.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update RPG data
    rpgData.updatedAt = new Date().toISOString();
    const rpgKey = `rpg:${bookId}`;
    await setRPGData(bookId, rpgData);

    res.json({ success: true, rpgData });
  } catch (error) {
    console.error('Update RPG data error:', error);
    res.status(500).json({ error: 'Failed to update RPG data' });
  }
});

// Delete RPG data
app.delete('/api/rpg/:bookId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { bookId } = req.params;

    // Verify book ownership
    const bookKey = `book:${bookId}`;
    const book = await getBook(bookId);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    
    if (book.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Delete RPG data
    const rpgKey = `rpg:${bookId}`;
    await deleteRPGData(bookId);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete RPG data error:', error);
    res.status(500).json({ error: 'Failed to delete RPG data' });
  }
});

// Export character sheet to PDF
app.post('/api/rpg/character/export-pdf', authenticateToken, async (req, res) => {
  try {
    const { character, ruleSystem } = req.body;

    if (!character) {
      return res.status(400).json({ error: 'Character data is required' });
    }

    // Import jsPDF
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();

    // Set up fonts and colors
    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    doc.text(character.name, 20, 20);

    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');

    let yPos = 30;

    if (ruleSystem === 'd20') {
      // D&D 5e Character Sheet
      doc.text(`Class: ${character.class}`, 20, yPos);
      doc.text(`Level: ${character.level}`, 120, yPos);
      yPos += 10;

      doc.text(`HP: ${character.hp}/${character.maxHp}`, 20, yPos);
      doc.text(`AC: ${character.armorClass}`, 70, yPos);
      doc.text(`Initiative: ${character.initiative >= 0 ? '+' : ''}${character.initiative}`, 120, yPos);
      yPos += 15;

      // Ability Scores
      doc.setFont(undefined, 'bold');
      doc.text('Ability Scores', 20, yPos);
      doc.setFont(undefined, 'normal');
      yPos += 10;

      const abilities = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
      abilities.forEach((ability, idx) => {
        const score = character.stats?.[ability] || 10;
        const modifier = Math.floor((score - 10) / 2);
        const xPos = 20 + (idx % 3) * 60;
        const yOffset = Math.floor(idx / 3) * 10;
        doc.text(
          `${ability.toUpperCase().substring(0, 3)}: ${score} (${modifier >= 0 ? '+' : ''}${modifier})`,
          xPos,
          yPos + yOffset
        );
      });
      yPos += 30;

      // Other Stats
      doc.text(`Proficiency Bonus: +${character.proficiencyBonus}`, 20, yPos);
      doc.text(`Speed: ${character.speed} ft`, 120, yPos);
      yPos += 15;

    } else if (ruleSystem === 'fate') {
      // Fate Core Character Sheet
      doc.text(`Refresh: ${character.refresh || 3}`, 20, yPos);
      doc.text(`Fate Points: ${character.fatePoints || 3}`, 120, yPos);
      yPos += 15;

      // Aspects
      doc.setFont(undefined, 'bold');
      doc.text('Aspects', 20, yPos);
      doc.setFont(undefined, 'normal');
      yPos += 10;

      (character.aspects || []).forEach(aspect => {
        doc.text(`${aspect.type}: ${aspect.value}`, 20, yPos);
        yPos += 8;
      });
      yPos += 10;

      // Skills
      doc.setFont(undefined, 'bold');
      doc.text('Skills', 20, yPos);
      doc.setFont(undefined, 'normal');
      yPos += 10;

      Object.entries(character.skills || {}).forEach(([skill, rating]) => {
        doc.text(`${skill}: +${rating}`, 20, yPos);
        yPos += 8;
        if (yPos > 270) {
          doc.addPage();
          yPos = 20;
        }
      });

    } else if (ruleSystem === 'pbta') {
      // PBTA Character Sheet
      doc.text(`Playbook: ${character.playbook || 'N/A'}`, 20, yPos);
      yPos += 15;

      doc.text(`Harm: ${character.harm || 0}/${character.maxHarm || 6}`, 20, yPos);
      doc.text(`Experience: ${character.experience || 0}`, 120, yPos);
      yPos += 15;

      // Stats
      doc.setFont(undefined, 'bold');
      doc.text('Stats', 20, yPos);
      doc.setFont(undefined, 'normal');
      yPos += 10;

      const stats = ['cool', 'hard', 'hot', 'sharp', 'weird'];
      stats.forEach(stat => {
        const value = character[stat] || 0;
        doc.text(`${stat.toUpperCase()}: ${value >= 0 ? '+' : ''}${value}`, 20, yPos);
        yPos += 8;
      });

    } else {
      // Custom System
      doc.text(`Health: ${character.health || 100}/${character.maxHealth || 100}`, 20, yPos);
      yPos += 10;
      doc.text(`Energy: ${character.energy || 50}/${character.maxEnergy || 50}`, 20, yPos);
      yPos += 15;
    }

    // Backstory (if space)
    if (character.originalData?.background && yPos < 240) {
      yPos += 10;
      doc.setFont(undefined, 'bold');
      doc.text('Background', 20, yPos);
      doc.setFont(undefined, 'normal');
      yPos += 8;

      const backgroundLines = doc.splitTextToSize(character.originalData.background, 170);
      backgroundLines.slice(0, 5).forEach(line => {
        if (yPos < 280) {
          doc.text(line, 20, yPos);
          yPos += 6;
        }
      });
    }

    // Generate PDF buffer
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${character.name}-character-sheet.pdf"`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Export PDF error:', error);
    res.status(500).json({ error: 'Failed to export PDF' });
  }
});

// Generate AI dialogue for quest
app.post('/api/rpg/quest/generate-dialogue', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const { quest, characters, ruleSystem } = req.body;

    if (!quest || !quest.title) {
      return res.status(400).json({ error: 'Quest data is required' });
    }

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_OPENAI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your OpenAI API key in Profile > API Keys to generate RPG dialogue.'
        });
      }
      throw error;
    }

    // Build context for AI
    const charactersContext = characters.map(c =>
      `${c.name}: ${c.originalData?.personality || ''} ${c.originalData?.background || ''}`
    ).join('\n');

    const prompt = `Generate dialogue for the RPG quest "${quest.title}".

Quest Description: ${quest.description}
Rule System: ${ruleSystem}

NPCs Involved:
${charactersContext}

Objectives:
${quest.objectives?.map(o => `- ${o.description}`).join('\n') || 'None'}

Create a dialogue tree with:
1. Quest giver initial dialogue (introducing the quest)
2. Player response options (at least 3)
3. NPC reactions to each response
4. Quest acceptance/rejection outcomes

Format as a JSON dialogue tree with nodes and choices.`;

    const completion = await userOpenai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a creative RPG game master creating engaging dialogue for quests. Generate realistic, character-appropriate dialogue that fits the game\'s tone and setting.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.8,
      max_tokens: 2000
    });

    const dialogueContent = completion.choices[0].message.content;

    // Try to parse as JSON, otherwise return as text
    let dialogueTree;
    try {
      dialogueTree = JSON.parse(dialogueContent);
    } catch {
      // If not JSON, structure it
      dialogueTree = {
        root: {
          speaker: characters[0]?.name || 'Quest Giver',
          text: dialogueContent,
          choices: [
            { text: 'Accept quest', nextNode: 'accept' },
            { text: 'Ask for more information', nextNode: 'info' },
            { text: 'Decline quest', nextNode: 'decline' }
          ]
        }
      };
    }

    res.json({ success: true, dialogueTree });

  } catch (error) {
    console.error('Generate dialogue error:', error);
    res.status(500).json({ error: 'Failed to generate dialogue' });
  }
});

// ============================================================================
// GM TOOLS ROUTES
// ============================================================================

// Generate NPC response
app.post('/api/rpg/gm/generate-npc-response', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const { npc, context, ruleSystem } = req.body;

    if (!npc || !context) {
      return res.status(400).json({ error: 'NPC and context are required' });
    }

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_OPENAI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your OpenAI API key in Profile > API Keys to generate NPC responses.'
        });
      }
      throw error;
    }

    const prompt = `You are roleplaying as ${npc.name}, an NPC in a ${ruleSystem} RPG campaign.

Character Details:
- Name: ${npc.name}
- Personality: ${npc.originalData?.personality || 'Not specified'}
- Background: ${npc.originalData?.background || 'Not specified'}
- Motivations: ${npc.originalData?.motivations || 'Not specified'}

Player's action or question: ${context}

Respond in character as ${npc.name}. Keep the response natural, in-character, and appropriate for the situation. Include body language or actions in *italics* if relevant.`;

    const completion = await userOpenai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a creative Game Master helping to bring NPCs to life with authentic, character-appropriate responses.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.9,
      max_tokens: 300
    });

    const response = completion.choices[0].message.content;
    res.json({ success: true, response });

  } catch (error) {
    console.error('Generate NPC response error:', error);
    res.status(500).json({ error: 'Failed to generate NPC response' });
  }
});

// Generate random encounter
app.post('/api/rpg/gm/generate-encounter', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const { bookId, locations, difficulty, ruleSystem } = req.body;

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_OPENAI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your OpenAI API key in Profile > API Keys to generate encounters.'
        });
      }
      throw error;
    }

    const locationNames = locations?.map(l => l.name).join(', ') || 'unknown locations';

    const prompt = `Generate a random ${difficulty} difficulty encounter for a ${ruleSystem} RPG campaign.

Setting locations: ${locationNames}

Create an encounter with:
1. Type (combat, social, exploration, or puzzle)
2. Description of what the players encounter
3. Potential challenges or enemies
4. Possible outcomes
5. Rewards or consequences

Make it interesting and appropriate for the setting.`;

    const completion = await userOpenai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a creative Game Master generating exciting random encounters for RPG campaigns.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 1.0,
      max_tokens: 500
    });

    const encounter = {
      id: Date.now(),
      description: completion.choices[0].message.content,
      difficulty,
      createdAt: new Date().toISOString()
    };

    res.json({ success: true, encounter });

  } catch (error) {
    console.error('Generate encounter error:', error);
    res.status(500).json({ error: 'Failed to generate encounter' });
  }
});

// Generate plot twist
app.post('/api/rpg/gm/generate-plot-twist', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const { bookId, campaign, sessions } = req.body;

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_OPENAI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your OpenAI API key in Profile > API Keys to generate plot twists.'
        });
      }
      throw error;
    }

    const recentEvents = sessions?.slice(-3).map(s =>
      `Session ${s.number}: ${s.summary || 'No summary'}`
    ).join('\n') || 'No recent sessions';

    const prompt = `Based on this RPG campaign history, suggest an unexpected plot twist:

Recent Sessions:
${recentEvents}

Generate a creative plot twist that:
1. Builds on established story elements
2. Creates dramatic tension
3. Opens new story possibilities
4. Respects player agency
5. Fits the campaign tone

Provide 2-3 plot twist options.`;

    const completion = await userOpenai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a creative Game Master specializing in dramatic, engaging plot twists for RPG campaigns.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 1.0,
      max_tokens: 600
    });

    const twist = completion.choices[0].message.content;
    res.json({ success: true, twist });

  } catch (error) {
    console.error('Generate plot twist error:', error);
    res.status(500).json({ error: 'Failed to generate plot twist' });
  }
});

// ============================================================================
// EXPORT ROUTES (STAGE 7)
// ============================================================================

import {
  exportToFoundryVTT,
  exportToRoll20,
  generateCampaignPDFData,
  generateHTML5Game
} from './utils/rpgExporters.js';

// Export to Foundry VTT
app.post('/api/rpg/export/foundry', authenticateToken, async (req, res) => {
  try {
    const { rpgData, bookData } = req.body;
    const foundryJSON = exportToFoundryVTT(rpgData, bookData);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${bookData.bookTitle || 'campaign'}-foundry.json"`);
    res.send(foundryJSON);
  } catch (error) {
    console.error('Foundry export error:', error);
    res.status(500).json({ error: 'Failed to export to Foundry VTT' });
  }
});

// Export to Roll20
app.post('/api/rpg/export/roll20', authenticateToken, async (req, res) => {
  try {
    const { rpgData, bookData } = req.body;
    const roll20JSON = exportToRoll20(rpgData, bookData);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${bookData.bookTitle || 'campaign'}-roll20.json"`);
    res.send(roll20JSON);
  } catch (error) {
    console.error('Roll20 export error:', error);
    res.status(500).json({ error: 'Failed to export to Roll20' });
  }
});

// Export campaign PDF
app.post('/api/rpg/export/campaign-pdf', authenticateToken, async (req, res) => {
  try {
    const { rpgData, bookData } = req.body;
    const pdfData = generateCampaignPDFData(rpgData, bookData);

    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();

    let yPos = 20;

    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text(pdfData.title, 20, yPos);
    yPos += 15;

    doc.setFontSize(16);
    doc.text(pdfData.subtitle, 20, yPos);
    yPos += 20;

    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    if (pdfData.overview) {
      const overviewLines = doc.splitTextToSize(pdfData.overview, 170);
      overviewLines.forEach(line => {
        if (yPos > 270) {
          doc.addPage();
          yPos = 20;
        }
        doc.text(line, 20, yPos);
        yPos += 6;
      });
    }
    yPos += 10;

    pdfData.sections.forEach(section => {
      if (yPos > 260) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFontSize(18);
      doc.setFont(undefined, 'bold');
      doc.text(section.title, 20, yPos);
      yPos += 10;

      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(`${section.content.length} ${section.title.toLowerCase()}`, 20, yPos);
      yPos += 10;

      if (yPos > 270) {
        doc.addPage();
        yPos = 20;
      }
    });

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${bookData.bookTitle || 'campaign'}-guide.pdf"`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('PDF export error:', error);
    res.status(500).json({ error: 'Failed to export campaign PDF' });
  }
});

// Export HTML5 game
app.post('/api/rpg/export/html5', authenticateToken, async (req, res) => {
  try {
    const { rpgData, bookData } = req.body;
    const html = generateHTML5Game(rpgData, bookData);

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="${bookData.bookTitle || 'game'}.html"`);
    res.send(html);
  } catch (error) {
    console.error('HTML5 export error:', error);
    res.status(500).json({ error: 'Failed to export HTML5 game' });
  }
});

// ============================================================================
// AI DUNGEON MASTER ROUTES (STAGE 8)
// ============================================================================

// AI DM Response
app.post('/api/rpg/ai-dm/respond', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const { rpgData, gameState, messages, party, ruleSystem, autoGenerateContent } = req.body;

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_OPENAI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your OpenAI API key in Profile > API Keys to use AI Dungeon Master.'
        });
      }
      throw error;
    }

    const conversationHistory = messages.slice(-10).map(m => ({
      role: m.role === 'dm' ? 'assistant' : 'user',
      content: m.content
    }));

    const systemPrompt = `You are an AI Dungeon Master for a ${ruleSystem} RPG campaign.

Current Game State:
- Location: ${gameState.currentLocation?.name || 'Unknown'}
- Active Quests: ${gameState.activeQuests.length}
- Party Level: ${gameState.partyLevel}
- Party Members: ${party.map(p => p.name).join(', ')}

Available Locations: ${rpgData.locations?.map(l => l.name).join(', ')}
Available NPCs: ${rpgData.characters?.filter(c => c.type === 'npc').map(n => n.name).join(', ')}

Your role:
1. Narrate the story dynamically based on player actions
2. Generate content on-the-fly when needed
3. Keep players engaged with challenges and choices
4. Adapt difficulty to party level
5. Ask for dice rolls when appropriate
6. Describe scenes vividly

Respond to the player's action naturally and engagingly.`;

    const completion = await userOpenai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory
      ],
      temperature: 0.9,
      max_tokens: 500
    });

    const response = completion.choices[0].message.content;

    res.json({
      success: true,
      response,
      gameState: gameState
    });

  } catch (error) {
    console.error('AI DM respond error:', error);
    res.status(500).json({ error: 'Failed to generate DM response' });
  }
});

// Generate procedural quest
app.post('/api/rpg/ai-dm/generate-quest', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const { rpgData, gameState, partyLevel } = req.body;

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_OPENAI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your OpenAI API key in Profile > API Keys to generate quests.'
        });
      }
      throw error;
    }

    const prompt = `Generate a side quest for a level ${partyLevel} party.

Current Location: ${gameState.currentLocation?.name || 'Unknown'}
Available Locations: ${rpgData.locations?.map(l => l.name).slice(0, 5).join(', ')}

Create a quest with:
1. Catchy title
2. Engaging description (2-3 sentences)
3. 3-5 objectives
4. Appropriate rewards for level ${partyLevel}

Format as JSON with: title, description, objectives (array of strings), rewards (xp, gold)`;

    const completion = await userOpenai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an AI Dungeon Master creating engaging side quests. Return valid JSON only.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.9,
      max_tokens: 600
    });

    let quest;
    try {
      quest = JSON.parse(completion.choices[0].message.content);
    } catch {
      quest = {
        title: 'Procedural Quest',
        description: completion.choices[0].message.content,
        objectives: ['Complete the quest'],
        rewards: { experience: partyLevel * 100, gold: partyLevel * 50 }
      };
    }

    quest.id = Date.now();
    quest.type = 'side';
    quest.status = 'available';

    res.json({ success: true, quest });

  } catch (error) {
    console.error('Generate quest error:', error);
    res.status(500).json({ error: 'Failed to generate quest' });
  }
});

// Generate balanced encounter
app.post('/api/rpg/ai-dm/generate-balanced-encounter', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const { party, location, difficulty, ruleSystem } = req.body;

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_OPENAI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your OpenAI API key in Profile > API Keys to generate encounters.'
        });
      }
      throw error;
    }

    const avgLevel = party.length > 0
      ? Math.round(party.reduce((sum, p) => sum + p.level, 0) / party.length)
      : 1;

    const prompt = `Generate a balanced ${difficulty} combat encounter for:
- Party size: ${party.length}
- Average level: ${avgLevel}
- Location: ${location?.name || 'Unknown'}
- Rule system: ${ruleSystem}

Create ${party.length} enemies appropriate for this challenge.
For each enemy include: name, HP, AC, attack bonus, damage.

Return as JSON: { description, enemies: [{name, hp, maxHp, ac, attackBonus, damage}] }`;

    const completion = await userOpenai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an AI Dungeon Master creating balanced combat encounters. Return valid JSON only.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 800
    });

    let encounter;
    try {
      encounter = JSON.parse(completion.choices[0].message.content);
    } catch {
      encounter = {
        description: completion.choices[0].message.content,
        enemies: []
      };
    }

    encounter.id = Date.now();
    encounter.type = 'combat';
    encounter.difficulty = difficulty;

    res.json({ success: true, encounter });

  } catch (error) {
    console.error('Generate balanced encounter error:', error);
    res.status(500).json({ error: 'Failed to generate encounter' });
  }
});

// AI DM Narration (TTS)
app.post('/api/rpg/ai-dm/narrate', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body;

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'MISSING_OPENAI_KEY') {
        return res.status(403).json({
          error: 'API key required',
          message: 'Please add your OpenAI API key in Profile > API Keys to use narration.'
        });
      }
      throw error;
    }

    const mp3 = await userOpenai.audio.speech.create({
      model: 'tts-1',
      voice: 'onyx',
      input: text.substring(0, 4096)
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buffer);

  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ error: 'Failed to generate narration' });
  }
});

// ============================================================================
// EXTERNAL API ENDPOINTS (For third-party apps)
// ============================================================================

// Generate API Key
app.post('/api/users/api-keys', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, permissions } = req.body;

    // Generate unique API key
    const apiKey = 'bws_' + Array.from({ length: 32 }, () =>
      Math.random().toString(36).charAt(2)
    ).join('');

    const apiKeyData = {
      key: apiKey,
      userId,
      name: name || 'API Key',
      permissions: permissions || ['read:books', 'read:chapters', 'read:plotlines'],
      active: true,
      createdAt: new Date().toISOString(),
      lastUsed: null,
      requestCount: 0
    };

    await setApiKeyData(apiKey, apiKeyData);

    // Store reference in user's key list
    const userKeysKey = `user:${userId}:apikeys`;
    const userKeys = await getRedisValue(userKeysKey);
    const keys = userKeys ? JSON.parse(userKeys) : [];
    keys.push(apiKey);
    await setRedisValue(userKeysKey, keys);

    res.json({ success: true, apiKey, ...apiKeyData });
  } catch (error) {
    console.error('Generate API key error:', error);
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

// List user's API keys
app.get('/api/users/api-keys', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userKeysKey = `user:${userId}:apikeys`;
    const userKeys = await getRedisValue(userKeysKey);

    if (!userKeys) {
      return res.json({ keys: [] });
    }

    const keys = JSON.parse(userKeys);
    const keyDetails = await Promise.all(
      keys.map(async (key) => {
        const keyInfo = await getApiKeyData();
        if (keyInfo) {
          return {
            key: key.substring(0, 12) + '...' + key.substring(key.length - 4), // Masked
            name: keyInfo.name,
            active: keyInfo.active,
            createdAt: keyInfo.createdAt,
            lastUsed: keyInfo.lastUsed,
            requestCount: keyInfo.requestCount
          };
        }
        return null;
      })
    );

    res.json({ keys: keyDetails.filter(Boolean) });
  } catch (error) {
    console.error('List API keys error:', error);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

// Revoke API key
app.delete('/api/users/api-keys/:key', authenticateToken, async (req, res) => {
  try {
    const apiKey = req.params.key;
    await deleteApiKeyData(apiKey);
    res.json({ success: true });
  } catch (error) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// External API: Get book chapters
app.get('/api/external/books/:bookId/chapters', authenticateApiKey, async (req, res) => {
  try {
    const { bookId } = req.params;
    const { page = 1, limit = 10, include_content = 'false' } = req.query;

    // Get book
    const bookKey = `book:${bookId}`;
    const book = await getBook(bookId);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    

    // Verify ownership
    if (book.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Paginate chapters
    const chapters = book.chapters || [];
    const startIdx = (parseInt(page) - 1) * parseInt(limit);
    const endIdx = startIdx + parseInt(limit);
    const paginatedChapters = chapters.slice(startIdx, endIdx);

    // Format response
    const formattedChapters = paginatedChapters.map(ch => ({
      id: ch.id,
      number: ch.number,
      title: ch.title,
      summary: ch.summary,
      wordCount: ch.wordCount,
      content: include_content === 'true' ? ch.content : undefined,
      createdAt: ch.createdAt,
      updatedAt: ch.updatedAt
    }));

    res.json({
      bookId,
      bookTitle: book.bookTitle,
      total: chapters.length,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(chapters.length / parseInt(limit)),
      chapters: formattedChapters
    });

  } catch (error) {
    console.error('External chapters API error:', error);
    res.status(500).json({ error: 'Failed to fetch chapters' });
  }
});

// External API: Get book plotlines
app.get('/api/external/books/:bookId/plotlines', authenticateApiKey, async (req, res) => {
  try {
    const { bookId } = req.params;
    const { status } = req.query;

    // Get book
    const bookKey = `book:${bookId}`;
    const book = await getBook(bookId);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    

    // Verify ownership
    if (book.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Filter plotlines by status if provided
    let plotlines = book.plotlines || [];
    if (status) {
      plotlines = plotlines.filter(p => p.status === status);
    }

    // Format response
    const formattedPlotlines = plotlines.map(p => ({
      id: p.id,
      title: p.title,
      type: p.type,
      description: p.description,
      status: p.status,
      themes: p.themes,
      conflicts: p.conflicts,
      linkedPlotlines: p.linkedPlotlines,
      createdAt: p.createdAt
    }));

    res.json({
      bookId,
      bookTitle: book.bookTitle,
      total: formattedPlotlines.length,
      plotlines: formattedPlotlines
    });

  } catch (error) {
    console.error('External plotlines API error:', error);
    res.status(500).json({ error: 'Failed to fetch plotlines' });
  }
});

// External API: Get book metadata
app.get('/api/external/books/:bookId', authenticateApiKey, async (req, res) => {
  try {
    const { bookId } = req.params;

    // Get book
    const bookKey = `book:${bookId}`;
    const book = await getBook(bookId);

    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    

    // Verify ownership
    if (book.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Return metadata only
    res.json({
      id: bookId,
      title: book.bookTitle,
      author: book.author,
      genre: book.genre,
      overview: book.overview,
      targetAudience: book.targetAudience,
      wordCount: book.chapters?.reduce((sum, ch) => sum + (ch.wordCount || 0), 0) || 0,
      chapterCount: book.chapters?.length || 0,
      characterCount: book.characters?.length || 0,
      locationCount: book.locations?.length || 0,
      plotlineCount: book.plotlines?.length || 0,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt
    });

  } catch (error) {
    console.error('External book API error:', error);
    res.status(500).json({ error: 'Failed to fetch book metadata' });
  }
});

// External API: List user's books
app.get('/api/external/books', authenticateApiKey, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const bookIds = user.books || [];

    const books = await Promise.all(
      bookIds.map(async (id) => {
        const book = await getBook(id);
        if (book) {
          return {
            id,
            title: book.bookTitle,
            author: book.author,
            genre: book.genre,
            chapterCount: book.chapters?.length || 0,
            wordCount: book.chapters?.reduce((sum, ch) => sum + (ch.wordCount || 0), 0) || 0,
            updatedAt: book.updatedAt
          };
        }
        return null;
      })
    );

    res.json({
      total: books.filter(Boolean).length,
      books: books.filter(Boolean)
    });

  } catch (error) {
    console.error('External books list API error:', error);
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

// ==================== USER SETTINGS FOR AI API KEYS ====================

// Get user settings (AI API keys and preferences)
app.get('/api/users/settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get user settings from PostgreSQL
    const user = await getUserSettings(userId);

    if (!user || !user.ai_config) {
      return res.json({
        openaiApiKey: null,
        geminiApiKey: null,
        preferences: {
          defaultModel: 'gpt-4o-mini',
          defaultVoice: 'alloy',
          autoSave: true,
          enableNotifications: true,
          theme: 'light'
        }
      });
    }

    const aiConfig = user.ai_config || {};
    const preferences = user.preferences || {};

    // SECURITY: Decrypt API keys for display (mask all but last 4 chars)
    const openaiKey = aiConfig.openai_api_key ? decrypt(aiConfig.openai_api_key) : null;
    const geminiKey = aiConfig.gemini_api_key ? decrypt(aiConfig.gemini_api_key) : null;

    res.json({
      openaiApiKey: openaiKey ? '***' + openaiKey.slice(-4) : null,
      geminiApiKey: geminiKey ? '***' + geminiKey.slice(-4) : null,
      preferences: {
        defaultModel: preferences.defaultModel || 'gpt-4o-mini',
        defaultVoice: preferences.defaultVoice || 'alloy',
        autoSave: preferences.autoSave !== undefined ? preferences.autoSave : true,
        enableNotifications: preferences.enableNotifications !== undefined ? preferences.enableNotifications : true,
        theme: preferences.theme || 'light'
      }
    });
  } catch (error) {
    console.error('Error fetching user settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update user settings (API API keys and preferences)
app.put('/api/users/settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { openaiApiKey, geminiApiKey, preferences } = req.body;

    // SECURITY: Encrypt API keys before storing
    const settings = {
      ai_config: {
        openai_api_key: openaiApiKey ? encrypt(openaiApiKey) : null,
        gemini_api_key: geminiApiKey ? encrypt(geminiApiKey) : null
      },
      preferences: preferences || {
        defaultModel: 'gpt-4o-mini',
        defaultVoice: 'alloy',
        autoSave: true,
        enableNotifications: true,
        theme: 'light'
      }
    };

    // Use updateUserSettings from dataAdapter to handle both PostgreSQL and Redis
    await updateUserSettings(userId, settings);

    // Return masked keys for security (don't send back encrypted keys)
    res.json({
      message: 'Settings updated successfully',
      settings: {
        openaiApiKey: openaiApiKey ? '***' + openaiApiKey.slice(-4) : null,
        geminiApiKey: geminiApiKey ? '***' + geminiApiKey.slice(-4) : null,
        preferences: settings.preferences
      }
    });
  } catch (error) {
    console.error('Error updating user settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Get user quotas and limits
app.get('/api/users/quotas', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const quotas = await getUserQuotas(userId);

    // Get display-friendly limits
    const limitsDisplay = getTierLimitsDisplay(quotas.tier);

    res.json({
      tier: quotas.tier,
      limits: quotas.limits,
      limitsDisplay,
      usage: quotas.usage,
      features: quotas.features,
      remainingToday: {
        ai_requests: quotas.limits.max_ai_requests_per_day - quotas.usage.ai_requests_today
      }
    });
  } catch (error) {
    console.error('Error fetching quotas:', error);
    res.status(500).json({ error: 'Failed to fetch quotas' });
  }
});

// 404 handler for undefined routes
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log('\n🚀 Fiction Writing Studio Server');
  console.log('================================');
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`\n📦 Services:`);
  console.log(`  ✓ Redis: ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);

  const storageEndpoint = process.env.AWS_S3_BUCKET
    ? `S3 Bucket: ${process.env.AWS_S3_BUCKET}`
    : `MinIO: http://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}`;
  console.log(`  ${minioAvailable ? '✓' : '✗'} ${storageEndpoint}`);

  if (minioAvailable && !process.env.AWS_S3_BUCKET) {
    console.log(`    MinIO Console: http://${process.env.MINIO_ENDPOINT || 'localhost'}:9001`);
    console.log(`    Username: ${process.env.MINIO_ACCESS_KEY || 'minioadmin'}`);
  }

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const apiUrl = process.env.API_URL || `http://localhost:${PORT}`;

  console.log(`\n🌐 Endpoints:`);
  console.log(`  Frontend: ${clientUrl}`);
  console.log(`  API: ${apiUrl}`);
  console.log(`  Health: ${apiUrl}/api/health`);
  console.log('================================\n');
});
