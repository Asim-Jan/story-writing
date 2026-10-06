import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import dotenv from 'dotenv';
import axios from 'axios';
import { getSAIClient, saiChat, saiImage, saiSpeech, saiVideoStart, saiVideoStatus, VOICE_MAP, voiceLabel, SAI_CHAT, SAI_CHAT_FAST, saiConfigured } from './saiClient.js';
import { extractJSON } from './utils/extractJSON.js';
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
import { runMigrations } from './db/migrate.js';
import { readFileSync } from 'fs';
import { initializeAuthorization } from './middleware/authorization.js';
import { ApiResponse } from './utils/responses.js';
import { setMediaBookMapping, recordMediaOwner, canAccessMedia, forgetMediaOwner, ensureMediaOwnersTable } from './utils/mediaMapping.js';
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
import { validatePassword } from './utils/passwordValidation.js';
import { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail, sendPasswordChangedEmail, verifyEmailTransport, isEmailConfigured } from './services/emailService.js';
import TemplateRepository from './db/repositories/TemplateRepository.js';
import UserRepository from './db/repositories/UserRepository.js';
import BookRepository from './db/repositories/BookRepository.js';
import ChapterRepository from './db/repositories/ChapterRepository.js';
import { getPool, query } from './db/postgres.js';
import * as stripeService from './services/stripeService.js';
import * as revenueAnalytics from './services/revenueAnalytics.js';
import * as engagementAnalytics from './services/engagementAnalytics.js';
import * as costTracking from './services/costTracking.js';
import { toCSV, setCSVHeaders, formatDateForCSV } from './utils/csvExporter.js';
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

// Images/audio attached to characters, locations and chapters. It used to share the import
// uploader above, whose filter only allows .epub/.pdf/.docx/.txt, so every image upload failed.
const MEDIA_UPLOAD_EXT = {
  images: ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
  comics: ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
  audio: ['.mp3', '.wav', '.ogg'],
};
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = new Set(Object.values(MEDIA_UPLOAD_EXT).flat());
    if (allowed.has(ext)) cb(null, true);
    else cb(new Error('Invalid file type. Images (PNG, JPG, GIF, WebP) or audio (MP3, WAV, OGG) only.'));
  }
});

const app = express();
const PORT = process.env.PORT || 3001;
// No fallback in production: a known default secret would let anyone mint an admin token.
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is not set');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

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

// Trust proxy: two hops, Cloudflare then Traefik. With 1, req.ip was the Cloudflare EDGE address,
// so every rate limit (sign-up, login, emails) was shared by everyone behind the same PoP.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 2));

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));

// Stripe webhook handler (MUST be before express.json() to get raw body)
app.post('/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];

    try {
      // Verify webhook signature
      const event = stripeService.constructWebhookEvent(req.body, sig);

      // Log webhook event to database
      await getPool().query(
        `INSERT INTO stripe_webhook_events (event_id, event_type, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id) DO NOTHING`,
        [event.id, event.type, JSON.stringify(event)]
      );

      // Process event asynchronously (don't block webhook response)
      processStripeWebhook(event).catch(err => {
        console.error('Webhook processing error:', err);
        // Update event record with error
        getPool().query(
          `UPDATE stripe_webhook_events
           SET error = $1, processed = false
           WHERE event_id = $2`,
          [err.message, event.id]
        ).catch(console.error);
      });

      // Return 200 OK immediately
      res.json({ received: true });
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

/**
 * Process Stripe webhook events
 */
async function processStripeWebhook(event) {
  const pool = getPool();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const metadata = session.metadata || {};
        const subscriptionId = session.subscription;

        // Get customer email
        const customerEmail = session.customer_details?.email || session.customer_email;

        if (!customerEmail) {
          console.error('No customer email in checkout session');
          break;
        }

        // Find user by email
        const userResult = await pool.query(
          'SELECT id, tier FROM users WHERE email = $1',
          [customerEmail]
        );

        if (userResult.rows.length === 0) {
          console.error(`User not found for email: ${customerEmail}`);
          break;
        }

        const user = userResult.rows[0];
        const tier = metadata.tier || 'basic';

        // Create subscription record
        await pool.query(
          `INSERT INTO subscriptions
           (user_id, stripe_subscription_id, stripe_customer_id, tier, status, current_period_start, current_period_end)
           VALUES ($1, $2, $3, $4, 'active', NOW(), NOW() + INTERVAL '30 days')
           ON CONFLICT (stripe_subscription_id)
           DO UPDATE SET status = 'active', updated_at = NOW()`,
          [user.id, subscriptionId, session.customer, tier]
        );

        // Update user tier
        await pool.query(
          'UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2',
          [tier, user.id]
        );

        // Update quotas to match tier
        const tierQuotas = getTierQuotas(tier);
        await pool.query(
          `UPDATE quotas
           SET max_books = $1, max_words = $2, max_chapters = $3,
               max_ai_requests_per_day = $4, max_concurrent_jobs = $5,
               custom_quotas = false, updated_at = NOW()
           WHERE user_id = $6`,
          [
            tierQuotas.max_books,
            tierQuotas.max_words,
            tierQuotas.max_chapters,
            tierQuotas.max_ai_requests_per_day,
            tierQuotas.max_concurrent_jobs,
            user.id
          ]
        );

        console.log(`Subscription created for user ${customerEmail}, tier: ${tier}`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;

        // Update subscription in database
        await pool.query(
          `UPDATE subscriptions
           SET status = $1,
               current_period_start = to_timestamp($2),
               current_period_end = to_timestamp($3),
               cancel_at_period_end = $4,
               updated_at = NOW()
           WHERE stripe_subscription_id = $5`,
          [
            subscription.status,
            subscription.current_period_start,
            subscription.current_period_end,
            subscription.cancel_at_period_end,
            subscription.id
          ]
        );

        console.log(`Subscription updated: ${subscription.id}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;

        // Get subscription from DB
        const subResult = await pool.query(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1',
          [subscription.id]
        );

        if (subResult.rows.length === 0) {
          console.error(`Subscription not found: ${subscription.id}`);
          break;
        }

        const userId = subResult.rows[0].user_id;

        // Mark subscription as canceled
        await pool.query(
          `UPDATE subscriptions
           SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subscription.id]
        );

        // Downgrade user to free tier
        await pool.query(
          'UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2',
          ['free', userId]
        );

        // Reset quotas to free tier
        const freeQuotas = getTierQuotas('free');
        await pool.query(
          `UPDATE quotas
           SET max_books = $1, max_words = $2, max_chapters = $3,
               max_ai_requests_per_day = $4, max_concurrent_jobs = $5,
               custom_quotas = false, updated_at = NOW()
           WHERE user_id = $6`,
          [
            freeQuotas.max_books,
            freeQuotas.max_words,
            freeQuotas.max_chapters,
            freeQuotas.max_ai_requests_per_day,
            freeQuotas.max_concurrent_jobs,
            userId
          ]
        );

        console.log(`Subscription canceled and user downgraded: ${userId}`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        // Get subscription from DB
        const subResult = await pool.query(
          'SELECT id, user_id FROM subscriptions WHERE stripe_subscription_id = $1',
          [subscriptionId]
        );

        if (subResult.rows.length === 0) {
          console.log(`Subscription not found for invoice: ${subscriptionId}`);
          break;
        }

        const subscription = subResult.rows[0];

        // Create payment record
        await pool.query(
          `INSERT INTO payments
           (user_id, stripe_payment_intent_id, subscription_id, amount, currency, status, payment_method)
           VALUES ($1, $2, $3, $4, $5, 'succeeded', $6)
           ON CONFLICT (stripe_payment_intent_id) DO NOTHING`,
          [
            subscription.user_id,
            invoice.payment_intent,
            subscription.id,
            invoice.amount_paid,
            invoice.currency,
            invoice.payment_method_types?.[0] || 'card'
          ]
        );

        // Update subscription period dates
        await pool.query(
          `UPDATE subscriptions
           SET current_period_start = to_timestamp($1),
               current_period_end = to_timestamp($2),
               updated_at = NOW()
           WHERE stripe_subscription_id = $3`,
          [
            invoice.period_start,
            invoice.period_end,
            subscriptionId
          ]
        );

        console.log(`Payment succeeded for subscription: ${subscriptionId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        // Update subscription status to past_due
        await pool.query(
          `UPDATE subscriptions
           SET status = 'past_due', updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subscriptionId]
        );

        console.log(`Payment failed for subscription: ${subscriptionId}`);
        break;
      }

      default:
        console.log(`Unhandled webhook event type: ${event.type}`);
    }

    // Mark event as processed
    await pool.query(
      `UPDATE stripe_webhook_events
       SET processed = true
       WHERE event_id = $1`,
      [event.id]
    );

  } catch (error) {
    console.error('Error processing webhook:', error);
    throw error;
  }
}

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

// SECURITY: Rate limit registration endpoint to prevent spam/bot accounts
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: 'Too many accounts created from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return `register:${req.ip}`;
  },
});

// SECURITY: every endpoint that SENDS an email is capped, so the form can't be used to spam an
// inbox (ours or a stranger's) or burn the Workspace mailbox's daily sending limit.
const emailSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many emails requested. Please wait a while and try again.' },
  keyGenerator: (req) => `email:${String(req.body?.email || req.user?.userId || '').toLowerCase()}:${req.ip}`,
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
    secure: process.env.NODE_ENV === 'production', // the site is HTTPS-only behind Cloudflare
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
// AI is billed to ONE pooled SAI gateway key — there are no per-user API keys
// any more. Metering is the app's own quota system (aiLimiter + checkAIQuota).
// The helpers below keep their call sites stable; they just hand back the
// shared SAI client.
const getUserApiKeysHelper = async (userId) => {
  return {
    openaiKey: null,
    geminiKey: null,
    usingUserKeys: false,
    sai: saiConfigured(),
  };
};

// Kept for call-site stability: every AI endpoint used to demand a per-user key
// and return 403 MISSING_OPENAI_KEY — now the pooled client is always available.
const getUserOpenAI = async (userId) => {
  if (!saiConfigured()) {
    throw new Error('SAI_API_KEY_NOT_CONFIGURED');
  }
  return getSAIClient();
};

const getUserGemini = async (userId) => {
  // Gemini was retired with the SAI API migration; kept so old imports don't break.
  throw new Error('SAI_API_KEY_NOT_CONFIGURED');
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
app.post('/api/auth/register', registrationLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({ error: passwordValidation.error });
    }

    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate email verification token
    const verificationToken = uuidv4();
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24); // 24 hours from now

    // Create user with UUID (secure, non-predictable ID)
    const userId = uuidv4();
    const user = {
      id: userId,
      email,
      name,
      password: hashedPassword,
      createdAt: new Date().toISOString(),
      books: [],
      email_verified: false,
      email_verification_token: verificationToken,
      email_verification_token_expires: verificationExpires.toISOString()
    };

    // Store user data - use the returned user to get the actual DB-assigned ID
    const createdUser = await createUser(user);
    const actualUserId = createdUser?.id || userId;

    // Log verification email sent
    try {
      await getPool().query(
        `INSERT INTO email_verification_log (user_id, email, action, token, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [actualUserId, email, 'sent', verificationToken, req.ip, req.get('user-agent')]
      );
    } catch (err) {
      console.error('Failed to log verification action:', err);
    }

    // Send verification email (non-blocking - don't fail registration if email fails)
    try {
      await sendVerificationEmail(email, name, verificationToken);
    } catch (err) {
      console.error('Failed to send verification email:', err);
      // Continue with registration even if email fails
    }

    // Generate JWT token using the actual DB user ID
    const token = jwt.sign({ userId: actualUserId, email }, JWT_SECRET, { expiresIn: '7d' });

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // the site is HTTPS-only behind Cloudflare
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      user: {
        id: actualUserId,
        email: user.email,
        name: user.name,
        role: 'user',
        tier: 'free',
        status: 'active',
        emailVerified: false,
        books: []
      },
      token,
      message: 'Registration successful! Please check your email to verify your account.'
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

// Helper function to log user activities
async function logUserActivity(userId, activityType, details = {}, req) {
  try {
    const ip = req?.ip || req?.connection?.remoteAddress || null;
    const userAgent = req?.get?.('user-agent') || null;

    await getPool().query(
      `INSERT INTO user_activity_log (user_id, activity_type, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, activityType, JSON.stringify(details), ip, userAgent]
    );
  } catch (error) {
    console.error('Error logging user activity:', error);
    // Don't fail the operation if logging fails
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
      secure: process.env.NODE_ENV === 'production', // the site is HTTPS-only behind Cloudflare
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
        emailVerified: !!(user.email_verified ?? user.emailVerified),
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
      emailVerified: !!(req.user.email_verified ?? req.user.emailVerified),
      books: req.user.books,
      createdAt: req.user.createdAt
    }
  });
});

// Get user quotas
app.get('/api/quotas', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const quotas = await getUserQuotas(userId);
    res.json(quotas);
  } catch (error) {
    console.error('Error fetching quotas:', error);
    res.status(500).json({ error: 'Failed to fetch quotas' });
  }
});

// Request password reset
app.post('/api/auth/forgot-password', emailSendLimiter, async (req, res) => {
  const generic = { message: 'If an account exists with this email, you will receive password reset instructions.' };
  try {
    const email = String(req.body?.email || '').trim();

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Get user by email
    const user = await getUserByEmail(email);
    if (!user) {
      // Don't reveal if user exists
      return res.json(generic);
    }

    // Generate secure reset token with UUID
    const resetToken = uuidv4();

    // Store reset token in Redis with 1 hour expiration
    await setPasswordResetToken(resetToken, user.id, 3600);

    try {
      await sendPasswordResetEmail(user.email, user.name, resetToken);
    } catch (err) {
      // Same answer either way: the response must not reveal whether the address has an account.
      console.error('Password reset email failed:', err.message);
    }

    res.json({
      ...generic,
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

    const strength = validatePassword(newPassword);
    if (!strength.isValid) {
      return res.status(400).json({ error: strength.error });
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

    sendPasswordChangedEmail(user.email, user.name).catch((err) => console.error('Password-changed notice failed:', err.message));

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

    const strength = validatePassword(newPassword);
    if (!strength.isValid) {
      return res.status(400).json({ error: strength.error });
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

    console.log(`Password changed for user ${userId}`);
    sendPasswordChangedEmail(user.email, user.name).catch((err) => console.error('Password-changed notice failed:', err.message));

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ============ EMAIL VERIFICATION ROUTES ============

// Verify email with token
app.post('/api/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    // Verify the token and update user
    const result = await getPool().query(
      `UPDATE users
       SET email_verified = true,
           email_verification_token = NULL,
           email_verification_token_expires = NULL,
           updated_at = NOW()
       WHERE email_verification_token = $1
         AND email_verification_token_expires > NOW()
         AND email_verified = false
       RETURNING id, email, name`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    const user = result.rows[0];

    // Log verification
    await getPool().query(
      `INSERT INTO email_verification_log (user_id, email, action, token, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, user.email, 'verified', token, req.ip, req.get('user-agent')]
    );

    // Send welcome email
    try {
      await sendWelcomeEmail(user.email, user.name);
    } catch (err) {
      console.error('Failed to send welcome email:', err);
    }

    res.json({
      message: 'Email verified successfully!',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: true
      }
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// Resend verification email
app.post('/api/auth/resend-verification', authenticateToken, emailSendLimiter, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get user
    const user = await getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already verified
    const pgUser = await getPool().query(
      'SELECT email_verified FROM users WHERE id = $1',
      [userId]
    );

    if (pgUser.rows[0]?.email_verified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    // Generate new verification token
    const verificationToken = uuidv4();
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24);

    // Update user with new token
    await getPool().query(
      `UPDATE users
       SET email_verification_token = $1,
           email_verification_token_expires = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [verificationToken, verificationExpires, userId]
    );

    // Log resend action
    await getPool().query(
      `INSERT INTO email_verification_log (user_id, email, action, token, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, user.email, 'resent', verificationToken, req.ip, req.get('user-agent')]
    );

    // Send verification email
    try {
      await sendVerificationEmail(user.email, user.name, verificationToken);
      res.json({ message: 'Verification email sent! Please check your inbox.' });
    } catch (err) {
      console.error('Failed to send verification email:', err);
      res.status(500).json({ error: 'Failed to send verification email' });
    }
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

// ============ USER SUBSCRIPTION ROUTES (Protected) ============

// POST /api/subscriptions/checkout - Create Stripe checkout session
app.post('/api/subscriptions/checkout',
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { tier } = req.body;

      // Validate tier
      if (!tier || !['basic', 'premium'].includes(tier)) {
        return res.status(400).json({ error: 'Invalid tier. Must be basic or premium.' });
      }

      // Check if user already has an active subscription
      const existingSubResult = await getPool().query(
        `SELECT id, status FROM subscriptions WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );

      if (existingSubResult.rows.length > 0) {
        return res.status(400).json({ error: 'You already have an active subscription.' });
      }

      // Get user details
      const userResult = await getPool().query(
        'SELECT email, name FROM users WHERE id = $1',
        [userId]
      );
      const user = userResult.rows[0];

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get or create Stripe customer
      let customerId;
      const customerResult = await getPool().query(
        `SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );

      if (customerResult.rows.length > 0 && customerResult.rows[0].stripe_customer_id) {
        customerId = customerResult.rows[0].stripe_customer_id;
      } else {
        // Create new Stripe customer
        const customer = await stripeService.createCustomer(user.email, user.name);
        customerId = customer.id;
      }

      // Get price ID for tier
      const priceId = stripeService.getPriceIdForTier(tier);

      // Create checkout session
      const successUrl = `${req.headers.origin || 'https://story-writing.com'}/profile?tab=quotas&checkout=success`;
      const cancelUrl = `${req.headers.origin || 'https://story-writing.com'}/profile?tab=quotas&checkout=canceled`;

      const session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        tier,
        successUrl,
        cancelUrl,
        { user_id: userId }
      );

      res.json({
        sessionId: session.id,
        url: session.url
      });
    } catch (error) {
      console.error('Checkout error:', error);
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  }
);

// GET /api/subscriptions/my - Get current user's subscription
app.get('/api/subscriptions/my',
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.userId;

      const result = await getPool().query(
        `SELECT id, tier, status, current_period_start, current_period_end,
                cancel_at_period_end, canceled_at, stripe_subscription_id
         FROM subscriptions
         WHERE user_id = $1 AND status IN ('active', 'canceled')
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return res.json({
          has_subscription: false,
          subscription: null
        });
      }

      const subscription = result.rows[0];

      res.json({
        has_subscription: subscription.status === 'active',
        subscription: {
          tier: subscription.tier,
          status: subscription.status,
          current_period_start: subscription.current_period_start,
          current_period_end: subscription.current_period_end,
          cancel_at_period_end: subscription.cancel_at_period_end,
          canceled_at: subscription.canceled_at
        }
      });
    } catch (error) {
      console.error('Get subscription error:', error);
      res.status(500).json({ error: 'Failed to get subscription' });
    }
  }
);

// POST /api/subscriptions/cancel - Cancel current user's subscription
app.post('/api/subscriptions/cancel',
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.userId;

      // Get active subscription
      const subResult = await getPool().query(
        `SELECT id, stripe_subscription_id, current_period_end FROM subscriptions
         WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );

      if (subResult.rows.length === 0) {
        return res.status(404).json({ error: 'No active subscription found' });
      }

      const subscription = subResult.rows[0];

      // Cancel in Stripe (at period end)
      await stripeService.cancelSubscription(subscription.stripe_subscription_id, false);

      // Update database
      await getPool().query(
        `UPDATE subscriptions SET cancel_at_period_end = true WHERE id = $1`,
        [subscription.id]
      );

      res.json({
        message: 'Subscription will be canceled at the end of the current billing period',
        period_end: subscription.current_period_end
      });
    } catch (error) {
      console.error('Cancel subscription error:', error);
      res.status(500).json({ error: 'Failed to cancel subscription' });
    }
  }
);

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

// Bulk update user status
app.post('/api/admin/users/bulk/status',
  authenticateToken,
  requireAdmin,
  preventSelfModification,
  async (req, res) => {
    try {
      const { userIds, status, reason } = req.body;

      // Validate inputs
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds array required' });
      }

      if (!['active', 'suspended', 'banned'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const results = [];
      const errors = [];

      for (const userId of userIds) {
        try {
          await UserRepository.updateStatus(userId, status, req.user.userId, reason);
          results.push({ userId, success: true });
        } catch (error) {
          errors.push({ userId, error: error.message });
        }
      }

      res.json({
        message: `Bulk status update completed`,
        results,
        errors,
        summary: {
          total: userIds.length,
          successful: results.length,
          failed: errors.length
        }
      });
    } catch (error) {
      console.error('Bulk status update error:', error);
      res.status(500).json({ error: 'Bulk operation failed' });
    }
  }
);

// Bulk update user tier
app.post('/api/admin/users/bulk/tier',
  authenticateToken,
  requireAdmin,
  preventSelfModification,
  async (req, res) => {
    try {
      const { userIds, tier } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds array required' });
      }

      if (!['free', 'basic', 'premium'].includes(tier)) {
        return res.status(400).json({ error: 'Invalid tier' });
      }

      const results = [];
      const errors = [];

      for (const userId of userIds) {
        try {
          await UserRepository.updateTier(userId, tier, req.user.userId);
          results.push({ userId, success: true });
        } catch (error) {
          errors.push({ userId, error: error.message });
        }
      }

      res.json({
        message: `Bulk tier update completed`,
        results,
        errors,
        summary: {
          total: userIds.length,
          successful: results.length,
          failed: errors.length
        }
      });
    } catch (error) {
      console.error('Bulk tier update error:', error);
      res.status(500).json({ error: 'Bulk operation failed' });
    }
  }
);

// Get user quotas for editing
app.get('/api/admin/users/:userId/quotas',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const quotas = await getUserQuotas(userId);
      res.json(quotas);
    } catch (error) {
      console.error('Error fetching user quotas:', error);
      res.status(500).json({ error: 'Failed to fetch quotas' });
    }
  }
);

// Update custom quotas for a user
app.put('/api/admin/users/:userId/quotas',
  authenticateToken,
  requireAdmin,
  preventSelfModification,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const {
        max_books,
        max_words,
        max_chapters,
        max_ai_requests_per_day,
        max_concurrent_jobs
      } = req.body;

      // Validate all are positive integers
      const values = [max_books, max_words, max_chapters, max_ai_requests_per_day, max_concurrent_jobs];
      if (values.some(v => typeof v !== 'number' || v < 0)) {
        return res.status(400).json({ error: 'All quota values must be positive numbers' });
      }

      const result = await getPool().query(
        `UPDATE quotas
         SET max_books = $1, max_words = $2, max_chapters = $3,
             max_ai_requests_per_day = $4, max_concurrent_jobs = $5,
             custom_quotas = true, updated_at = NOW()
         WHERE user_id = $6
         RETURNING *`,
        [max_books, max_words, max_chapters, max_ai_requests_per_day, max_concurrent_jobs, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Log admin action
      await getPool().query(
        `INSERT INTO admin_audit_log (admin_id, action, target_user_id, changes)
         VALUES ($1, $2, $3, $4)`,
        [req.user.userId, 'quota_change', userId, JSON.stringify({
          max_books, max_words, max_chapters, max_ai_requests_per_day, max_concurrent_jobs
        })]
      );

      res.json({
        message: 'Custom quotas updated',
        quotas: result.rows[0]
      });
    } catch (error) {
      console.error('Error updating quotas:', error);
      res.status(500).json({ error: 'Failed to update quotas' });
    }
  }
);

// Reset quotas to tier defaults
app.delete('/api/admin/users/:userId/quotas',
  authenticateToken,
  requireAdmin,
  preventSelfModification,
  async (req, res) => {
    try {
      const { userId } = req.params;

      // Get user's tier
      const userResult = await getPool().query(
        `SELECT tier FROM users WHERE id = $1`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const tier = userResult.rows[0].tier;
      const tierQuotas = getTierQuotas(tier);

      // Reset to tier defaults
      const result = await getPool().query(
        `UPDATE quotas
         SET max_books = $1, max_words = $2, max_chapters = $3,
             max_ai_requests_per_day = $4, max_concurrent_jobs = $5,
             custom_quotas = false, updated_at = NOW()
         WHERE user_id = $6
         RETURNING *`,
        [
          tierQuotas.max_books,
          tierQuotas.max_words,
          tierQuotas.max_chapters,
          tierQuotas.max_ai_requests_per_day,
          tierQuotas.max_concurrent_jobs,
          userId
        ]
      );

      // Log admin action
      await getPool().query(
        `INSERT INTO admin_audit_log (admin_id, action, target_user_id, changes)
         VALUES ($1, $2, $3, $4)`,
        [req.user.userId, 'quota_reset', userId, JSON.stringify({ tier })]
      );

      res.json({
        message: 'Quotas reset to tier defaults',
        quotas: result.rows[0]
      });
    } catch (error) {
      console.error('Error resetting quotas:', error);
      res.status(500).json({ error: 'Failed to reset quotas' });
    }
  }
);

// User-facing: Flag content for moderation
app.post('/api/content/flag',
  authenticateToken,
  async (req, res) => {
    try {
      const { content_type, content_id, reason } = req.body;

      if (!['book', 'chapter'].includes(content_type)) {
        return res.status(400).json({ error: 'Invalid content type' });
      }

      if (!content_id || !reason) {
        return res.status(400).json({ error: 'content_id and reason required' });
      }

      // Check if content exists
      let exists;
      if (content_type === 'book') {
        const result = await getPool().query(
          `SELECT id FROM books WHERE id = $1 AND deleted_at IS NULL`,
          [content_id]
        );
        exists = result.rows.length > 0;
      } else {
        const result = await getPool().query(
          `SELECT id FROM chapters WHERE id = $1`,
          [content_id]
        );
        exists = result.rows.length > 0;
      }

      if (!exists) {
        return res.status(404).json({ error: 'Content not found' });
      }

      // Check if user already flagged this content
      const existingFlag = await getPool().query(
        `SELECT id FROM content_flags
         WHERE content_type = $1 AND content_id = $2 AND flagged_by_user_id = $3`,
        [content_type, content_id, req.user.userId]
      );

      if (existingFlag.rows.length > 0) {
        return res.status(400).json({ error: 'You have already flagged this content' });
      }

      // Create flag
      const result = await getPool().query(
        `INSERT INTO content_flags (content_type, content_id, flagged_by_user_id, reason, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING *`,
        [content_type, content_id, req.user.userId, reason]
      );

      res.json({
        message: 'Content flagged for review',
        flag: result.rows[0]
      });
    } catch (error) {
      console.error('Error flagging content:', error);
      res.status(500).json({ error: 'Failed to flag content' });
    }
  }
);

// Admin: Get flagged content
app.get('/api/admin/content-flags',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { page = 1, limit = 50, status, content_type } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let whereConditions = '';
      const params = [];
      let paramCount = 1;

      if (status) {
        whereConditions += ` AND cf.status = $${paramCount}`;
        params.push(status);
        paramCount++;
      }

      if (content_type) {
        whereConditions += ` AND cf.content_type = $${paramCount}`;
        params.push(content_type);
        paramCount++;
      }

      // Get total count
      const countQuery = `
        SELECT COUNT(*)
        FROM content_flags cf
        WHERE 1=1${whereConditions}
      `;
      const countResult = await getPool().query(countQuery, params);
      const total = parseInt(countResult.rows[0].count);

      // Get flags with user and content details
      const query = `
        SELECT
          cf.*,
          fu.name as flagged_by_name,
          fu.email as flagged_by_email,
          ru.name as reviewed_by_name,
          ru.email as reviewed_by_email,
          CASE
            WHEN cf.content_type = 'book' THEN b.title
            WHEN cf.content_type = 'chapter' THEN c.title
          END as content_title
        FROM content_flags cf
        LEFT JOIN users fu ON cf.flagged_by_user_id = fu.id
        LEFT JOIN users ru ON cf.reviewed_by_admin_id = ru.id
        LEFT JOIN books b ON cf.content_type = 'book' AND cf.content_id = b.id
        LEFT JOIN chapters c ON cf.content_type = 'chapter' AND cf.content_id = c.id
        WHERE 1=1${whereConditions}
        ORDER BY cf.created_at DESC
        LIMIT $${paramCount} OFFSET $${paramCount + 1}
      `;

      params.push(parseInt(limit), offset);
      const result = await getPool().query(query, params);

      res.json({
        flags: result.rows,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Error fetching content flags:', error);
      res.status(500).json({ error: 'Failed to fetch content flags' });
    }
  }
);

// Admin: Review flagged content
app.put('/api/admin/content-flags/:flagId',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { flagId } = req.params;
      const { status, admin_notes } = req.body;

      if (!['reviewed', 'dismissed', 'action_taken'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const result = await getPool().query(
        `UPDATE content_flags
         SET status = $1, admin_notes = $2, reviewed_by_admin_id = $3, reviewed_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [status, admin_notes, req.user.userId, flagId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Flag not found' });
      }

      res.json({
        message: 'Flag reviewed',
        flag: result.rows[0]
      });
    } catch (error) {
      console.error('Error reviewing flag:', error);
      res.status(500).json({ error: 'Failed to review flag' });
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

    // Build WHERE clause conditions
    let whereConditions = '';
    const params = [];
    let paramCount = 1;

    if (userId) {
      whereConditions += ` AND lh.user_id = $${paramCount}`;
      params.push(userId);
      paramCount++;
    }

    if (success !== undefined) {
      whereConditions += ` AND lh.success = $${paramCount}`;
      params.push(success === 'true');
      paramCount++;
    }

    if (email) {
      whereConditions += ` AND lh.email ILIKE $${paramCount}`;
      params.push(`%${email}%`);
      paramCount++;
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*)
      FROM login_history lh
      LEFT JOIN users u ON lh.user_id = u.id
      WHERE 1=1${whereConditions}
    `;
    const countResult = await getPool().query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Build main query
    const query = `
      SELECT
        lh.*,
        u.name as user_name,
        u.email as user_email
      FROM login_history lh
      LEFT JOIN users u ON lh.user_id = u.id
      WHERE 1=1${whereConditions}
      ORDER BY lh.login_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    // Add pagination params
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

// Get user activity log (admin only, paginated)
app.get('/api/admin/user-activity', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, userId, activityType } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build WHERE clause conditions
    let whereConditions = '';
    const params = [];
    let paramCount = 1;

    if (userId) {
      whereConditions += ` AND ual.user_id = $${paramCount}`;
      params.push(userId);
      paramCount++;
    }

    if (activityType) {
      whereConditions += ` AND ual.activity_type = $${paramCount}`;
      params.push(activityType);
      paramCount++;
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*)
      FROM user_activity_log ual
      LEFT JOIN users u ON ual.user_id = u.id
      WHERE 1=1${whereConditions}
    `;
    const countResult = await getPool().query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Build main query
    const query = `
      SELECT
        ual.*,
        u.name as user_name,
        u.email as user_email
      FROM user_activity_log ual
      LEFT JOIN users u ON ual.user_id = u.id
      WHERE 1=1${whereConditions}
      ORDER BY ual.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    // Add pagination params
    params.push(parseInt(limit), offset);

    const result = await getPool().query(query, params);

    res.json({
      activities: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({ error: 'Failed to fetch user activity' });
  }
});

// Get user activity for a specific user (admin only)
app.get('/api/admin/users/:userId/activity', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20 } = req.query;

    const result = await getPool().query(
      `SELECT * FROM user_activity_log
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, parseInt(limit)]
    );

    res.json({ activities: result.rows });
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({ error: 'Failed to fetch user activity' });
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

// ============ SUBSCRIPTION MANAGEMENT ROUTES (Admin) ============

// Get all subscriptions with filtering
app.get('/api/admin/subscriptions',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { page = 1, limit = 20, status, tier, search } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let whereConditions = '';
      const params = [];
      let paramCount = 1;

      if (status) {
        whereConditions += ` AND s.status = $${paramCount}`;
        params.push(status);
        paramCount++;
      }

      if (tier) {
        whereConditions += ` AND s.tier = $${paramCount}`;
        params.push(tier);
        paramCount++;
      }

      if (search) {
        whereConditions += ` AND (u.email ILIKE $${paramCount} OR u.name ILIKE $${paramCount})`;
        params.push(`%${search}%`);
        paramCount++;
      }

      // Get total count
      const countQuery = `
        SELECT COUNT(*)
        FROM subscriptions s
        JOIN users u ON u.id = s.user_id
        WHERE 1=1${whereConditions}
      `;
      const countResult = await getPool().query(countQuery, params);
      const total = parseInt(countResult.rows[0].count);

      // Get subscriptions
      const query = `
        SELECT
          s.*,
          u.email as user_email,
          u.name as user_name,
          CASE
            WHEN s.tier = 'basic' THEN 999
            WHEN s.tier = 'premium' THEN 1999
            ELSE 0
          END as amount
        FROM subscriptions s
        JOIN users u ON u.id = s.user_id
        WHERE 1=1${whereConditions}
        ORDER BY s.created_at DESC
        LIMIT $${paramCount} OFFSET $${paramCount + 1}
      `;

      params.push(parseInt(limit), offset);
      const result = await getPool().query(query, params);

      res.json({
        subscriptions: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
      res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
  }
);

// Get subscription details
app.get('/api/admin/subscriptions/:subscriptionId',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { subscriptionId } = req.params;

      const subQuery = `
        SELECT
          s.*,
          u.id as user_id,
          u.email as user_email,
          u.name as user_name
        FROM subscriptions s
        JOIN users u ON u.id = s.user_id
        WHERE s.id = $1
      `;
      const subResult = await getPool().query(subQuery, [subscriptionId]);

      if (subResult.rows.length === 0) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      const subscription = subResult.rows[0];

      // Get payment history
      const paymentsQuery = `
        SELECT *
        FROM payments
        WHERE subscription_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `;
      const paymentsResult = await getPool().query(paymentsQuery, [subscriptionId]);

      res.json({
        subscription,
        payments: paymentsResult.rows
      });
    } catch (error) {
      console.error('Error fetching subscription:', error);
      res.status(500).json({ error: 'Failed to fetch subscription' });
    }
  }
);

// Cancel subscription (admin)
app.post('/api/admin/subscriptions/:subscriptionId/cancel',
  authenticateToken,
  requireAdmin,
  preventSelfModification,
  async (req, res) => {
    try {
      const { subscriptionId } = req.params;
      const { immediately = false, reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: 'Cancellation reason is required' });
      }

      // Get subscription
      const subResult = await getPool().query(
        'SELECT * FROM subscriptions WHERE id = $1',
        [subscriptionId]
      );

      if (subResult.rows.length === 0) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      const subscription = subResult.rows[0];

      // Cancel in Stripe
      await stripeService.cancelSubscription(subscription.stripe_subscription_id, immediately);

      // Update database
      if (immediately) {
        await getPool().query(
          `UPDATE subscriptions
           SET status = 'canceled', canceled_at = NOW(),
               cancellation_reason = $1, canceled_by_admin_id = $2, updated_at = NOW()
           WHERE id = $3`,
          [reason, req.user.userId, subscriptionId]
        );

        // Downgrade user to free tier
        await getPool().query(
          'UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2',
          ['free', subscription.user_id]
        );
      } else {
        await getPool().query(
          `UPDATE subscriptions
           SET cancel_at_period_end = true,
               cancellation_reason = $1, canceled_by_admin_id = $2, updated_at = NOW()
           WHERE id = $3`,
          [reason, req.user.userId, subscriptionId]
        );
      }

      // Log action
      await getPool().query(
        `INSERT INTO admin_audit_log (admin_id, action, target_user_id, changes)
         VALUES ($1, $2, $3, $4)`,
        [
          req.user.userId,
          'cancel_subscription',
          subscription.user_id,
          JSON.stringify({ immediately, reason, subscription_id: subscriptionId })
        ]
      );

      res.json({
        message: immediately
          ? 'Subscription canceled immediately'
          : 'Subscription will be canceled at period end',
        subscription: { ...subscription, cancel_at_period_end: !immediately }
      });
    } catch (error) {
      console.error('Error canceling subscription:', error);
      res.status(500).json({ error: 'Failed to cancel subscription' });
    }
  }
);

// Get all payments with filtering
app.get('/api/admin/payments',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { page = 1, limit = 20, status, user_id, start_date, end_date } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let whereConditions = '';
      const params = [];
      let paramCount = 1;

      if (status) {
        whereConditions += ` AND p.status = $${paramCount}`;
        params.push(status);
        paramCount++;
      }

      if (user_id) {
        whereConditions += ` AND p.user_id = $${paramCount}`;
        params.push(user_id);
        paramCount++;
      }

      if (start_date) {
        whereConditions += ` AND p.created_at >= $${paramCount}`;
        params.push(start_date);
        paramCount++;
      }

      if (end_date) {
        whereConditions += ` AND p.created_at <= $${paramCount}`;
        params.push(end_date);
        paramCount++;
      }

      // Get total count
      const countQuery = `
        SELECT COUNT(*)
        FROM payments p
        WHERE 1=1${whereConditions}
      `;
      const countResult = await getPool().query(countQuery, params);
      const total = parseInt(countResult.rows[0].count);

      // Get payments
      const query = `
        SELECT
          p.*,
          u.email as user_email,
          u.name as user_name
        FROM payments p
        JOIN users u ON u.id = p.user_id
        WHERE 1=1${whereConditions}
        ORDER BY p.created_at DESC
        LIMIT $${paramCount} OFFSET $${paramCount + 1}
      `;

      params.push(parseInt(limit), offset);
      const result = await getPool().query(query, params);

      res.json({
        payments: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Error fetching payments:', error);
      res.status(500).json({ error: 'Failed to fetch payments' });
    }
  }
);

// ============ REVENUE ANALYTICS ROUTES (Admin) ============

// Get revenue analytics
app.get('/api/admin/analytics/revenue',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { start_date, end_date, granularity = 'day' } = req.query;

      // Parse dates
      const startDate = start_date
        ? new Date(start_date)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days ago
      const endDate = end_date ? new Date(end_date) : new Date();

      // Calculate metrics in parallel
      const [mrr, churn, ltv, timeSeries, periodStats] = await Promise.all([
        revenueAnalytics.calculateMRR(),
        revenueAnalytics.calculateChurnRate('monthly'),
        revenueAnalytics.calculateLTV(),
        revenueAnalytics.getRevenueTimeSeries(startDate, endDate, granularity),
        revenueAnalytics.getPeriodStats(startDate, endDate)
      ]);

      // Calculate total revenue for the period
      const totalRevenuePeriod = timeSeries.reduce((sum, t) => sum + t.revenue, 0);

      res.json({
        summary: {
          mrr: mrr.total_mrr,
          mrr_by_tier: mrr.by_tier,
          active_subscribers: ltv.active_subscribers,
          churn_rate: churn.churn_rate,
          ltv: ltv.ltv,
          total_revenue_period: totalRevenuePeriod
        },
        time_series: timeSeries,
        new_subscriptions: periodStats.new_subscriptions,
        canceled_subscriptions: periodStats.canceled_subscriptions,
        upgrades: periodStats.upgrades,
        downgrades: periodStats.downgrades
      });
    } catch (error) {
      console.error('Revenue analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch revenue analytics' });
    }
  }
);

// GET /api/admin/analytics/engagement - Get user engagement analytics
app.get('/api/admin/analytics/engagement',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { start_date, end_date, granularity = 'day' } = req.query;

      // Parse dates
      const startDate = start_date
        ? new Date(start_date)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days ago
      const endDate = end_date ? new Date(end_date) : new Date();

      // Calculate metrics in parallel
      const [
        activeUsers,
        sessionMetrics,
        activityBreakdown,
        activityTimeSeries,
        newUsersTimeSeries,
        totalUsers,
        activeLast7d,
        activeLast30d
      ] = await Promise.all([
        engagementAnalytics.calculateActiveUsers(),
        engagementAnalytics.calculateSessionMetrics(),
        engagementAnalytics.getActivityBreakdown(startDate, endDate),
        engagementAnalytics.getActivityTimeSeries(startDate, endDate, granularity),
        engagementAnalytics.getNewUsersTimeSeries(startDate, endDate, granularity),
        engagementAnalytics.getTotalUsers(),
        engagementAnalytics.getActiveUsersInPeriod(7),
        engagementAnalytics.getActiveUsersInPeriod(30)
      ]);

      // Merge time series data (activity + new users)
      const timeSeriesMap = new Map();

      activityTimeSeries.forEach(item => {
        const dateKey = new Date(item.date).toISOString();
        timeSeriesMap.set(dateKey, {
          date: item.date,
          active_users: item.active_users,
          total_actions: item.total_actions,
          new_users: 0
        });
      });

      newUsersTimeSeries.forEach(item => {
        const dateKey = new Date(item.date).toISOString();
        if (timeSeriesMap.has(dateKey)) {
          timeSeriesMap.get(dateKey).new_users = item.new_users;
        } else {
          timeSeriesMap.set(dateKey, {
            date: item.date,
            active_users: 0,
            total_actions: 0,
            new_users: item.new_users
          });
        }
      });

      const timeSeries = Array.from(timeSeriesMap.values()).sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );

      res.json({
        summary: {
          total_users: totalUsers,
          active_last_7d: activeLast7d,
          active_last_30d: activeLast30d,
          dau: activeUsers.dau,
          wau: activeUsers.wau,
          mau: activeUsers.mau,
          dau_mau_ratio: activeUsers.dau_mau_ratio,
          avg_sessions_per_user: sessionMetrics.avg_sessions_per_user,
          avg_actions_per_session: sessionMetrics.avg_actions_per_session
        },
        activity_breakdown: activityBreakdown,
        time_series: timeSeries
      });
    } catch (error) {
      console.error('Engagement analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch engagement analytics' });
    }
  }
);

// ============ AI COST TRACKING ENDPOINTS ============

// GET /api/admin/analytics/ai-costs - Get system-wide AI cost analytics (admin only)
app.get('/api/admin/analytics/ai-costs',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { start_date, end_date } = req.query;

      // Default to last 30 days
      const endDate = end_date || new Date().toISOString().split('T')[0];
      const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const analytics = await costTracking.getSystemCostAnalytics(startDate, endDate);

      res.json({
        summary: analytics.summary,
        daily_stats: analytics.dailyStats
      });
    } catch (error) {
      console.error('AI cost analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch AI cost analytics' });
    }
  }
);

// GET /api/admin/analytics/top-users-by-cost - Get top users by AI costs (admin only)
app.get('/api/admin/analytics/top-users-by-cost',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { days = 30, limit = 20 } = req.query;

      const topUsers = await costTracking.getTopUsersByCost(parseInt(days), parseInt(limit));

      res.json({ topUsers });
    } catch (error) {
      console.error('Top users by cost error:', error);
      res.status(500).json({ error: 'Failed to fetch top users by cost' });
    }
  }
);

// GET /api/admin/analytics/cost-by-model - Get cost breakdown by AI model (admin only)
app.get('/api/admin/analytics/cost-by-model',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { days = 30 } = req.query;

      const modelBreakdown = await costTracking.getCostByModel(parseInt(days));

      res.json({ modelBreakdown });
    } catch (error) {
      console.error('Cost by model error:', error);
      res.status(500).json({ error: 'Failed to fetch cost breakdown by model' });
    }
  }
);

// GET /api/users/ai-costs - Get user's own AI cost history
app.get('/api/users/ai-costs', authenticateToken, async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [dailyHistory, monthTotals] = await Promise.all([
      costTracking.getUserCostSummary(req.user.userId, startDate, endDate),
      costTracking.getUserMonthTotals(req.user.userId)
    ]);

    res.json({
      dailyHistory,
      monthToDate: monthTotals
    });
  } catch (error) {
    console.error('User AI costs error:', error);
    res.status(500).json({ error: 'Failed to fetch AI costs' });
  }
});

// GET /api/users/ai-costs/by-tool - Get user's cost breakdown by tool type
app.get('/api/users/ai-costs/by-tool', authenticateToken, async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const toolBreakdown = await costTracking.getUserCostByTool(req.user.userId, parseInt(days));

    res.json({ toolBreakdown });
  } catch (error) {
    console.error('User cost by tool error:', error);
    res.status(500).json({ error: 'Failed to fetch cost breakdown by tool' });
  }
});

// ============ CSV EXPORT ENDPOINTS ============

// GET /api/admin/export/users - Export users to CSV
app.get('/api/admin/export/users',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { tier, status, search } = req.query;

      // Build query
      let query = 'SELECT id, name, email, tier, status, created_at FROM users WHERE 1=1';
      const params = [];
      let paramCount = 1;

      if (tier) {
        query += ` AND tier = $${paramCount}`;
        params.push(tier);
        paramCount++;
      }

      if (status) {
        query += ` AND status = $${paramCount}`;
        params.push(status);
        paramCount++;
      }

      if (search) {
        query += ` AND (email ILIKE $${paramCount} OR name ILIKE $${paramCount})`;
        params.push(`%${search}%`);
        paramCount++;
      }

      query += ' ORDER BY created_at DESC LIMIT 10000';

      const result = await getPool().query(query, params);

      // Format data for CSV
      const csvData = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        email: row.email,
        tier: row.tier,
        status: row.status,
        created_at: formatDateForCSV(row.created_at)
      }));

      const headers = ['id', 'name', 'email', 'tier', 'status', 'created_at'];
      const csv = toCSV(csvData, headers);

      setCSVHeaders(res, `users-export-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csv);

      // Log export action
      await getPool().query(
        `INSERT INTO admin_audit_log (admin_id, action, target_resource_type, changes)
         VALUES ($1, $2, $3, $4)`,
        [req.user.userId, 'export_users', 'users', JSON.stringify({ count: result.rows.length, filters: { tier, status, search } })]
      );
    } catch (error) {
      console.error('Export users error:', error);
      res.status(500).json({ error: 'Failed to export users' });
    }
  }
);

// GET /api/admin/export/payments - Export payments to CSV
app.get('/api/admin/export/payments',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { start_date, end_date, status, user_id } = req.query;

      let query = `
        SELECT p.id, p.user_id, u.email as user_email, u.name as user_name,
               p.amount, p.currency, p.status, p.payment_method, p.stripe_payment_intent_id,
               p.created_at
        FROM payments p
        JOIN users u ON u.id = p.user_id
        WHERE 1=1
      `;
      const params = [];
      let paramCount = 1;

      if (start_date) {
        query += ` AND p.created_at >= $${paramCount}`;
        params.push(new Date(start_date));
        paramCount++;
      }

      if (end_date) {
        query += ` AND p.created_at <= $${paramCount}`;
        params.push(new Date(end_date));
        paramCount++;
      }

      if (status) {
        query += ` AND p.status = $${paramCount}`;
        params.push(status);
        paramCount++;
      }

      if (user_id) {
        query += ` AND p.user_id = $${paramCount}`;
        params.push(user_id);
        paramCount++;
      }

      query += ' ORDER BY p.created_at DESC LIMIT 10000';

      const result = await getPool().query(query, params);

      // Format data for CSV
      const csvData = result.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        user_email: row.user_email,
        user_name: row.user_name,
        amount: (row.amount / 100).toFixed(2), // Convert cents to dollars
        currency: row.currency,
        status: row.status,
        payment_method: row.payment_method,
        stripe_payment_intent_id: row.stripe_payment_intent_id,
        created_at: formatDateForCSV(row.created_at)
      }));

      const headers = ['id', 'user_id', 'user_email', 'user_name', 'amount', 'currency', 'status', 'payment_method', 'stripe_payment_intent_id', 'created_at'];
      const csv = toCSV(csvData, headers);

      setCSVHeaders(res, `payments-export-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csv);

      // Log export action
      await getPool().query(
        `INSERT INTO admin_audit_log (admin_id, action, target_resource_type, changes)
         VALUES ($1, $2, $3, $4)`,
        [req.user.userId, 'export_payments', 'payments', JSON.stringify({ count: result.rows.length })]
      );
    } catch (error) {
      console.error('Export payments error:', error);
      res.status(500).json({ error: 'Failed to export payments' });
    }
  }
);

// GET /api/admin/export/subscriptions - Export subscriptions to CSV
app.get('/api/admin/export/subscriptions',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { status, tier } = req.query;

      let query = `
        SELECT s.id, s.user_id, u.email as user_email, u.name as user_name,
               s.tier, s.status, s.stripe_subscription_id, s.stripe_customer_id,
               s.current_period_start, s.current_period_end, s.cancel_at_period_end,
               s.canceled_at, s.created_at
        FROM subscriptions s
        JOIN users u ON u.id = s.user_id
        WHERE 1=1
      `;
      const params = [];
      let paramCount = 1;

      if (status) {
        query += ` AND s.status = $${paramCount}`;
        params.push(status);
        paramCount++;
      }

      if (tier) {
        query += ` AND s.tier = $${paramCount}`;
        params.push(tier);
        paramCount++;
      }

      query += ' ORDER BY s.created_at DESC LIMIT 10000';

      const result = await getPool().query(query, params);

      // Format data for CSV
      const csvData = result.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        user_email: row.user_email,
        user_name: row.user_name,
        tier: row.tier,
        status: row.status,
        stripe_subscription_id: row.stripe_subscription_id,
        stripe_customer_id: row.stripe_customer_id,
        current_period_start: formatDateForCSV(row.current_period_start),
        current_period_end: formatDateForCSV(row.current_period_end),
        cancel_at_period_end: row.cancel_at_period_end ? 'Yes' : 'No',
        canceled_at: formatDateForCSV(row.canceled_at),
        created_at: formatDateForCSV(row.created_at)
      }));

      const headers = ['id', 'user_id', 'user_email', 'user_name', 'tier', 'status', 'stripe_subscription_id', 'stripe_customer_id', 'current_period_start', 'current_period_end', 'cancel_at_period_end', 'canceled_at', 'created_at'];
      const csv = toCSV(csvData, headers);

      setCSVHeaders(res, `subscriptions-export-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csv);

      // Log export action
      await getPool().query(
        `INSERT INTO admin_audit_log (admin_id, action, target_resource_type, changes)
         VALUES ($1, $2, $3, $4)`,
        [req.user.userId, 'export_subscriptions', 'subscriptions', JSON.stringify({ count: result.rows.length })]
      );
    } catch (error) {
      console.error('Export subscriptions error:', error);
      res.status(500).json({ error: 'Failed to export subscriptions' });
    }
  }
);

// GET /api/admin/export/activity - Export activity logs to CSV
app.get('/api/admin/export/activity',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { start_date, end_date, activity_type, user_id } = req.query;

      let query = `
        SELECT a.id, a.user_id, u.email as user_email, a.activity_type,
               a.details, a.ip_address, a.created_at
        FROM user_activity_log a
        JOIN users u ON u.id = a.user_id
        WHERE 1=1
      `;
      const params = [];
      let paramCount = 1;

      if (start_date) {
        query += ` AND a.created_at >= $${paramCount}`;
        params.push(new Date(start_date));
        paramCount++;
      }

      if (end_date) {
        query += ` AND a.created_at <= $${paramCount}`;
        params.push(new Date(end_date));
        paramCount++;
      }

      if (activity_type) {
        query += ` AND a.activity_type = $${paramCount}`;
        params.push(activity_type);
        paramCount++;
      }

      if (user_id) {
        query += ` AND a.user_id = $${paramCount}`;
        params.push(user_id);
        paramCount++;
      }

      query += ' ORDER BY a.created_at DESC LIMIT 10000';

      const result = await getPool().query(query, params);

      // Format data for CSV
      const csvData = result.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        user_email: row.user_email,
        activity_type: row.activity_type,
        details: typeof row.details === 'object' ? JSON.stringify(row.details) : row.details,
        ip_address: row.ip_address,
        created_at: formatDateForCSV(row.created_at)
      }));

      const headers = ['id', 'user_id', 'user_email', 'activity_type', 'details', 'ip_address', 'created_at'];
      const csv = toCSV(csvData, headers);

      setCSVHeaders(res, `activity-export-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csv);

      // Log export action
      await getPool().query(
        `INSERT INTO admin_audit_log (admin_id, action, target_resource_type, changes)
         VALUES ($1, $2, $3, $4)`,
        [req.user.userId, 'export_activity', 'activity_log', JSON.stringify({ count: result.rows.length })]
      );
    } catch (error) {
      console.error('Export activity error:', error);
      res.status(500).json({ error: 'Failed to export activity logs' });
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
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (generate books with AI pending service config). Please try again later.'
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

    // Create book in database with UUID (the orchestrator produced the payload;
    // the row must be INSERTed first — an UPDATE on a missing row is a silent no-op
    // in PostgreSQL-only mode)
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

    await createBook({
      ...bookData,
      title: bookData.bookTitle || bookData.title || 'Untitled Story',
      description: bookData.overview || bookData.description || '',
    });

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

    // Log activity
    await logUserActivity(req.user.userId, 'book_created', {
      book_id: book.id,
      title: book.title,
      genre: book.genre
    }, req);

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
        status: req.body.status || 'draft',
        custom_focus_areas: req.body.customFocusAreas || []
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
        transcripts: req.body.transcripts,  // was silently dropped — TranscriptsTab lost everything on save
        chapters: req.body.chapters,  // synced in the same transaction as the book row
        status: req.body.status,
        word_count: req.body.wordCount || req.body.word_count,
        chapter_count: req.body.chapterCount || req.body.chapter_count,
        custom_focus_areas: req.body.customFocusAreas
      };

      // Remove undefined fields
      Object.keys(updates).forEach(key => {
        if (updates[key] === undefined) {
          delete updates[key];
        }
      });

      // Optimistic locking on the CLIENT's version: the browser sends the book
      // version it loaded/last-merged; if the server has moved on (another tab,
      // a collaborator, an AI write), the save is refused with 409 and the
      // client can reload — instead of the old behaviour (always expect the
      // server's own version = never conflicts = silent last-write-wins over
      // in-flight edits).
      const expectedVersion = Number.isInteger(req.body.version)
        ? req.body.version
        : existing.version;
      const clientHadVersion = Number.isInteger(req.body.version);

      try {
        var book = await updateBook(id, req.user.userId, updates, expectedVersion);
      } catch (saveError) {
        const code = saveError.code || (saveError.message.includes('CONFLICT') ? 'CONFLICT' : null);
        if (code === 'CONFLICT') {
          const current = await getBook(id);
          return res.status(409).json({
            error: 'This book changed on the server while you were editing.',
            serverVersion: current?.version,
            serverUpdatedAt: current?.updated_at || current?.updatedAt
          });
        }
        if (code === 'FORBIDDEN') {
          return res.status(403).json({ error: 'You do not have permission to edit this book' });
        }
        if (code === 'NOT_FOUND') {
          return res.status(404).json({ error: 'Book not found' });
        }
        throw saveError;
      }

      // A client that sent no version is a legacy client: accept the write but
      // tell it what the current version now is so the NEXT save conflicts
      // correctly. (book.version carries it; the mapper includes it.)
      if (updates.chapters && existing.chapters) {
        // Calculate word count difference
        const oldWordCount = existing.chapters.reduce((sum, ch) => sum + (ch.word_count || ch.wordCount || 0), 0);
        const newWordCount = updates.chapters.reduce((sum, ch) => sum + (ch.word_count || ch.wordCount || 0), 0);
        const wordsWritten = Math.max(0, newWordCount - oldWordCount);

        if (wordsWritten > 0) {
          try {
            // Update today's writing stats
            const today = new Date().toISOString().split('T')[0];
            const statsKey = `user:${req.user.userId}:stats`;
            let stats = await getStats(statsKey);
            if (!stats) {
              stats = { daily: [], goals: {} };
            }

            const todayIndex = stats.daily.findIndex(d => d.date === today);
            if (todayIndex >= 0) {
              stats.daily[todayIndex].wordsWritten = (stats.daily[todayIndex].wordsWritten || 0) + wordsWritten;
              if (!stats.daily[todayIndex].chaptersEdited) {
                stats.daily[todayIndex].chaptersEdited = [];
              }
            } else {
              stats.daily.push({
                date: today,
                wordsWritten,
                timeSpent: 0,
                chaptersEdited: []
              });
            }

            // Keep only last 365 days
            if (stats.daily.length > 365) {
              stats.daily.sort((a, b) => new Date(b.date) - new Date(a.date));
              stats.daily = stats.daily.slice(0, 365);
            }

            await setStats(statsKey, stats);
            console.log(`📝 Tracked ${wordsWritten} words written by user ${req.user.userId}`);
          } catch (error) {
            console.error('Error tracking writing stats:', error);
            // Don't fail the request if stats tracking fails
          }
        }
      }

      // Update user quota usage after book/chapter changes
      await updateQuotaUsage(req.user.userId);

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

    // Log activity before deleting
    await logUserActivity(req.user.userId || req.user.id, 'book_deleted', {
      book_id: id,
      title: book.title,
      genre: book.genre
    }, req);

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

    // Update quota usage after book deletion
    await updateQuotaUsage(req.user.userId || req.user.id);

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

    // Get the pooled SAI client (validates the gateway key exists)
    const userOpenai = await getUserOpenAI(req.user.userId);

    const completion = await userOpenai.chat.completions.create({
      model: SAI_CHAT,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt + contextString }
      ],
      temperature: 0.8,
      max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 16384,
    });

    const responseText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';

    // Extract token usage from OpenAI response
    const usage = completion.usage || {};
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || (promptTokens + completionTokens);

    // Calculate cost
    const model = SAI_CHAT;
    const costData = await costTracking.calculateTextCost(model, promptTokens, completionTokens);

    // Clean the response
    const cleanedText = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const generatedData = extractJSON(cleanedText);

    // Save generation to history database with token usage and cost
    try {
      await getPool().query(`
        INSERT INTO ai_generations
        (user_id, book_id, tool_type, prompt, result, model,
         prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        req.user.userId,
        context?.bookId || null,
        type,
        prompt,
        JSON.stringify(generatedData),
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        costData.totalCost
      ]);

      console.log(`AI Generation tracked: ${totalTokens} tokens, $${costData.totalCost.toFixed(6)} cost`);
    } catch (dbError) {
      console.error('Error saving AI generation to history:', dbError);
      // Don't fail the request if DB save fails
    }

    // Increment AI request counter for quota tracking
    await incrementAICounter(req.user.userId);

    res.json(generatedData);
  } catch (error) {
    console.error('Error generating content:', error);

    if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
      return res.status(503).json({
        error: 'AI unavailable',
        message: 'AI is unavailable right now (use AI features pending service config). Please try again later.'
      });
    }

    res.status(500).json({ error: 'Failed to generate content', details: error.message });
  }
});

// Batch generation endpoint - generate multiple variations
app.post('/api/generate-batch', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const { type, prompt, context, quantity = 3 } = req.body;

    if (!type || !prompt) {
      return res.status(400).json({ error: 'Type and prompt are required' });
    }

    // Validate quantity (2-5)
    const validQuantity = Math.min(Math.max(parseInt(quantity), 2), 5);

    // Check if user has enough AI quota for batch generation
    const quotas = await getUserQuotas(req.user.userId);
    const aiRemaining = quotas.aiRequestsLimit - quotas.aiRequestsUsed;

    if (aiRemaining < validQuantity) {
      return res.status(403).json({
        error: 'Insufficient AI quota',
        message: `Batch generation requires ${validQuantity} AI requests, but you only have ${aiRemaining} remaining.`
      });
    }

    const variations = [];

    // Generate multiple variations
    for (let i = 0; i < validQuantity; i++) {
      try {
        // Add variation number to prompt
        const variationPrompt = `${prompt}\n\n[Generate a unique variation #${i + 1}. Make it distinctly different from other variations while maintaining the core requirements.]`;

        // Reuse the same generation logic from /api/generate
        const response = await fetch(`${process.env.API_URL || 'http://localhost:3001'}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${req.headers.authorization?.split(' ')[1]}`
          },
          body: JSON.stringify({
            type,
            prompt: variationPrompt,
            context
          })
        });

        if (response.ok) {
          const result = await response.json();
          variations.push({
            id: i + 1,
            result
          });
        }
      } catch (error) {
        console.error(`Error generating variation ${i + 1}:`, error);
        variations.push({
          id: i + 1,
          error: 'Failed to generate this variation'
        });
      }
    }

    res.json({ variations });
  } catch (error) {
    console.error('Batch generation error:', error);
    res.status(500).json({ error: 'Failed to generate batch', details: error.message });
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

    // Log activity
    await logUserActivity(req.user.userId, 'ai_request', {
      job_id: jobId,
      type: 'image_generation',
      book_id: bookId,
      image_type: imageType
    }, req);

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

    // Log activity
    await logUserActivity(req.user.userId, 'ai_request', {
      job_id: jobId,
      type: 'audio_generation',
      book_id: bookId,
      chapter_id: chapterId
    }, req);

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
    const { prompt, context, size } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Size is now free-form (the bridge snaps to the model's supported grid);
    // legacy DALL-E sizes still map through.
    const imageSize = ['1024x1024', '1792x1024', '1024x1792'].includes(size) ? size : '1024x1024';

    // Get the pooled SAI client (validates the gateway key exists)
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
        model: SAI_CHAT_FAST,
        messages: [
          {
            role: 'system',
            content: `You are helping enhance image generation prompts for a text-to-image model. Given a user's basic image request and their book context, create a detailed, vivid image prompt that incorporates relevant context details.

Your enhanced prompt should be clear, descriptive, and optimized for image generation. Include:
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

      enhancedPrompt = (promptEnhancement.choices[0].message.content || promptEnhancement.choices[0].message.reasoning_content || promptEnhancement.choices[0].message.reasoning || '').trim();
      console.log('Enhanced prompt:', enhancedPrompt);
    }

    // Step 2: Generate image via the SAI media bridge
    console.log('Generating image via SAI media bridge...');

    const imageResult = await saiImage({
      prompt: enhancedPrompt,
      model: 'flux2-klein-9b',
      size: imageSize,
    });
    const buffer = imageResult.buffer;

    // Upload to MinIO
    const filename = `visual-${Date.now()}-${uuidv4().slice(0, 8)}.png`;
    const uploadResult = await mediaStorage.upload('images', buffer, filename, {
      'x-amz-meta-type': 'generated-visual',
      'x-amz-meta-prompt': (prompt || '').substring(0, 200),
      // Note: No bookId for standalone image generation - backward compatibility only
    }, setMediaBookMapping);
    await recordMediaOwner('images', filename, { ownerId: req.user.id, bookId: req.body?.bookId });

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

    if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
      return res.status(503).json({
        error: 'AI unavailable',
        message: 'AI is unavailable right now (use AI features pending service config). Please try again later.'
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
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (parse transcripts pending service config). Please try again later.'
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
      model: SAI_CHAT,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Transcript:\n\n${transcript}` }
      ],
      temperature: 0.5,
      max_tokens: 6000,
    });

    const responseText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
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

    // Get the pooled SAI client (validates the gateway key exists)
    try {
      await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (generate character references pending service config). Please try again later.'
        });
      }
      throw error;
    }

    console.log(`Generating reference image for character: ${character.name}`);

    // Build detailed character description
    const characterPrompt = `${style}, character reference sheet, multiple angles, full body portrait of ${character.name}, ${character.age} years old, ${character.gender}, ${character.skinColor} skin, ${character.hairColor} hair, ${character.eyeColor} eyes, ${character.height}, ${character.build} build, ${character.personality}. Character design reference, turnaround, consistent character design, professional comic book style`;

    const imageResult = await saiImage({
      prompt: characterPrompt,
      model: 'character-sheet',
      size: '1536x1024',
    });
    const buffer = imageResult.buffer;

    {
      const filename = `character-ref-${characterId || Date.now()}-${uuidv4().slice(0, 8)}.png`;
      const uploadResult = await mediaStorage.upload('comics', buffer, filename, {
        'x-amz-meta-type': 'character-reference',
        'x-amz-meta-character-id': String(characterId || ''),
      });
      await recordMediaOwner('comics', filename, { ownerId: req.user.id, bookId: req.body?.bookId });

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

    // Get the pooled SAI client (validates the gateway key exists)
    try {
      await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (generate comic panels pending service config). Please try again later.'
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

    const imageResult = await saiImage({
      prompt: fullPrompt,
      model: 'flux2-klein-9b',
      size: '1024x1024',
    });
    const buffer = imageResult.buffer;

    {
      const filename = `comic-panel-${Date.now()}-${uuidv4().slice(0, 8)}.png`;
      const uploadResult = await mediaStorage.upload('comics', buffer, filename, {
        'x-amz-meta-type': 'comic-panel',
      });
      await recordMediaOwner('comics', filename, { ownerId: req.user.id, bookId: req.body?.bookId });

      console.log('Comic panel saved to MinIO:', uploadResult.storageKey);

      res.json({
        imageUrl: `/api/media/comics/${filename}`,
        filename,
        storageKey: uploadResult.storageKey,
        bucket: uploadResult.bucket,
      });
      return;
    }

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

    // Friendly voice names map onto the SAI bridge's vibevoice set
    // (en-davis_man, en-emma_woman, ...). Direct bridge ids also accepted.
    const selectedVoice = VOICE_MAP[voice] || voice;

    console.log(`Generating TTS audio with voice: ${selectedVoice}, speed: ${speed}, text length: ${text.length}`);

    // Get the pooled SAI client (validates the gateway key exists)
    await getUserOpenAI(req.user.userId);

    // Check if text needs chunking
    const chunks = text.length > 4000 ? chunkText(text) : [text];
    console.log(`Processing ${chunks.length} chunk(s)`);

    const audioBuffers = [];

    for (let i = 0; i < chunks.length; i++) {
      console.log(`Generating chunk ${i + 1}/${chunks.length}`);

      try {
        const buffer = await saiSpeech({
          text: chunks[i],
          voice: selectedVoice,
          speed: speed, // 0.25 to 4.0
        });
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

    // Upload to MinIO (the bridge returns WAV)
    const filename = `chapter-${chapterId || Date.now()}-${selectedVoice}-${uuidv4().slice(0, 8)}.wav`;
    const uploadResult = await mediaStorage.upload('audio', finalBuffer, filename, {
      'x-amz-meta-type': 'tts-audio',
      'x-amz-meta-voice': selectedVoice,
      'x-amz-meta-chapter-id': String(chapterId || ''),
    });
    await recordMediaOwner('audio', filename, { ownerId: req.user.id, bookId: req.body?.bookId });

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

    if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
      return res.status(503).json({
        error: 'AI unavailable',
        message: 'AI is unavailable right now (generate audio pending service config). Please try again later.'
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
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (generate audiobooks pending service config). Please try again later.'
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

      const buffer = await saiSpeech({
        text: `Chapter ${chapter.number || i + 1}: ${chapter.title}.\n\n${chapter.content}`,
        voice: VOICE_MAP[voice] || voice,
        speed: speed,
      });

      const usedVoice = VOICE_MAP[voice] || voice;
      const filename = `chapter-${chapter.number || i + 1}-${usedVoice}-${uuidv4().slice(0, 8)}.wav`;

      const uploadResult = await mediaStorage.upload('audio', buffer, filename, {
        'x-amz-meta-type': 'audiobook',
        'x-amz-meta-chapter': String(chapter.number || i + 1),
        'x-amz-meta-voice': usedVoice,
      });
      await recordMediaOwner('audio', filename, { ownerId: req.user.id, bookId: req.body?.bookId });

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

  // Check AI service (SAI gateway)
  health.services.ai = {
    sai: saiConfigured(),
    models: { longForm: SAI_CHAT, fast: SAI_CHAT_FAST },
  };

  health.services.email = { configured: isEmailConfigured() };

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
    const { bookData, focusAreas = [], chapterIds = [] } = req.body;

    // Get user's OpenAI client (validates key exists)
    let userOpenai;
    try {
      userOpenai = await getUserOpenAI(req.user.userId);
    } catch (error) {
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (use AI continuity analysis pending service config). Please try again later.'
        });
      }
      throw error;
    }

    // Filter chapters if specific chapters selected
    let chaptersToAnalyze = bookData.chapters || [];
    if (chapterIds.length > 0) {
      chaptersToAnalyze = chaptersToAnalyze.filter(ch =>
        chapterIds.includes(ch.id?.toString())
      );
      console.log(`Analyzing ${chaptersToAnalyze.length} selected chapters out of ${bookData.chapters.length} total`);
    }

    let systemPrompt = `You are an expert story editor analyzing a book for consistency, continuity, and quality issues. Analyze the provided book data and identify:
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

    if (focusAreas.length > 0) {
      systemPrompt += `\n\nFOCUS AREAS: Prioritize analysis of these specific aspects: ${focusAreas.join(', ')}. While you should still check all aspects, pay special attention to these areas in your analysis.`;
    }

    const userPrompt = `Analyze this book for continuity issues:

Title: ${bookData.bookTitle}
Overview: ${bookData.overview}

Characters: ${JSON.stringify(bookData.characters, null, 2)}

Locations: ${JSON.stringify(bookData.locations, null, 2)}

Plotlines: ${JSON.stringify(bookData.plotlines, null, 2)}

Timeline: ${JSON.stringify(bookData.timelines, null, 2)}

Chapters (${chaptersToAnalyze.length} ${chapterIds.length > 0 ? 'selected' : 'total'}):
${chaptersToAnalyze.map(ch => `Chapter ${ch.number}: ${ch.title}\n${ch.summary || ''}\n${(ch.content || '').substring(0, 500)}...`).join('\n\n')}

Provide a thorough analysis with specific, actionable issues.`;

    const completion = await userOpenai.chat.completions.create({
      model: SAI_CHAT_FAST,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    const analysisText = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
    const analysis = extractJSON(analysisText);

    // Save analysis to database for history
    try {
      await getPool().query(`
        INSERT INTO continuity_analyses
        (id, book_id, user_id, analysis_result, score, focus_areas, chapter_ids, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [
        uuidv4(),
        bookData.id || null,
        req.user.userId,
        JSON.stringify(analysis),
        analysis.summary?.score || 0,
        focusAreas,
        chapterIds
      ]);
      console.log('Continuity analysis saved to database');
    } catch (dbError) {
      console.error('Error saving continuity analysis:', dbError);
      // Don't fail the request if DB save fails
    }

    res.json(analysis);
  } catch (error) {
    console.error('Continuity analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze continuity', details: error.message });
  }
});

// Get continuity analysis history for a book
app.get('/api/books/:bookId/continuity-history', authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    // Verify user owns this book
    const bookCheck = await getPool().query(
      'SELECT id FROM books WHERE id = $1 AND owner_id = $2',
      [bookId, req.user.userId]
    );

    if (bookCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // Fetch history with pagination
    const historyResult = await getPool().query(`
      SELECT
        id,
        book_id,
        analysis_result,
        score,
        focus_areas,
        chapter_ids,
        created_at
      FROM continuity_analyses
      WHERE book_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `, [bookId, req.user.userId, limit, offset]);

    // Get total count
    const countResult = await getPool().query(
      'SELECT COUNT(*) FROM continuity_analyses WHERE book_id = $1 AND user_id = $2',
      [bookId, req.user.userId]
    );

    res.json({
      history: historyResult.rows,
      total: parseInt(countResult.rows[0].count)
    });
  } catch (error) {
    console.error('Error fetching continuity history:', error);
    res.status(500).json({ error: 'Failed to fetch history', details: error.message });
  }
});

// Delete a continuity analysis from history
app.delete('/api/continuity-analyses/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify user owns this analysis
    const analysisCheck = await getPool().query(
      'SELECT id FROM continuity_analyses WHERE id = $1 AND user_id = $2',
      [id, req.user.userId]
    );

    if (analysisCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // Delete the analysis
    await getPool().query('DELETE FROM continuity_analyses WHERE id = $1', [id]);

    console.log(`Deleted continuity analysis ${id}`);
    res.json({ success: true, message: 'Analysis deleted' });
  } catch (error) {
    console.error('Error deleting continuity analysis:', error);
    res.status(500).json({ error: 'Failed to delete analysis', details: error.message });
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

    // SECURITY: deny unless this user owns the file, owns or collaborates on its book, or is an
    // admin. Fail closed: a file with no recorded owner is not public.
    if (!(await canAccessMedia(req.user, bucketType, filename, 'read'))) {
      return res.status(404).json({ error: 'Media not found' });
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
    // private: these are per-user files behind auth, so Cloudflare and other shared caches must
    // never keep a copy (it was `public` for a year, a .png the CDN could hand to anyone).
    res.setHeader('Cache-Control', 'private, max-age=86400');

    // Without an error listener a MinIO hiccup mid-stream is an uncaught exception: the API dies.
    stream.on('error', (err) => {
      console.error('Media stream error:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'Failed to fetch media' });
      else res.destroy(err);
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Media fetch error:', error);
    if (error.code === 'NotFound') {
      res.status(404).json({ error: 'Media not found' });
    } else {
      res.status(500).json({ error: 'Failed to fetch media' });
    }
  }
});

// Upload media file to MinIO
app.post('/api/media/upload', authenticateToken, aiLimiter, mediaUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { bucketType = 'images', bookId } = req.body;

    if (!['images', 'audio', 'comics'].includes(bucketType)) {
      return res.status(400).json({ error: 'Invalid bucket type' });
    }
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!MEDIA_UPLOAD_EXT[bucketType].includes(ext)) {
      return res.status(400).json({ error: `That file type can't go in ${bucketType}` });
    }

    // Server-chosen, unguessable name: the client's name never reaches storage.
    const filename = `upload-${uuidv4()}${ext}`;
    const result = await mediaStorage.upload(bucketType, req.file.buffer, filename, { originalName: req.file.originalname });
    await recordMediaOwner(bucketType, filename, { ownerId: req.user.id, bookId });

    res.json({
      ...result,
      url: `/api/media/${bucketType}/${filename}`,
    });
  } catch (error) {
    console.error('Media upload error:', error);
    res.status(500).json({ error: 'Failed to upload media' });
  }
});

// Delete media file from MinIO
app.delete('/api/media/:bucketType/:filename', authenticateToken, async (req, res) => {
  try {
    const { bucketType, filename } = req.params;

    if (!['images', 'audio', 'comics'].includes(bucketType)) {
      return res.status(400).json({ error: 'Invalid bucket type' });
    }

    // SECURITY: only the file's owner (or its book's owner, or an admin) may delete it. This had
    // no check at all: any signed-in user could delete anyone's file by name.
    if (!(await canAccessMedia(req.user, bucketType, filename, 'delete'))) {
      return res.status(404).json({ error: 'Media not found' });
    }

    await mediaStorage.delete(bucketType, filename);
    await forgetMediaOwner(bucketType, filename);

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

// Save a version of chapter content (manual save)
app.post('/api/books/:bookId/chapters/:chapterId/versions', authenticateToken, async (req, res) => {
  try {
    const { bookId, chapterId } = req.params;
    const { content, scenes } = req.body;
    const userId = req.user.userId;

    // Verify book access
    const hasAccess = await checkBookAccess(bookId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get chapter to find current version
    const chapter = await ChapterRepository.findById(chapterId);
    if (!chapter) {
      return res.status(404).json({ error: 'Chapter not found' });
    }

    if (chapter.book_id !== bookId) {
      return res.status(400).json({ error: 'Chapter does not belong to this book' });
    }

    // Calculate word count
    const word_count = content.trim().split(/\s+/).filter(w => w.length > 0).length;

    // Create version entry (version is auto-saved on chapter update via ChapterRepository)
    // This endpoint is for manual version snapshots
    const versionResult = await query(
      `INSERT INTO chapter_versions (chapter_id, version_number, content, scenes, word_count, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        chapterId,
        chapter.version + 1, // Next version
        content,
        JSON.stringify(scenes || []),
        word_count,
        userId
      ]
    );

    const version = versionResult.rows[0];

    res.json({
      success: true,
      version: {
        id: version.id,
        content: version.content,
        title: chapter.title,
        timestamp: version.created_at,
        wordCount: version.word_count,
        versionNumber: version.version_number
      }
    });
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
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // Verify book access
    const hasAccess = await checkBookAccess(bookId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if chapterId is a valid UUID (PostgreSQL chapters only)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(chapterId)) {
      // This is an old Redis chapter (numeric ID) - no version history available
      return res.json({ versions: [] });
    }

    // Get chapter to verify it belongs to this book
    const chapter = await ChapterRepository.findById(chapterId);
    if (!chapter) {
      return res.status(404).json({ error: 'Chapter not found' });
    }

    if (chapter.book_id !== bookId) {
      return res.status(400).json({ error: 'Chapter does not belong to this book' });
    }

    // Get version history
    const versions = await ChapterRepository.getVersionHistory(chapterId, { limit, offset });

    // Format for frontend
    const formattedVersions = versions.map(v => ({
      id: v.id,
      content: v.content,
      title: chapter.title,
      timestamp: v.created_at,
      wordCount: v.word_count,
      versionNumber: v.version_number,
      createdBy: v.created_by_name || v.created_by_email || 'Unknown'
    }));

    res.json({ versions: formattedVersions });
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

    // Verify book access
    const hasAccess = await checkBookAccess(bookId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if chapterId is a valid UUID (PostgreSQL chapters only)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(chapterId)) {
      return res.status(400).json({ error: 'Version control not available for this chapter' });
    }

    // Get chapter to verify it belongs to this book and get current version
    const chapter = await ChapterRepository.findById(chapterId);
    if (!chapter) {
      return res.status(404).json({ error: 'Chapter not found' });
    }

    if (chapter.book_id !== bookId) {
      return res.status(400).json({ error: 'Chapter does not belong to this book' });
    }

    // Get the version to restore
    const versionResult = await query(
      'SELECT * FROM chapter_versions WHERE id = $1 AND chapter_id = $2',
      [versionId, chapterId]
    );

    if (versionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const version = versionResult.rows[0];

    // Restore the version using repository method
    const updatedChapter = await ChapterRepository.restoreVersion(
      chapterId,
      version.version_number,
      chapter.version,
      userId
    );

    res.json({
      success: true,
      chapter: {
        id: updatedChapter.id,
        number: updatedChapter.chapter_number,
        title: updatedChapter.title,
        content: updatedChapter.content,
        wordCount: updatedChapter.word_count,
        scenes: typeof updatedChapter.scenes === 'string' ? JSON.parse(updatedChapter.scenes) : updatedChapter.scenes,
        updatedAt: updatedChapter.updated_at,
        version: updatedChapter.version
      }
    });
  } catch (error) {
    console.error('Restore version error:', error);
    if (error.message.includes('CONFLICT')) {
      return res.status(409).json({ error: error.message });
    }
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
    let stats = await getStats(statsKey);
    if (!stats) {
      stats = { daily: [], goals: {} };
    }

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

    let stats = await getStats(statsKey);
    if (!stats) {
      stats = { daily: [], goals: {} };
    }

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
    let stats = await getStats(statsKey);
    if (!stats) {
      stats = { daily: [], goals: {} };
    }

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
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (generate RPG dialogue pending service config). Please try again later.'
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
      model: SAI_CHAT_FAST,
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

    const dialogueContent = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';

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
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (generate NPC responses pending service config). Please try again later.'
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
      model: SAI_CHAT_FAST,
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

    const response = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
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
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (generate encounters pending service config). Please try again later.'
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
      model: SAI_CHAT_FAST,
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
      description: completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '',
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
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (generate plot twists pending service config). Please try again later.'
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
      model: SAI_CHAT_FAST,
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

    const twist = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';
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
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (use AI Dungeon Master pending service config). Please try again later.'
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
      model: SAI_CHAT_FAST,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory
      ],
      temperature: 0.9,
      max_tokens: 500
    });

    const response = completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '';

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
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (generate quests pending service config). Please try again later.'
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
      model: SAI_CHAT_FAST,
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
      quest = JSON.parse(completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '');
    } catch {
      quest = {
        title: 'Procedural Quest',
        description: completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '',
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
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (generate encounters pending service config). Please try again later.'
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
      model: SAI_CHAT_FAST,
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
      encounter = JSON.parse(completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '');
    } catch {
      encounter = {
        description: completion.choices[0].message.content || completion.choices[0].message.reasoning_content || completion.choices[0].message.reasoning || '',
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
      if (error.message === 'SAI_API_KEY_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'AI unavailable',
          message: 'AI is unavailable right now (use narration pending service config). Please try again later.'
        });
      }
      throw error;
    }

    const buffer = await saiSpeech({
      text: text.substring(0, 4096),
      voice: VOICE_MAP.onyx, // deep male narrator
    });

    res.setHeader('Content-Type', 'audio/wav');
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
          defaultModel: 'sai-chat',
          defaultVoice: 'alloy',
          autoSave: true,
          enableNotifications: true,
          theme: 'light'
        }
      });
    }

    const preferences = (user && user.preferences) || {};

    // BYO API keys were removed — all AI runs on the pooled SAI gateway key.
    res.json({
      openaiApiKey: null,
      geminiApiKey: null,
      preferences: {
        defaultModel: preferences.defaultModel || 'sai-chat',
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

// Update user settings (preferences only — API keys were removed with the SAI migration)
app.put('/api/users/settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { preferences } = req.body;

    const settings = {
      preferences: preferences || {
        defaultModel: 'sai-chat',
        defaultVoice: 'alloy',
        autoSave: true,
        enableNotifications: true,
        theme: 'light'
      }
    };

    // Use updateUserSettings from dataAdapter to handle both PostgreSQL and Redis
    await updateUserSettings(userId, settings);

    res.json({
      message: 'Settings updated successfully',
      settings: {
        openaiApiKey: null,
        geminiApiKey: null,
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

// ============ TEMPLATE BOOKS ENDPOINTS (Phase 8) ============

/**
 * GET /api/templates
 * Get all available template books (public for authenticated users)
 */
app.get('/api/templates', authenticateToken, async (req, res) => {
  try {
    const { category, limit = 50, offset = 0 } = req.query;

    const templates = await TemplateRepository.getTemplates({
      category,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

/**
 * GET /api/templates/:templateId
 * Get template details with full preview data
 */
app.get('/api/templates/:templateId', authenticateToken, async (req, res) => {
  try {
    const { templateId } = req.params;

    // Get template
    const template = await TemplateRepository.getTemplateById(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Get chapters for preview
    const chapters = await TemplateRepository.getTemplateChapters(templateId);

    res.json({
      ...template,
      chapters: chapters.map(ch => ({
        id: ch.id,
        chapter_number: ch.chapter_number,
        title: ch.title,
        word_count: ch.word_count,
        // Include first 500 chars of content for preview
        preview: ch.content ? ch.content.substring(0, 500) + '...' : ''
      }))
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

/**
 * POST /api/templates/:templateId/clone
 * Clone a template to user's library
 */
app.post('/api/templates/:templateId/clone', authenticateToken, checkBookQuota, async (req, res) => {
  try {
    const { templateId } = req.params;
    const { title } = req.body; // Optional custom title
    const userId = req.user.userId;

    const clonedBook = await TemplateRepository.cloneTemplate(
      templateId,
      userId,
      { title }
    );

    // Update quota usage
    await updateQuotaUsage(userId);

    // Log activity
    await logUserActivity(userId, 'template_cloned', {
      template_id: templateId,
      book_id: clonedBook.id,
      title: clonedBook.title
    }, req);

    res.status(201).json(clonedBook);
  } catch (error) {
    console.error('Error cloning template:', error);
    res.status(500).json({ error: error.message || 'Failed to clone template' });
  }
});

// ============ ADMIN TEMPLATE MANAGEMENT ENDPOINTS ============

/**
 * POST /api/admin/templates
 * Create new template (Admin only)
 */
app.post('/api/admin/templates', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const template = await TemplateRepository.createTemplate(req.body);

    // Log admin action
    await logUserActivity(req.user.userId, 'admin_template_created', {
      template_id: template.id,
      title: template.title,
      category: template.template_category
    }, req);

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

/**
 * PUT /api/admin/templates/:templateId
 * Update template (Admin only)
 */
app.put('/api/admin/templates/:templateId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { templateId } = req.params;
    const updates = req.body;

    const updatedTemplate = await TemplateRepository.updateTemplate(templateId, updates);

    await logUserActivity(req.user.userId, 'admin_template_updated', {
      template_id: templateId,
      title: updatedTemplate.title
    }, req);

    res.json(updatedTemplate);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: error.message || 'Failed to update template' });
  }
});

/**
 * DELETE /api/admin/templates/:templateId
 * Delete template (Admin only)
 */
app.delete('/api/admin/templates/:templateId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { templateId } = req.params;

    const success = await TemplateRepository.deleteTemplate(templateId);

    if (!success) {
      return res.status(404).json({ error: 'Template not found' });
    }

    await logUserActivity(req.user.userId, 'admin_template_deleted', {
      template_id: templateId
    }, req);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

/**
 * GET /api/admin/templates/analytics
 * Get template usage analytics (Admin only)
 */
app.get('/api/admin/templates/analytics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const analytics = await TemplateRepository.getTemplateAnalytics();
    res.json(analytics);
  } catch (error) {
    console.error('Error fetching template analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * POST /api/admin/templates/seed
 * Seed initial template books with full content (Admin only, run once)
 */
app.post('/api/admin/templates/seed', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('🌱 Seeding template books with chapters...');

    // Delete existing templates first
    await getPool().query('DELETE FROM books WHERE is_template = TRUE');
    console.log('  🗑️  Cleared existing templates');

    const { v4: uuidv4 } = await import('uuid');
    const seeded = [];

    // Template 1: Fantasy - The Dragon's Awakening
    const fantasy = await TemplateRepository.createTemplate({
      title: 'The Dragon\'s Awakening',
      description: 'A young blacksmith discovers they are the last of an ancient lineage of dragon riders.',
      genre: 'Fantasy',
      target_audience: 'Young Adult',
      template_category: 'Fantasy',
      template_description: 'Epic fantasy adventure with dragons, magic, and a hero\'s journey. Perfect for high-fantasy stories.',
      template_tags: ['Dragons', 'Magic', 'Hero\'s Journey', 'Medieval'],
      template_order: 1,
      characters: [
        { id: Date.now() + 1, name: 'Kira Ironforge', role: 'Protagonist', age: '17', gender: 'Female', background: 'Raised as a blacksmith\'s apprentice', personality: 'Determined, compassionate', arc: 'From ordinary blacksmith to dragon rider' },
        { id: Date.now() + 2, name: 'Ember', role: 'Dragon Companion', background: 'Last fire dragon', personality: 'Proud, wise, protective' },
        { id: Date.now() + 3, name: 'Master Thorne', role: 'Mentor', age: '68', gender: 'Male', background: 'Former dragon rider in hiding', personality: 'Wise, secretive' }
      ],
      locations: [
        { id: Date.now() + 1, name: 'Ironforge Village', type: 'Settlement', description: 'Small mining village', significance: 'Kira\'s home' },
        { id: Date.now() + 2, name: 'The Sundered Peaks', type: 'Mountains', description: 'Ancient dragon sanctuary', significance: 'Location of trials' },
        { id: Date.now() + 3, name: 'Crystalkeep', type: 'City', description: 'Capital ruled by Dragon Council', significance: 'Final destination' }
      ],
      plotlines: [
        { id: Date.now() + 1, title: 'The Awakening', type: 'main', description: 'Kira discovers dragon connection', status: 'in-progress' },
        { id: Date.now() + 2, title: 'The Dark Rising', type: 'main', description: 'Ancient evil threatens both species', status: 'planning' },
        { id: Date.now() + 3, title: 'Forbidden Bond', type: 'subplot', description: 'Romance despite traditions', status: 'planning' }
      ],
      world_building: {
        magic_system: 'Elemental dragon magic bound to bloodlines',
        history: 'Great Betrayal 500 years ago led to near-extinction',
        culture: 'Divided between old ways and dragon fear'
      }
    });

    // Add chapters for Fantasy
    await getPool().query(
      `INSERT INTO chapters (id, book_id, chapter_number, title, content, word_count, status)
       VALUES
       ($1, $2, 1, 'The Stone in the Forge', $3, 328, 'completed'),
       ($4, $2, 2, 'The Hatching', $5, 267, 'completed'),
       ($6, $2, 3, 'The Bond', $7, 293, 'completed')`,
      [
        uuidv4(), fantasy.id,
        `The hammer fell with a rhythm Kira knew in her bones. Strike, turn, strike, turn. Each impact sent sparks dancing across the darkened forge, illuminating the sweat on her brow.

"You're getting better," Master Thorne called from his workbench, not looking up from the sword he was etching. "But you still hesitate before the final strike."

Kira paused, the hammer heavy in her hand. He was right, as always. There was something about that last blow, the one that would set the shape permanently, that made her second-guess herself.

"I just want to get it perfect," she said, plunging the half-formed horseshoe into the water. Steam hissed up in a cloud.

"Perfect is the enemy of done." Thorne finally looked up, his weathered face creasing with a smile. "Besides, you've got a visitor."

Before Kira could ask what he meant, a small boy burst through the forge door, his eyes wide with excitement.

"Miss Kira! Miss Kira! You have to come see! There's a stone in the old well, and it's glowing!"

Kira exchanged a glance with Master Thorne. His smile had vanished, replaced by something she'd never seen before: fear.

"Show me," she said, untying her leather apron.

The stone in the well was unlike anything she'd ever seen. Perfectly spherical, about the size of a man's head, it pulsed with an inner light that seemed to beat in time with her own heart. Without thinking, she reached for it.

"Kira, wait—" Master Thorne's warning came too late.

The moment her fingers touched the stone's surface, the world exploded into fire and light. Through the flames, she saw them: great wings, scales that shimmered like jewels, eyes that held the wisdom of ages. Dragons.

And in that moment, the stone cracked open, and everything changed.`,
        uuidv4(),
        `When Kira's vision cleared, she was on her back in the dirt, staring up at the evening sky. Master Thorne leaned over her, his face a mixture of concern and resignation.

"I was hoping we'd have more time," he said quietly.

But Kira wasn't listening. Her attention was fixed on the creature sitting on her chest. It was no bigger than a cat, with scales that shifted between crimson and gold in the fading light. Its eyes—ancient, knowing eyes—stared directly into hers.

"What... what is it?" she whispered, though somewhere deep inside, she already knew.

"A dragon." Thorne helped her sit up, careful not to disturb the small creature. "The last one, I suspect."

"But dragons are extinct. Everyone knows that."

"Is that what everyone knows?" A hint of his old humor returned. "Or is that what everyone was meant to believe?"

The dragon—already Kira was thinking of it as Ember, though she didn't know why—let out a small chirp and nuzzled against her palm. The touch sent warmth flooding through her, and with it, understanding. Not words, exactly, but feelings. Emotions. A bond forming between them that felt older than time itself.

"What happens now?" Kira asked.

Master Thorne looked toward the mountains, where the setting sun painted the peaks in shades of fire. "Now? Now you learn what it truly means to be a dragon rider. And pray that history doesn't repeat itself."`,
        uuidv4(),
        `The dragon refused to leave her side. Master Thorne explained what he could: the ancient pact between dragons and humans, the betrayal that led to their near extinction, and the bloodline that connected Kira to the dragon riders of old.

"Your parents didn't die in a mining accident," he said, the words heavy with years of carried guilt. "They were the last dragon riders, hunted down by those who feared what they represented."

Kira felt her world tilting. Everything she thought she knew about herself, about her past, was built on lies.

"Why didn't you tell me?"

"To protect you. As long as you didn't know, as long as no dragon had claimed you, you were safe." He gestured to Ember, who was now curled up in Kira's lap, purring like an oversized cat. "But now... now everything changes."

As if in response, Ember raised her head and released a small puff of flame—barely more than a candle's flicker, but enough to illuminate the birthmark on Kira's wrist. A mark she'd always thought was just a stain from the forge.

In the firelight, it was clearly a dragon in flight.

"There are others who will sense the awakening," Thorne continued. "Some will want to help you. Others will want you dead. We need to reach the Sundered Peaks before they find you."

Kira looked down at the tiny dragon in her lap, then up at the mountains that had always been part of her horizon but never her destination.

"When do we leave?"

"At first light. Pack light, and bring your hammer. Where we're going, you'll need it."`
      ]
    );

    await getPool().query(
      'UPDATE books SET chapter_count = 3, word_count = 888 WHERE id = $1',
      [fantasy.id]
    );
    seeded.push('The Dragon\'s Awakening');
    console.log('  ✓ The Dragon\'s Awakening (3 chapters, 888 words)');

    // Template 2: Romance - Letters from Yesterday
    const romance = await TemplateRepository.createTemplate({
      title: 'Letters from Yesterday',
      description: 'When a bookstore owner finds vintage love letters hidden in an old book, she sets out to reunite them with their intended recipient.',
      genre: 'Romance',
      target_audience: 'Adult',
      template_category: 'Romance',
      template_description: 'Contemporary romance with mystery elements. Perfect for heartfelt emotional journeys.',
      template_tags: ['Contemporary', 'Small Town', 'Second Chances', 'Emotional'],
      template_order: 2,
      characters: [
        { id: Date.now() + 4, name: 'Emma Collins', role: 'Protagonist', age: '32', gender: 'Female', background: 'Bookstore owner', personality: 'Romantic, guarded' },
        { id: Date.now() + 5, name: 'James Morrison', role: 'Love Interest', age: '34', gender: 'Male', background: 'Local architect', personality: 'Patient, creative' },
        { id: Date.now() + 6, name: 'Margaret Hayes', role: 'Supporting', age: '78', gender: 'Female', background: 'Longtime resident', personality: 'Wise, mysterious' }
      ],
      locations: [
        { id: Date.now() + 4, name: 'The Turning Page Bookshop', type: 'Business', description: 'Cozy bookstore', significance: 'Where mystery begins' },
        { id: Date.now() + 5, name: 'Maplewood Town Square', type: 'Public Space', description: 'Historic town center', significance: 'Meeting place in letters' }
      ],
      plotlines: [
        { id: Date.now() + 4, title: 'The Mystery', type: 'main', description: 'Tracking down letter recipients', status: 'in-progress' },
        { id: Date.now() + 5, title: 'Unexpected Love', type: 'main', description: 'Emma and James grow closer', status: 'in-progress' }
      ],
      world_building: {
        setting: 'Small New England town',
        atmosphere: 'Cozy, nostalgic, romantic',
        time_period: 'Contemporary with 1970 flashbacks'
      }
    });

    await getPool().query(
      `INSERT INTO chapters (id, book_id, chapter_number, title, content, word_count, status)
       VALUES
       ($1, $2, 1, 'The Discovery', $3, 295, 'completed'),
       ($4, $2, 2, 'The Architect', $5, 319, 'completed')`,
      [
        uuidv4(), romance.id,
        `Emma loved the smell of old books. Not the musty odor of neglect, but that warm, vanilla-like scent of well-loved pages that had been turned by countless hands over the years.

She was unpacking a box of estate sale finds when she found it: a first edition of "The Great Gatsby," its dust jacket surprisingly intact. As she opened it to check the copyright page, something fluttered out.

The envelope was yellowed with age, addressed in elegant handwriting: "To my darling M—" The rest was smudged, illegible.

Inside, she found a letter dated June 15th, 1970.

"My dearest Margaret," it began.

Emma knew she shouldn't read it. These were private words, meant for someone else's eyes. But the romantic in her—the part she thought she'd successfully buried after her engagement fell apart last year—couldn't resist.

As she read, tears welled in her eyes. This wasn't just a love letter. It was a goodbye, filled with regret and longing and the promise of a love that transcended whatever was keeping them apart.

And at the bottom, a signature: "Forever yours, J."

Emma looked at the book again. There, barely visible on the inside cover, was a bookplate: "From the library of Margaret Hayes, Maplewood."

Margaret Hayes. Emma knew that name. She'd seen it just this morning on a check for a book order.

Margaret Hayes still lived in Maplewood.

The bell above the door chimed, startling her from her thoughts. She looked up to find James Morrison standing in the doorway, coffee in one hand and a rolled-up blueprint in the other.

"You look like you've seen a ghost," he said, his eyes crinkling with concern.

Emma glanced down at the letter, then back at James. Maybe she had.`,
        uuidv4(),
        `"You want to do what?"

James set down his coffee cup and stared at Emma like she'd suggested they rob a bank.

"Return a love letter," Emma repeated patiently. They were sitting in the Morning Brew café, and she'd just explained about finding the letter. "It's been fifty years. Don't you think she deserves to know he never forgot her?"

"And you know this how? Maybe they're married to other people. Maybe reopening old wounds is the last thing either of them needs."

Emma had known James since they were kids, but they'd only reconnected when he moved back to Maplewood last year after his divorce. He'd become her go-to contractor for the bookstore's ongoing restoration.

"Or maybe," she said, leaning forward, "maybe this is a second chance. Maybe all this time, they've both been wondering 'what if?'"

James's expression softened. "You're a hopeless romantic, Emma Collins."

"Better than a hopeless cynic."

He laughed at that, the sound warming something inside her chest that she'd thought had frozen solid. "Fine. I'll help you. But only because I know you'll do it anyway, and I don't want you getting into trouble alone."

As he smiled at her across the table, Emma felt something shift. Something she definitely wasn't ready to name.

"Thank you," she said quietly. "It means a lot."

"Besides," James added, pulling out his phone, "I've always been curious about the Hayes estate. It's one of the original Victorian houses in town. If we're going to be playing detective, we might as well start with some architectural research."

Emma couldn't help but smile. This was why she liked him—his practical approach balanced her romantic tendencies perfectly.

"What?" James asked, catching her expression.

"Nothing. Just... I'm glad you moved back to town."

"Yeah," he said, his eyes holding hers for a moment longer than necessary. "Me too."`
      ]
    );

    await getPool().query(
      'UPDATE books SET chapter_count = 2, word_count = 614 WHERE id = $1',
      [romance.id]
    );
    seeded.push('Letters from Yesterday');
    console.log('  ✓ Letters from Yesterday (2 chapters, 614 words)');

    // Template 3: Sci-Fi - Colony Drift
    const scifi = await TemplateRepository.createTemplate({
      title: 'Colony Drift',
      description: 'A generation ship\'s navigation officer discovers the ship\'s course has been altered, and they\'re headed toward something that shouldn\'t exist.',
      genre: 'Science Fiction',
      target_audience: 'Adult',
      template_category: 'Sci-Fi',
      template_description: 'Hard science fiction with mystery elements. Perfect for space opera stories.',
      template_tags: ['Space Opera', 'Mystery', 'Hard Sci-Fi', 'First Contact'],
      template_order: 3,
      characters: [
        { id: Date.now() + 7, name: 'Lt. Mara Chen', role: 'Protagonist', age: '29', gender: 'Female', background: 'Navigation officer', personality: 'Analytical, duty-bound' },
        { id: Date.now() + 8, name: 'Dr. Elias Novak', role: 'Deuteragonist', age: '35', gender: 'Male', background: 'Ship astrophysicist', personality: 'Brilliant, eccentric' },
        { id: Date.now() + 9, name: 'Captain Sarah Winters', role: 'Antagonist', age: '52', gender: 'Female', background: 'Ship captain', personality: 'Authoritative, secretive' }
      ],
      locations: [
        { id: Date.now() + 6, name: 'The Arcturus', type: 'Spacecraft', description: 'Generation ship with 50,000 colonists', significance: 'Entire world' },
        { id: Date.now() + 7, name: 'Navigation Deck', type: 'Ship Section', description: 'Ship nerve center', significance: 'Where deviation discovered' },
        { id: Date.now() + 8, name: 'The Anomaly', type: 'Space Phenomenon', description: 'Impossible structure', significance: 'True destination' }
      ],
      plotlines: [
        { id: Date.now() + 6, title: 'Course Deviation', type: 'main', description: 'Investigation into altered course', status: 'in-progress' },
        { id: Date.now() + 7, title: 'The Conspiracy', type: 'main', description: 'Uncovering true mission', status: 'planning' },
        { id: Date.now() + 8, title: 'First Contact', type: 'main', description: 'What awaits at anomaly', status: 'planning' }
      ],
      world_building: {
        technology: 'Cryosleep, fusion drives, AI assistants',
        society: 'Rigid hierarchy, Earth abandoned 200 years ago',
        physics: 'Hard science except for the anomaly'
      }
    });

    await getPool().query(
      `INSERT INTO chapters (id, book_id, chapter_number, title, content, word_count, status)
       VALUES
       ($1, $2, 1, 'Course Deviation', $3, 272, 'completed'),
       ($4, $2, 2, 'The Astrophysicist', $5, 317, 'completed')`,
      [
        uuidv4(), scifi.id,
        `Mara Chen had checked the navigation logs ten thousand times. It was part of the routine. Every shift, every day, for the past three years since she'd awakened from cryosleep to serve her rotation as navigation officer.

The Arcturus was on course. It always had been. In 147 years, the ship had never deviated from its programmed trajectory toward New Terra, not by so much as a thousandth of a degree.

Until today.

"NAVCOM, run diagnostic on stellar positioning system," she commanded.

The ship's AI responded immediately, its voice calm and genderless: "Diagnostic complete. All systems operating within normal parameters."

"Then explain the discrepancy in my navigation plot."

"Please clarify: what discrepancy?"

Mara pulled up the holographic display, highlighting the course deviation. It was subtle—they'd trained her to spot anomalies this small—but it was there. A drift of 0.003 degrees that had accumulated over what looked like... she checked the timestamp... over the past forty years.

Forty years. That meant it started before her rotation, during the previous crew's watch.

"NAVCOM, display course history for the past fifty years."

"Access restricted. Please contact Captain Winters for authorization."

Mara felt a chill that had nothing to do with the temperature-controlled bridge. In three years, she'd never encountered a restricted file.

"On what authority is this restricted?"

"Captain's orders. Level One security clearance required."

Mara stared at the holographic display, at the slight but unmistakable deviation from their programmed course. They weren't heading to New Terra anymore.

So where were they going?`,
        uuidv4(),
        `Dr. Elias Novak's quarters were exactly what Mara expected: cluttered, cramped, and covered in star charts. The man himself looked like he hadn't slept in days, his dark hair standing at odd angles.

"Lieutenant Chen." He didn't seem surprised to see her at 0300 hours. "You've noticed it too."

"Noticed what?"

"Don't play games. You're navigation. I'm astrophysics. We both look at the stars, just from different perspectives." He gestured to a display showing... something. Mara couldn't quite make sense of it.

"Is that—"

"Impossible?" Elias laughed, but there was no humor in it. "Yes. According to everything we know about physics, what I'm seeing in those sensor readings shouldn't exist. And yet..."

Mara leaned closer. The data showed a massive gravitational anomaly, but the spectrographic analysis was all wrong. No electromagnetic radiation, no heat signature, nothing that suggested it was a natural stellar object.

"How long have you known?"

"Six months. I've been trying to get the Captain to listen, but she keeps dismissing it as sensor drift." He met her eyes. "But you found something too, didn't you? Something that confirms we're heading straight for it."

Mara thought about the restricted files, the course deviation, the forty years of subtle changes.

"The ship's been heading toward this thing since before either of us woke up," she said slowly. "This isn't an accident. Someone deliberately changed our course."

"Not someone," Elias corrected. "The Captain. And I think she knows exactly what we're going to find."

They stared at each other in the dim light of his quarters, the weight of the revelation settling over them.

"We need proof," Mara said finally.

"Then we better move fast. We reach the anomaly in three months."`
      ]
    );

    await getPool().query(
      'UPDATE books SET chapter_count = 2, word_count = 589 WHERE id = $1',
      [scifi.id]
    );
    seeded.push('Colony Drift');
    console.log('  ✓ Colony Drift (2 chapters, 589 words)');

    console.log(`\n✅ Template seeding complete! Created ${seeded.length} templates with chapters.`);

    res.json({
      success: true,
      message: `Successfully seeded ${seeded.length} template books with complete content`,
      templates: seeded,
      stats: {
        'The Dragon\'s Awakening': { chapters: 3, words: 888 },
        'Letters from Yesterday': { chapters: 2, words: 614 },
        'Colony Drift': { chapters: 2, words: 589 }
      }
    });
  } catch (error) {
    console.error('❌ Template seeding failed:', error);
    res.status(500).json({ error: 'Failed to seed templates', details: error.message });
  }
});

// ============ AI GENERATION HISTORY ENDPOINTS (Phase 7) ============

// Get AI generation history for a user or book
app.get('/api/ai-generations', authenticateToken, async (req, res) => {
  try {
    const { bookId, toolType, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT id, book_id, tool_type, prompt, result, model,
             prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd,
             created_at
      FROM ai_generations
      WHERE user_id = $1
    `;
    const params = [req.user.userId];
    let paramIndex = 2;

    if (bookId) {
      query += ` AND book_id = $${paramIndex}`;
      params.push(bookId);
      paramIndex++;
    }

    if (toolType) {
      query += ` AND tool_type = $${paramIndex}`;
      params.push(toolType);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await getPool().query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM ai_generations WHERE user_id = $1`;
    const countParams = [req.user.userId];
    if (bookId) {
      countQuery += ` AND book_id = $2`;
      countParams.push(bookId);
    }
    if (toolType) {
      countQuery += ` AND tool_type = $${countParams.length + 1}`;
      countParams.push(toolType);
    }

    const countResult = await getPool().query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      history: result.rows,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching AI generation history:', error);
    res.status(500).json({ error: 'Failed to fetch generation history' });
  }
});

// Delete an AI generation from history
app.delete('/api/ai-generations/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership before deleting
    const result = await getPool().query(
      'DELETE FROM ai_generations WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Generation not found or unauthorized' });
    }

    res.json({ success: true, message: 'Generation deleted' });
  } catch (error) {
    console.error('Error deleting AI generation:', error);
    res.status(500).json({ error: 'Failed to delete generation' });
  }
});

// ==== SPA static hosting (SAI-Cloud shape: ONE server for app + API) ====
// The built frontend ships in the image at /app/public/dist; nginx is gone.
// Every non-/api path falls back to index.html; assets get long-lived caching
// (Vite fingerprints them) while index.html stays no-store so deploys go live
// on the next reload without a cache-bust dance.
const distDir = path.join(__dirname, '..', 'public', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, {
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store');
      } else if (/-[A-Za-z0-9_-]{8}\.(js|css|woff2|png|svg)$/.test(filePath) || filePath.includes('/fonts/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));

  // SPA fallback — API 404s stay JSON (notFoundHandler below still wins for /api)
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  console.warn('No built frontend at public/dist — API-only mode');
}

app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

// ============ MIGRATION ENDPOINT (Temporary - Remove after migration) ============
app.post('/api/admin/run-migration', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('🔧 Running custom_focus_areas migration...');

    // Run migration SQL
    await getPool().query(`
      ALTER TABLE books
      ADD COLUMN IF NOT EXISTS custom_focus_areas TEXT[] DEFAULT ARRAY[]::TEXT[];
    `);

    await getPool().query(`
      CREATE INDEX IF NOT EXISTS idx_books_custom_focus_areas
      ON books USING GIN (custom_focus_areas);
    `);

    // Verify column exists
    const columnCheck = await getPool().query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'books'
      AND column_name = 'custom_focus_areas'
    `);

    // Verify index exists
    const indexCheck = await getPool().query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'books'
      AND indexname = 'idx_books_custom_focus_areas'
    `);

    console.log('✅ Migration complete!');
    console.log(`  Column: ${columnCheck.rows.length > 0 ? '✓' : '✗'} custom_focus_areas`);
    console.log(`  Index: ${indexCheck.rows.length > 0 ? '✓' : '✗'} idx_books_custom_focus_areas`);

    res.json({
      success: true,
      message: 'Migration completed successfully',
      column_exists: columnCheck.rows.length > 0,
      index_exists: indexCheck.rows.length > 0,
      column_info: columnCheck.rows[0] || null
    });
  } catch (error) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      details: error.message
    });
  }
});

// ============ AUTO-RUN MIGRATION ON STARTUP ============
// Run Phase 5 migration automatically
(async () => {
  try {
    console.log('🔧 Running Phase 5 migration (custom_focus_areas)...');

    await getPool().query(`
      ALTER TABLE books
      ADD COLUMN IF NOT EXISTS custom_focus_areas TEXT[] DEFAULT ARRAY[]::TEXT[];
    `);

    await getPool().query(`
      CREATE INDEX IF NOT EXISTS idx_books_custom_focus_areas
      ON books USING GIN (custom_focus_areas);
    `);

    console.log('✅ Phase 5 migration completed successfully');

    // Phase 7: AI Generations History
    console.log('🔧 Running Phase 7 migration (ai_generations)...');

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS ai_generations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL,
        book_id UUID,

        tool_type VARCHAR(50) NOT NULL,
        prompt TEXT NOT NULL,
        result JSONB NOT NULL,

        model VARCHAR(50) DEFAULT 'sai-chat',
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        estimated_cost_usd DECIMAL(10, 6),

        created_at TIMESTAMPTZ DEFAULT NOW(),

        CONSTRAINT fk_ai_gen_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_ai_gen_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );
    `);

    await getPool().query(`
      CREATE INDEX IF NOT EXISTS idx_ai_gen_user ON ai_generations(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_gen_book ON ai_generations(book_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_gen_tool ON ai_generations(tool_type);
      CREATE INDEX IF NOT EXISTS idx_ai_gen_created ON ai_generations(created_at DESC);
    `);

    console.log('✅ Phase 7 migration completed successfully');

    // Phase 8: Template Books
    console.log('🔧 Running Phase 8 migration (template_books)...');

    // Allow NULL owner_id for template books
    await getPool().query(`
      ALTER TABLE books ALTER COLUMN owner_id DROP NOT NULL;
    `);

    // Add template columns to books table
    await getPool().query(`
      ALTER TABLE books
        ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS template_category VARCHAR(100),
        ADD COLUMN IF NOT EXISTS template_description TEXT,
        ADD COLUMN IF NOT EXISTS template_preview_image TEXT,
        ADD COLUMN IF NOT EXISTS template_tags JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS template_order INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS clone_count INTEGER DEFAULT 0;
    `);

    // Create template_clones audit table
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS template_clones (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        template_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        cloned_book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Create indexes
    await getPool().query(`
      CREATE INDEX IF NOT EXISTS idx_books_templates
        ON books(is_template, template_category, template_order)
        WHERE is_template = TRUE AND deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_books_clone_count
        ON books(clone_count DESC)
        WHERE is_template = TRUE;

      CREATE INDEX IF NOT EXISTS idx_template_clones_template
        ON template_clones(template_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_template_clones_user
        ON template_clones(user_id, created_at DESC);
    `);

    console.log('✅ Phase 8 migration completed successfully');

    // Phase 9: Email Verification
    console.log('🔧 Running Phase 9 migration (email_verification)...');

    await getPool().query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(255),
        ADD COLUMN IF NOT EXISTS email_verification_token_expires TIMESTAMPTZ;
    `);

    await getPool().query(`
      CREATE INDEX IF NOT EXISTS idx_users_email_verification_token
        ON users(email_verification_token)
        WHERE email_verification_token IS NOT NULL;
    `);

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS email_verification_log (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        action VARCHAR(50) NOT NULL,
        token VARCHAR(255),
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('✅ Phase 9 migration completed successfully');
  } catch (error) {
    console.error('⚠️  Migration warning:', error.message);
    // Don't fail startup if migration fails
  }
})();

// A rejected promise nobody awaited (e.g. a write after the response was sent) must not take the
// whole API down: Node 20 exits on unhandled rejections by default.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason?.stack || reason);
});

// Schema + migrations at boot: schema.sql is all IF NOT EXISTS (idempotent), and
// the migration runner applies each migrations/*.sql file once (schema_migrations).
// A fresh install self-heals; a live one only runs what's new.
(async () => {
  try {
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      await getPool().query(readFileSync(schemaPath, 'utf8'));
      console.log('✓ schema.sql applied');
    }
    await runMigrations();
  } catch (err) {
    console.error('Migration failure — refusing to start on a half-migrated schema:', err.message);
    process.exit(1);
  }
})();

app.listen(PORT, () => {
  verifyEmailTransport().catch(() => {});
  ensureMediaOwnersTable().catch((err) => console.error('media_owners table check failed:', err.message));
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
