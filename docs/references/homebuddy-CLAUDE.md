# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📋 Documentation Versioning & Updates

**Version**: 2.1 (Updated: 2025-08-05)

### When to Update This File
Claude should update CLAUDE.md when:
1. **New services are added** - Add to service architecture section
2. **New routes are created** - Update routes documentation  
3. **New frontend components** - Update component architecture
4. **Major feature implementations** - Add to Key Features section
5. **Development workflow changes** - Update commands or Docker setup

### Version History
- **v2.1** (2025-08-05): Added AppleTV integration, secure configuration system, wake word training
- **v2.0** (2025-01): Major architectural documentation overhaul
- **v1.x** (2024): Initial documentation

### ⚠️ Critical: Check These First
Before making changes, always check:
1. **`docs/development/DEVELOPER_QUICK_REFERENCE.md`** - For file locations and patterns
2. **Live database schema** - Run `docker exec homebuddy-postgres-1 psql -U homebuddy_user -d homebuddy -c "\dt"`
3. **Current service status** - Check `docker compose ps` for active services

## Project Overview

HomeBuddy is a voice-controlled kitchen assistant for family use. Currently focused on core inventory management with a structured foundation for voice integration via LLM intent extraction.

## Architecture

### Backend (Fastify + PostgreSQL)
- **Main Server**: `backend/index.js` - Fastify server with HTTPS, CORS, rate limiting, PostgreSQL, and WebSocket integration
- **Configuration**: `backend/config/constants.js` - Centralized configuration for all URLs, API endpoints, and settings
- **Service Architecture**: 
  - `services/inventory/inventoryService.js` - Inventory management with auto-consolidation
  - `services/voice/voiceCommandServiceSimple.js` - Simplified voice command processing pipeline with music control
  - `services/voice/intentExtractorSimple.js` - Pattern matching + LLM intent extraction
  - `services/voice/llmService.js` - Multi-provider LLM abstraction (OpenAI/Groq/Anthropic) with centralized configuration
  - `services/voice/sttService.js` - Speech-to-text using Groq/OpenAI Whisper APIs with centralized endpoints
  - `services/voice/securePromptBuilder.js` - **Secure LLM prompt construction** with injection protection
  - `services/simpleConfigService.js` - Configuration management for voice intents
  - `services/secureConfigService.js` - **Encrypted configuration storage** with AES-256-GCM encryption and audit logging
  - `services/encryptionService.js` - **Cryptographic service** for secure data encryption/decryption
  - `services/timerService.js` - Timer management functionality
  - `services/mealPlanService.js` - Comprehensive meal planning with recipe integration
  - `services/musicService.js` - **Spotify Connect integration** with librespot container control
  - `services/spotifyApiService.js` - **Spotify Web API service** with OAuth, device management, and playback control
  - `services/appleTvService.js` - **AppleTV Control** via Python pyatv service integration for media control
  - `services/weatherService.js` - **Australian weather integration** using Bureau of Meteorology API
  - `services/ngrokService.js` - **Dynamic tunnel management** for OAuth redirect URIs
  - `services/questionsService.js` - **Kids questions service** for family-friendly Q&A functionality
  - `services/websocketService.js` - Real-time WebSocket communication for timers, music, and live updates
  - `services/dataSweeper.js` - **Automated database cleanup service** with scheduled maintenance
  - `services/cleanup/` - **Modular cleanup tasks** (inventory duplicates, timer rotation, voice logs)
- **Models**: `models/InventoryItem.js` - Business logic for inventory items
- **Routes**: 
  - `routes/api/inventoryRoutes.js` - REST API for inventory CRUD + search
  - `routes/voice/voiceRoutesSimple.js` - Voice command processing endpoints with STT integration
  - `routes/api/configRoutesSimple.js` - Configuration management routes
  - `routes/api/secureConfigRoutes.js` - **Encrypted configuration management API** with secure CRUD operations
  - `routes/api/timerRoutes.js` - Timer management routes
  - `routes/api/mealPlanRoutes.js` - Comprehensive meal planning API
  - `routes/api/musicRoutes.js` - **Spotify Connect control API** with playback, volume, and search
  - `routes/api/deviceRoutes.js` - **Spotify device management** and discovery API
  - `routes/api/appleTvRoutes.js` - **AppleTV control API** for media device management and remote control
  - `routes/auth/spotifyAuthRoutes.js` - **Spotify OAuth authentication** with dynamic redirect URIs
  - `routes/api/weatherRoutes.js` - **Australian weather data API** with BOM integration
  - `routes/api/ngrokRoutes.js` - **Tunnel management API** for dynamic OAuth endpoints
  - `routes/api/questionsRoutes.js` - **Kids questions API** for family-friendly educational content
  - `routes/api/cleanupRoutes.js` - **Database cleanup management API** with manual controls

### Database Schema (Enhanced)
PostgreSQL with comprehensive family kitchen support:
- **Core Tables**: `inventory_items`, `recipes`, `meal_plans`, `timers`
- **Family Features**: `family_members`, `shopping_lists`, `shopping_list_items`
- **Voice System**: `voice_commands` (command history), `cooking_sessions`
- **Music Integration**: `spotify_tokens`, `current_playback_state`, `track_metadata`, `spotify_devices`
- **Weather Data**: Weather caching and station management tables
- **Maintenance**: `cleanup_logs` (automated database maintenance tracking)
- **Enhancements**: Recipe scaling, consolidation tracking, low stock alerts

### Frontend (React + Vite + Tailwind)
- **Main Dashboard**: `src/components/pages/HomeBuddyDashboard.jsx` - Voice-integrated dashboard with expandable cards
- **Tech Stack**: React 19 + Vite 7 + TanStack Query 5.84 + Tailwind CSS 4.1 + Framer Motion 12.23 + Zustand 5.0
- **Voice Integration**: Complete voice state management, Web Audio API, real-time audio visualization
- **Component Architecture** (Reorganized):
  - **Cards System**: `cards/ExpandableCard.jsx`, `InventoryCard.jsx`, `TimerCard.jsx`, `DinnerTonightCard.jsx`, `MusicCard.jsx`, `AppleTvCard.jsx`
  - **Expanded Views**: `expandedViews/InventoryExpandedView.jsx`, `TimersExpandedView.jsx`, `DinnerTonightExpandedView.jsx`, `MusicExpandedView.jsx`
  - **Voice Components**: `voice/VoiceFeedback.jsx`, `voice/VoiceVisualizer.jsx`, `voice/VoiceCard.jsx`, `voice/WakeWordTraining.jsx`
  - **Weather Components**: `weather/WeatherIcon.jsx`, `weather/WeatherPopover.jsx`
  - **Feedback Components**: `feedback/ConnectionError.jsx`, `feedback/SystemStatusIndicator.jsx`
  - **UI Library**: `ui/Button.jsx`, `ui/Card.jsx`, `ui/Input.jsx`, `ui/Modal.jsx`, `ui/ConfirmModal.jsx`, `ui/ValidatedInput.jsx`, `ui/alert.jsx`
  - **Common Components**: `common/TimerRing.jsx`, `common/BlobBackground.tsx`, `background/DashboardBackground.jsx`
  - **Device Management**: `DeviceSelector.jsx` - Spotify device selection interface
  - **Settings & Config**: `modals/SettingsModal.jsx` - Application settings interface
- **State Management**: 
  - `stores/voiceStore.js` - Zustand voice state with VOICE_STATES enum
  - `contexts/ThemeContext.jsx` - Dark/light mode with persistence
- **Hooks**: 
  - `hooks/useRecording.js` - Web Audio API recording functionality
  - `hooks/useVoiceState.js` - Voice state management integration
  - `hooks/useSecureConfig.js` - Encrypted configuration management
  - `hooks/useCustomWakeWord.js` - Custom wake word training and detection
  - `hooks/usePorcupineWakeWord.js` - Porcupine wake word engine integration
  - `hooks/useSystemAudio.js` - System audio handling and monitoring
- **Services**: 
  - `services/api.js` - Backend API client with music, weather, and device endpoints
  - `services/websocketService.js` - Real-time communication for timers and music updates
- **Debug Interface**: `src/components/pages/DebugPage.jsx` - Complete testing interface

### Frontend Dependencies (Current)
- **React 19** + **React DOM 19** - Core framework
- **Vite 7** - Build tool and dev server
- **TanStack Query 5.84** - Server state management
- **Tailwind CSS 4.1** - Utility-first CSS framework
- **Framer Motion 12.23** - Animation library
- **Zustand 5.0** - Client state management
- **Lucide React 0.535** - Icon library
- **Radix UI** - Headless UI components (Dialog, Dropdown, Slot, Toast)
- **Class Variance Authority** - Component variant management
- **Tailwind Merge** - Tailwind class merging utility

## Development Commands

**IMPORTANT**: This application runs in Docker containers. Use `docker exec` to access containers for development tasks.

### Docker Container Management
```bash
# Start all services
docker compose up -d

# Check running containers
docker compose ps

# View logs
docker compose logs backend
docker compose logs frontend
docker compose logs postgres
docker compose logs spotify

# Stop all services
docker compose down
```

### Backend Development (In Container)
```bash
# Access backend container
docker exec -it homebuddy-backend-1 bash

# Inside container:
npm run dev          # Start development server with nodemon
npm test             # Run tests (if available)
npm run lint         # Run linting (if configured)
```

### Frontend Development (In Container)
```bash
# Access frontend container  
docker exec -it homebuddy-frontend-1 bash

# Inside container:
npm run dev          # Start Vite development server with HTTPS
npm run build        # Build for production
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

### Database Operations (In Container)
```bash
# Access PostgreSQL container
docker exec -it homebuddy-postgres-1 psql -U homebuddy_user -d homebuddy

# Or run SQL commands directly
docker exec homebuddy-postgres-1 psql -U homebuddy_user -d homebuddy -c "SELECT * FROM inventory_items LIMIT 5;"

# View database structure
docker exec homebuddy-postgres-1 psql -U homebuddy_user -d homebuddy -c "\dt"
```

**HTTPS Configuration**: Both frontend and backend support HTTPS using self-signed certificates in respective `certs/` directories

### Testing API & Frontend (Docker Environment)

**⚠️ IMPORTANT: Frontend runs on different machine - DO NOT use localhost for API testing from frontend machine**

```bash
# Check docker container ports and status (on Docker host machine)
docker compose ps

# Test APIs from Docker host machine (where containers run)
curl -k https://localhost:3000/api/inventory

# Test voice command API (text mode) 
curl -k -X POST https://localhost:3000/api/voice/text \
  -H "Content-Type: application/json" \
  -d '{"transcript": "add milk to fridge", "userId": null}'

# Test music voice commands
curl -k -X POST https://localhost:3000/api/voice/text \
  -H "Content-Type: application/json" \
  -d '{"transcript": "play some jazz music", "userId": null}'

# Test WebSocket health endpoint
curl -k https://localhost:3000/ws/health

# Test meal planning API
curl -k -X POST https://localhost:3000/api/meal-plans \
  -H "Content-Type: application/json" \
  -d '{"meal_date": "2024-01-15", "meal_name": "Breakfast"}'

# Test music control APIs
curl -k https://localhost:3000/api/music/status
curl -k -X POST https://localhost:3000/api/music/toggle
curl -k https://localhost:3000/api/music/devices

# Test weather API
curl -k https://localhost:3000/api/weather/current

# ⚠️ Frontend Access: 
# Frontend runs on separate machine - uses configured API endpoints
# DO NOT test with localhost from frontend machine

# Alternative: Test APIs from within backend container
docker exec -it homebuddy-backend-1 bash
# Inside container, APIs are available at localhost:3000

# CRITICAL: SSL Certificate Setup
# 1. Open backend API URL in browser from frontend machine
# 2. Accept the security warning for self-signed certificate  
# 3. This allows frontend to make API calls successfully
# 4. Frontend API calls use the configured hostname, NOT localhost
```

### ⚠️ **API Endpoint Rules**
- **From Docker host**: Use `localhost:3000` for testing
- **From frontend machine**: Use configured hostname/IP (already set in code)
- **Never change frontend API endpoints to localhost**
- **Always test SSL certificate acceptance from frontend machine first**

### Container Debugging & Development
```bash
# Check container logs in real-time
docker compose logs -f backend
docker compose logs -f frontend

# Restart specific service
docker compose restart backend
docker compose restart frontend

# Rebuild containers after code changes
docker compose build backend
docker compose build frontend
docker compose up -d

# Access container shells for debugging
docker exec -it homebuddy-backend-1 bash    # Backend shell
docker exec -it homebuddy-frontend-1 bash   # Frontend shell
docker exec -it homebuddy-postgres-1 bash   # Database shell

# View container resource usage
docker stats homebuddy-backend-1 homebuddy-frontend-1 homebuddy-postgres-1
```

## Environment Setup (Docker)

The application runs entirely in Docker containers. Environment variables are managed via `.env` files:

### Required Environment Variables
- **Database**: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_URL`
- **LLM Integration**: `GROQ_DEV_API_KEY` (Groq API key for intent extraction)
- **Spotify Integration**: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` (Optional - for Spotify Web API)

### Container Environment
- **Backend**: Runs on Node.js container with auto-restart on file changes
- **Frontend**: Runs on Vite development server with HMR (Hot Module Replacement)
- **Database**: PostgreSQL container with persistent volume
- **Spotify/Librespot**: Spotify Connect device running as "HomeBuddy" with host networking for mDNS discovery
- **Networking**: All containers communicate via Docker compose network (except Spotify which uses host mode)

### ⚠️ **CRITICAL: Frontend API Configuration**
**DO NOT CHANGE API ENDPOINTS OR IP ADDRESSES IN FRONTEND CODE**

The frontend is configured to run from a different machine and connects to the backend container. The API endpoints in the frontend code are specifically configured for this setup:

```javascript
// frontend/src/services/api.js - DO NOT MODIFY THESE ENDPOINTS
const API_BASE_URL = 'https://your-backend-host:3000'  // Already configured correctly
```

**Important Notes:**
- Frontend runs on a separate machine from the Docker containers
- API calls are already configured with the correct IP/hostname
- Changing localhost or IP addresses in frontend code will break the connection
- The backend container is accessible via the configured hostname/IP
- **Never change API endpoints to localhost when frontend runs remotely**

### Development Workflow
1. **Start containers**: `docker compose up -d` (on Docker host machine)
2. **Access container shells**: Use `docker exec -it <container-name> bash` 
3. **Run commands inside containers**: All npm/node commands should be run within containers
4. **View logs**: `docker compose logs -f <service-name>`
5. **Test changes**: File changes auto-reload in development containers
6. **⚠️ Frontend development**: Run from separate machine - API endpoints already configured
7. **⚠️ DO NOT modify API URLs**: Frontend API calls use configured hostname, never localhost

## 📚 Documentation Organization

All project documentation is organized in the `docs/` directory:

### Quick Reference for Development
- **`docs/development/DEVELOPER_QUICK_REFERENCE.md`** - File locations, API endpoints, database schemas, common commands
- **`docs/development/CODE_PATTERNS_REFERENCE.md`** - Copy-paste templates for React components, backend services, database patterns

### Architecture Documentation  
- **`docs/architecture/BACKEND_ARCHITECTURE.md`** - Complete backend services and API documentation
- **`docs/architecture/FRONTEND_ARCHITECTURE.md`** - React component structure and state management
- **`docs/architecture/DATABASE_ARCHITECTURE.md`** - Complete database schema (27+ tables)

### Security & Production
- **`docs/security/SECURITY_ANALYSIS.md`** - LLM prompt injection vulnerabilities and fixes
- **`docs/security/COMPREHENSIVE_SECURITY_SCAN.md`** - Web application security analysis (15 vulnerabilities)
- **`docs/development/DATABASE_MAINTENANCE.md`** - Automated cleanup system

### Planning & Features
- **`docs/planning/ROADMAP.md`** - Project roadmap and development status
- **`docs/features/PICOVOICE_SETUP.md`** - Wake word detection setup guide
- **`docs/features/VOICE_COMMANDS_REFERENCE.md`** - **Complete voice commands documentation** with all supported intents, patterns, and examples

**For quick development**: Always check `docs/development/DEVELOPER_QUICK_REFERENCE.md` first to find files, APIs, and patterns without searching.

## Key Features

### Inventory Management
- **Auto-consolidation**: Duplicate items automatically merged
- **Smart search**: Fuzzy matching for voice commands
- **Location tracking**: Detailed pantry/fridge/freezer organization
- **Alerts**: Low stock and expiration warnings
- **Family tracking**: Who added items, purchase history

### Voice Command Processing
- **Dual-mode intent extraction**: Pattern matching + LLM fallback
- **Multi-provider LLM support**: OpenAI, Groq, Anthropic with centralized configuration
- **Centralized API endpoints**: All service URLs managed in `config/constants.js`
- **Supported intents**: inventory.*, recipe.*, timer.*, shopping.*, meal.*, music.*
- **Entity extraction**: Items, quantities, locations, durations
- **Command logging**: Full audit trail with confidence scores

### Real-time Communication
- **WebSocket integration**: Socket.io for live timer and music updates with notifications
- **Timer lifecycle events**: Real-time broadcasting of timer state changes
- **Music playback events**: Real-time Spotify Connect playback state updates
- **Health monitoring**: WebSocket service status and connection tracking
- **Namespace isolation**: `/timers` and `/music` namespaces for feature-specific events

### Music Integration (Implemented) 
- **Spotify Connect**: Full integration with librespot-java container running as "HomeBuddy" device
- **Voice Control**: Play, pause, skip, volume control via voice commands ("play [song/artist]", "pause music", etc.)
- **Device Management**: Automatic device discovery and activation with fallback to other Spotify devices
- **Real-time Updates**: WebSocket integration for live playback state synchronization
- **Search Integration**: Spotify Web API search with intelligent result selection (tracks, albums, playlists, artists)
- **OAuth Authentication**: Dynamic redirect URI management with ngrok tunnel support
- **Playback State**: Full tracking of currently playing track, volume, progress, and device status

### Weather Integration (Implemented)
- **Australian Weather Data**: Integration with Bureau of Meteorology (BOM) official API
- **Real Weather Stations**: Uses actual Australian weather station data with proper locations
- **Current Conditions**: Temperature, humidity, wind speed, pressure, and conditions
- **Weather Icons**: Custom weather icon components with condition-specific displays
- **Caching**: 15-minute cache duration to minimize API calls while maintaining accuracy
- **No API Key Required**: Uses free BOM JSON endpoints for reliable data access

### Meal Planning (Implemented)
- **Weekly planning**: Add meals to specific days of the week
- **Recipe integration**: Link existing recipes to meal plans
- **Flexible querying**: Get meals by date, date range, or weekly view
- **Shopping list generation**: Auto-generate shopping lists from planned meals
- **Meal suggestions**: Basic suggestion system based on available recipes
- **Convenience endpoints**: Today's meals and this week's meals

### Family Kitchen Features
- **Shopping lists**: Auto-generation from low stock + recipes
- **Cooking sessions**: Multi-step recipe guidance with timers
- **Family members**: Individual preferences and dietary restrictions
- **Recipe scaling**: Automatic portion adjustments

### Frontend Voice Features (Implemented)
- **Voice State Management**: Zustand store with VOICE_STATES (idle, listening, processing, responding, error)
- **Audio Visualization**: Real-time waveform display during recording
- **Recording Integration**: Web Audio API with permission handling and audio level monitoring
- **Visual Feedback**: Voice processing states with Framer Motion animations
- **Theme Support**: Dark/light mode with persistence
- **Dashboard Integration**: Voice controls embedded in main interface

### Database Sweeper Service (Automated Maintenance)
- **Modular Cleanup Framework**: Extensible base class for all maintenance tasks
- **Smart Inventory Consolidation**: Fuzzy matching to merge duplicate items with configurable confidence thresholds
- **Timer Lifecycle Management**: Automatic cleanup of completed/cancelled timers with retention policies
- **Voice Log Rotation**: Intelligent command history management preserving learning examples
- **Scheduled Operations**: Cron-based automation (daily/weekly/monthly) with configurable schedules
- **Safety Mechanisms**: Transaction rollback, dry-run testing, and maximum operation limits
- **Real-time Monitoring**: WebSocket notifications and comprehensive logging in `cleanup_logs` table
- **REST API Control**: Manual cleanup triggers, configuration management, and health monitoring
- **Production Ready**: Atomic operations, error handling, and graceful degradation

### AppleTV Integration (New)
- **Python pyatv Service**: Integration with external Python service for AppleTV discovery and control
- **Device Management**: Automatic discovery, pairing status tracking, and device information caching
- **Remote Control**: Play, pause, skip, volume control, and app launching via voice commands
- **Real-time Updates**: WebSocket integration for live AppleTV state synchronization
- **Voice Command Support**: "play on apple tv", "pause apple tv", "open Netflix on apple tv"
- **Multi-device Support**: Handle multiple AppleTV devices with device selection
- **Status Monitoring**: Track connection status, playback state, and app information

### Secure Configuration System (New)
- **AES-256-GCM Encryption**: Military-grade encryption for all sensitive configuration values
- **Audit Logging**: Complete audit trail of all configuration changes with user tracking
- **In-memory Caching**: Performance optimization with configurable TTL for frequently accessed values
- **WebSocket Updates**: Real-time configuration change notifications to connected clients
- **Backup & Restore**: Export/import capabilities for configuration backup and disaster recovery
- **Web Interface**: User-friendly configuration management through secure web interface
- **Migration Tools**: Automated migration from environment variables to encrypted storage

### Wake Word Detection (Enhanced)
- **Custom Training System**: User-friendly interface for training personalized "Hey HomeBuddy" wake words
- **Dual Engine Support**: Both Porcupine commercial engine and custom training system
- **Audio Fingerprinting**: Advanced audio analysis for accurate wake word detection
- **Training Progress**: Visual feedback and validation during wake word training process
- **Template Management**: Save, load, and manage multiple wake word templates
- **System Audio Integration**: Real-time audio monitoring and processing
- **Known Issue Fixed (2025-08-07)**: Resolved wake word detection blocking after cooldown - removed Date.now() reset that prevented detections for 1.5 seconds post-cooldown

### Kids Questions Service (New)
- **Family-Friendly Q&A**: Curated question and answer system for educational content
- **Voice Integration**: Ask questions via voice commands and receive spoken responses
- **Content Management**: Administrative interface for managing questions and answers
- **Learning Tracking**: Track frequently asked questions and learning patterns

## Voice Integration (Backend Ready, Frontend Implemented)

The system provides comprehensive voice capabilities:
1. **Frontend**: Complete voice UI with recording, visualization, and state management
2. **Intent Processing**: `POST /api/voice/text` for testing voice commands with music integration
3. **Audio Processing**: `POST /api/voice/process` (STT service ready)
4. **Command History**: `GET /api/voice/history`
5. **Suggestions**: `GET /api/voice/suggestions`
6. **Music Commands**: Full voice control for Spotify playback ("play [song]", "pause music", "skip track")
7. **Real-time Updates**: WebSocket events for timer, music, and system notifications

## Database Architecture

**IMPORTANT**: When working with database-related tasks, always reference `docs/architecture/DATABASE_ARCHITECTURE.md` for the complete, verified schema documentation.

Schema is split into files:
- `init-scripts/01_schema.sql` - Original tables
- `init-scripts/02_family_enhancements.sql` - Family/voice features
- `init-scripts/05_timers.sql` - Timer system tables

**Live Database**: Contains 21 total tables (verified current). Many tables beyond the schema files exist due to runtime migrations and application evolution. See `DATABASE_ARCHITECTURE.md` for complete documentation including food catalog system, voice intent management, and storage locations.

### Database Access
```bash
# Query live database structure
docker exec homebuddy-postgres-1 psql -U homebuddy_user -d homebuddy -c "\dt"

# Describe specific table
docker exec homebuddy-postgres-1 psql -U homebuddy_user -d homebuddy -c "\d table_name"

# Database credentials (from .env)
POSTGRES_USER=homebuddy_user
POSTGRES_PASSWORD=079272438d419b15ce5647dc
POSTGRES_DB=homebuddy
```

## Recent Improvements & Next Steps

### ✅ Recently Completed
1. **✅ Centralized Configuration**: All URLs and constants moved to `backend/config/constants.js`
2. **✅ WebSocket Integration**: Real-time timer and music updates via Socket.io with `/timers` and `/music` namespaces
3. **✅ HTTPS Support**: SSL certificate auto-detection for both frontend and backend
4. **✅ Frontend Voice UI**: Complete voice interface with recording, visualization, and state management
5. **✅ Enhanced LLM Integration**: Multi-provider support with standardized configuration
6. **✅ Component Architecture**: Full UI library with expandable cards and animations organized into feature directories
7. **✅ Spotify Connect Integration**: Complete music control with librespot-java container and Spotify Web API
8. **✅ Weather Integration**: Australian Bureau of Meteorology API with real weather station data
9. **✅ Music Voice Commands**: Voice control for Spotify playback (play, pause, skip, volume, search)
10. **✅ Device Management**: Spotify device discovery, selection, and automatic activation
11. **✅ OAuth Integration**: Dynamic ngrok tunnel support for Spotify authentication
12. **✅ AppleTV Integration**: Python pyatv service integration with voice control and WebSocket updates
13. **✅ Secure Configuration System**: AES-256-GCM encrypted configuration storage with audit logging
14. **✅ Wake Word Training**: Custom wake word training interface with audio fingerprinting
15. **✅ Kids Questions Service**: Family-friendly Q&A system with voice integration
16. **✅ Enhanced Security**: Secure prompt building and LLM injection protection

### 🚧 Current Priority Tasks
1. **STT Service Integration**: Complete audio-to-text processing pipeline
2. **AppleTV Voice Commands**: Integrate AppleTV control with voice command system
3. **Wake Word Production**: Deploy custom wake word training in production environment
4. **Configuration Migration**: Complete migration from environment variables to secure storage
5. **Voice Command Testing**: End-to-end voice command workflows for all integrated services

### 📋 Future Enhancements
1. **Enhanced Voice Commands**: Complete inventory/timer/recipe voice control
2. **Multi-modal Interactions**: Seamless voice + touch integration
3. **Voice Analytics**: Usage patterns and command optimization
4. **Offline Voice Support**: Local processing capabilities
5. **Advanced Weather Features**: Weather alerts, forecasts, and seasonal cooking suggestions
6. **Spotify Premium Features**: Playlist creation, library management, and personalized recommendations