# Fiction Writing Studio

A comprehensive AI-powered platform for writing, managing, and publishing fiction books. Built with React, Node.js, PostgreSQL, and powered by OpenAI and Google Gemini.

**Live at:** [story-writing.com](https://story-writing.com)
**Version:** 2.20.6
**Status:** ✅ Production

## ✨ Features

### 📚 Core Writing Tools
- **Multi-book Management** - Cloud-based book library with instant access
- **Rich Text Editor** - Full-featured chapter editor with autosave (30s)
- **Content Organization** - Track characters, locations, plotlines, and timelines
- **Continuity Checking** - AI-powered analysis for plot holes and inconsistencies
- **Version Control** - Chapter history and version management

### 🤖 AI-Powered Generation (User API Keys Required)
- **Complete Book Generation** - Generate full books from descriptions
- **Chapter Writing** - AI-assisted chapter creation and expansion
- **Character Development** - Generate detailed character profiles
- **World Building** - Create locations, settings, and environments
- **Plot Development** - Story arcs, twists, and narrative structure
- **Dialogue Generation** - Natural conversation creation
- **Image Generation** - Visual assets via Google Gemini
- **Text-to-Speech** - Audiobook creation with 6 voice options

### 🎮 RPG Campaign Tools
- **Character Creation** - D&D-style character sheets
- **Quest Management** - Track quests, objectives, and rewards
- **AI Dungeon Master** - Interactive narration and NPC responses
- **Encounter Generation** - Balanced combat scenarios
- **World Building** - Locations, NPCs, and lore tracking

### 📖 Book Import & Analysis
- **Multi-Format Import** - EPUB, PDF, DOCX, TXT support
- **Smart Chapter Detection** - AI-powered chapter boundary detection
- **Metadata Extraction** - Automatic character, location, and plot identification
- **Incremental Analysis** - Process large books in manageable chunks

### 🎨 Multi-Format Export
- **eBook Formats** - EPUB, PDF, DOCX
- **Comic Books** - CBZ (Comic Book Archive) format
- **Audiobooks** - TTS with customizable voices
- **Animation Films** - Video generation via Veo 3

### 🔐 User Features
- **Profile Management** - Account settings and preferences
- **API Key Management** - Bring your own OpenAI/Gemini keys
- **Usage Control** - Use your own AI credits, protect system resources

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- AWS Account (for deployment)
- OpenAI API key (for users)
- Google Gemini API key (for users)

### Local Development

1. **Clone and install:**
   ```bash
   git clone <repo-url>
   cd story-writing
   npm install
   cd server && npm install && cd ..
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start services:**
   ```bash
   docker-compose up -d  # Starts Redis + MinIO
   npm run dev           # Starts frontend (port 5173)
   cd server && npm start  # Starts backend (port 3001)
   ```

4. **Access application:**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001
   - MinIO Console: http://localhost:9001

## 🏗️ Architecture

### Tech Stack
- **Frontend:** React 18, Vite, Tailwind CSS, Lucide Icons
- **Backend:** Node.js, Express.js
- **Database:** Redis (sessions, book data, user data)
- **Storage:** MinIO (images, audio, files)
- **AI Services:** OpenAI GPT-4, Google Gemini
- **Video:** FFmpeg (assembly), Veo 3 (generation)

### Infrastructure (Production)
- **Hosting:** AWS ECS Fargate
- **Container Registry:** AWS ECR
- **Load Balancer:** AWS ALB
- **Region:** eu-west-2 (London)
- **SSL/CDN:** Cloudflare (Free tier)
- **Domain:** story-writing.com

## 📦 Deployment

### Using Deploy Script (Recommended)

```bash
# Deploy everything with version bump
./deploy.sh all patch    # Bug fixes (1.0.3 -> 1.0.4)
./deploy.sh all minor    # New features (1.0.3 -> 1.1.0)
./deploy.sh all major    # Breaking changes (1.0.3 -> 2.0.0)

# Deploy individual services
./deploy.sh backend patch
./deploy.sh frontend minor
```

### Manual Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed manual deployment instructions.

### Check Deployment Status

```bash
# Backend
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-backend \
  --region eu-west-2 \
  --query 'services[0].deployments[0].rolloutState'

# Frontend
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-frontend \
  --region eu-west-2 \
  --query 'services[0].deployments[0].rolloutState'
```

## 🔧 Configuration

### Backend Environment Variables (.env)

```bash
# Server
PORT=3001
NODE_ENV=production

# JWT Authentication
JWT_SECRET=your-secret-key-change-this

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# MinIO Storage
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false

# AI - System defaults (optional, users provide their own)
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_TOKENS=16384

# Veo 3 (Google)
VEO_PROJECT_ID=your-project-id
VEO_LOCATION=us-central1
```

### Frontend Build Args

```bash
VITE_API_URL=https://story-writing.com  # Production
VITE_API_URL=http://localhost:3001      # Development
```

## 🔐 Security

### Authentication & Authorization
- JWT-based session management
- Secure password hashing (bcrypt)
- All routes require authentication
- Redis-backed session storage

### Rate Limiting
- Login attempts: 5 per 15 minutes
- AI requests: 50 per 15 minutes per user
- Prevents abuse and DDoS attacks

### API Key Protection
- **v1.0.4+:** All AI features require user-provided API keys
- System API keys never used as fallback
- Users manage their own OpenAI/Gemini credits
- Clear error messages guide users to Profile > API Keys

### Input Validation
- Request validation on all endpoints
- SQL injection prevention (parameterized queries)
- XSS protection (sanitized inputs)
- File upload restrictions (type, size)

See [SECURITY.md](SECURITY.md) for security practices and key rotation.

## 📝 API Documentation

### Authentication

```bash
# Register
POST /api/auth/register
Body: { email, password, name }

# Login
POST /api/auth/login
Body: { email, password }

# Get current user
GET /api/auth/me
Headers: { Authorization: Bearer <token> }
```

### Books

```bash
# List books
GET /api/books

# Get book
GET /api/books/:id

# Create book
POST /api/books
Body: { bookTitle, author, genre, overview, ... }

# Update book
PUT /api/books/:id
Body: { bookTitle, chapters, characters, ... }

# Delete book
DELETE /api/books/:id
```

### AI Generation (Requires User API Keys)

```bash
# Generate text
POST /api/generate
Body: { prompt, context, model }
Headers: { Authorization: Bearer <token> }

# Generate image
POST /api/generate-image
Body: { prompt, aspectRatio }

# Generate audio
POST /api/generate-audio
Body: { text, voice, speed }

# Analyze continuity
POST /api/analyze-continuity
Body: { bookData }
```

## 📊 Project Structure

```
story-writing/
├── src/                    # Frontend React app
│   ├── components/        # React components
│   ├── App.jsx           # Main app component
│   └── main.jsx          # Entry point
├── server/                # Backend Node.js app
│   ├── index.js          # Express server
│   ├── ai-agent-orchestrator.js
│   ├── ai-import-analyzer.js
│   ├── jobs/             # Background jobs
│   ├── parsers/          # File parsers
│   ├── services/         # Business logic
│   └── utils/            # Utilities
├── public/               # Static assets
├── Dockerfile.backend    # Backend container
├── Dockerfile.frontend   # Frontend container
├── docker-compose.yml    # Local development
├── deploy.sh            # Deployment script
├── VERSION              # Current version
├── CHANGELOG.md         # Version history
└── README.md           # This file
```

## 🐛 Troubleshooting

### Backend won't start
- Check Redis is running: `docker ps`
- Verify .env file exists and has correct values
- Check logs: `docker logs story-writing-backend`

### Frontend can't connect to backend
- Verify VITE_API_URL in .env matches backend URL
- Check CORS settings in server/index.js
- Inspect browser console for errors

### AI features not working
- Users must add API keys in Profile > API Keys
- Check API key validity (OpenAI/Gemini dashboards)
- Review rate limits (50 requests per 15 min)

### Deployment issues
- Verify AWS credentials: `aws sts get-caller-identity`
- Check ECR login: `aws ecr get-login-password`
- Review ECS service events in AWS Console

## 📈 Roadmap

- [ ] Collaborative editing (multi-user books)
- [ ] Real-time chat with AI
- [ ] Advanced analytics and insights
- [ ] Mobile app (React Native)
- [ ] Plugin system for custom features
- [ ] Marketplace for templates and assets

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues:** [GitHub Issues](https://github.com/your-repo/issues)
- **Documentation:** This README and [DEPLOYMENT.md](DEPLOYMENT.md)
- **AWS Configuration:** See [aws/README.md](aws/README.md) for AWS-specific configs (not in version control)
- **Security:** [SECURITY.md](SECURITY.md)

## 📚 Version History

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

**Current Version:** 2.20.6 (Chapter Version Control + Autosave Fix)

---

Built with ❤️ for writers, by writers.


## 📚 Documentation

- **[CHANGELOG.md](CHANGELOG.md)** - Version history and release notes
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Deployment guide and CI/CD
- **[docs/AWS_DEPLOYMENT_REFERENCE.md](docs/AWS_DEPLOYMENT_REFERENCE.md)** - AWS infrastructure guide
- **[docs/AWS_SERVICES.md](docs/AWS_SERVICES.md)** - AWS services overview
- **[docs/FEATURES_AND_ROLES.md](docs/FEATURES_AND_ROLES.md)** - Feature list and user roles
- **[docs/SECURITY_TEST_CHECKLIST.md](docs/SECURITY_TEST_CHECKLIST.md)** - Security testing guide
- **[docs/SECURITY_TEST_REPORT.md](docs/SECURITY_TEST_REPORT.md)** - Latest security audit

## 🎯 Current Status (v2.20.6)

### Recent Features
- ✅ Chapter Version Control - Complete version history with smart versioning
- ✅ Writing Goals & Progress Tracking - Daily/weekly/monthly goals with streaks
- ✅ Template Books - Quick-start with sample books (Fantasy, Romance, Sci-Fi)
- ✅ Custom Focus Areas - User-defined continuity analysis areas
- ✅ Analysis History - Track continuity improvements over time
- ✅ AI Cost Tracking - Monitor token usage and costs

### Infrastructure
- **Backend**: AWS ECS Fargate (Node.js 20)
- **Frontend**: AWS ECS Fargate (Nginx + React)
- **Database**: AWS RDS PostgreSQL
- **Load Balancer**: AWS ALB with HTTPS
- **DNS**: Cloudflare
- **Storage**: AWS S3 for media files

### Known Issues
None currently - All critical hotfixes deployed


