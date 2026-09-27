<p align="center">
  <img src="frontend/src/assets/logo.webp" alt="OneSpace Logo" width="192">
</p>

# OneSpace

[![Go](https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://golang.org/) [![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/) [![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/) [![MongoDB Atlas](https://img.shields.io/badge/MongoDB_Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/atlas) [![Render](https://img.shields.io/badge/Render-000000?style=for-the-badge&logo=render&logoColor=white)](https://render.com/) [![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)

**OneSpace** is a high-performance multi-cloud drive aggregation platform that unifies disparate cloud storage accounts into a single, intuitive workspace. Powered by a native compiled **Go** backend hosted on Render and a responsive **Vite** web frontend distributed globally over Vercel Edge CDN, OneSpace enables users to browse, upload, stream, search, and manage files across all their connected accounts from one unified interface.

---

## ✨ Key Features

### ☁️ Multi-Provider Cloud Aggregation
- Connect multiple cloud storage accounts across different providers in a single application.
- Normalizes disparate APIs (**Google Drive**, **Google Photos**, **Dropbox**, **MEGA**) through a unified adapter layer.
- Handles OAuth 2.0 authorization code flows, direct credentials, and automatic token refresh cycles.

### 🗂️ Unified File Workspace
- **Virtual Path Navigation**: Navigate files and subdirectories seamlessly as if they were on a single local filesystem.
- **Dedicated Views**: `Home` command center, `My Drive` explorer, `Recent` files, `Starred` items, and `Storage Quota`.
- **Google Photos Hierarchy**: Automatically discovers photo albums and recent media items, mapping them into dedicated virtual directories with accurate thumbnail and download links.

### 📁 Comprehensive File Operations
- Preview images, documents, and media streams inline without pre-downloading.
- Create virtual folders, rename items, toggle stars, download files, and perform bulk deletions.
- Full text search with instant autocomplete across all connected cloud storage pools.

### ⬆️ High-Speed Streaming Uploads
- Drag-and-drop and directory folder upload capabilities.
- Zero-copy streaming uploads directly from client to cloud provider with real-time WebSocket progress tracking.
- **Smart Allocation Engine**: Dynamically routes uploads to the best cloud account using strategies like `most_free`, `least_used`, or `round_robin`.

### 🔄 Low Memory Footprint & High Performance
- **Native Go Backend**: Compiled binary with an ultra-lightweight memory footprint (~15–25 MB RAM), completely eliminating out-of-memory crashes on free-tier containers.
- **Automatic Wake-Up & Keep-Alive**: Frontend automatically pings sleeping Render containers upon load and maintains a keep-alive heartbeat.
- **Live Status Indicator**: Visual pill and top alert banner clearly displaying `Render Active` or `Render Inactive / Waking Up`.
- **MongoDB Atlas Integration**: Cloud persistence that stores account links, file trees, and user preferences across deployments.
- **In-Memory Cache**: High-speed RAM indexing for instantaneous path resolution and sub-millisecond folder listing.
- **Automatic & Scheduled Sync**: Periodic background synchronization across all connected accounts with on-demand manual sync triggers.

### 👤 Secure Authentication Modes
- **`hosted` Mode**: Multi-user cloud deployment featuring **Google 1-Click OAuth Sign-In** with secure `HttpOnly`, `SameSite=None`, `Secure` session cookies.
- **`local` Mode**: Zero-login personal deployment for local machine or home server use.
- **AES-256-GCM Encryption**: Account credentials and refresh tokens are encrypted at rest using persistent environment secrets.

---

## ☁️ Supported Cloud Providers

| Provider | Status | Integration Model | Capabilities |
| :--- | :--- :--- | :--- |
| **Google Drive** | ✅ Active | OAuth 2.0 (Google Drive API v3) | Full virtual hierarchy, upload, download, rename, star, delete |
| **Google Photos** | ✅ Active | OAuth 2.0 (Photos Library API) | Virtual folder tree, album browsing, media preview, direct download |
| **Dropbox** | ✅ Active | OAuth 2.0 (Dropbox API v2) | File management, chunked uploads, rename, delete |
| **MEGA** | ✅ Active | Direct account connection | Client-side encrypted cloud storage |

> 📖 **Setup Guide**: Detailed steps to get API credentials for all providers are documented in [`provider-setup.md`](provider-setup.md).

---

## 🏗️ Architecture & Data Flow

```mermaid
flowchart TD
    U[User] --> F[Frontend Web UI<br/>Vercel Edge CDN + Vite SPA]
    F -->|REST / WebSocket requests| B[Backend API<br/>Render Web Service + Go Chi]

    subgraph Frontend Workspace (Vercel)
        F1[Google 1-Click Auth]
        F2[Account Manager]
        F3[Virtual File Explorer]
        F4[Streaming Upload Hub]
        F5[Backend Status & Wake Manager]
    end

    F --> F1
    F --> F2
    F --> F3
    F --> F4
    F --> F5

    subgraph Backend Engine (Render)
        B --> A[Cloud Adapter Registry]
        A --> G[Google Drive Adapter]
        A --> GP[Google Photos Adapter]
        A --> D[Dropbox Adapter]
        A --> M[MEGA Adapter]

        B --> AL[Allocation Engine<br/>most_free / least_used / round_robin]
        B --> SY[Concurrent Sync Engine<br/>Goroutines + Scheduled Delta Sync]
        B --> WS[WebSocket Progress Hub]
    end

    subgraph External Cloud APIs
        G --> C1[Google Drive API v3]
        GP --> C2[Google Photos Library API]
        D --> C3[Dropbox API v2]
        M --> C4[MEGA API]
    end

    subgraph Persistence Layer
        B --> MEM[In-Memory Query Cache]
        MEM <-->|Async Sync / Hydration| MONGO[(MongoDB Atlas<br/>Production Database)]
    end

    WS -->|Progress Stream| F
```

---

## 🚀 Cloud Deployment

Deploy OneSpace using **Render** for the Go backend API and **Vercel** for the edge-optimized web frontend.

### 1. Backend: Deploy to Render (Go API)
1. Fork or push this repository to GitHub.
2. In [Render](https://render.com/), click **New +** → **Blueprint**.
3. Select your repository. Render uses [`render.yaml`](render.yaml) to provision the `onespace-api` Web Service.
4. Fill in the required environment variables:
   - `MONGODB_URI`: Your MongoDB Atlas connection string.
   - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: Your Google Cloud OAuth credentials.
   - `CORS_ORIGIN`: Your frontend URL (e.g. `https://onespace-web.vercel.app`).
   - `FRONTEND_URL`: Your frontend URL.
5. Click **Apply**.

### 2. Frontend: Deploy to Vercel (Edge UI)
1. In [Vercel](https://vercel.com/new), import your `OneSpace` GitHub repository.
2. Configure Project Settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Add Environment Variables:
   - `VITE_API_BASE_URL`: `https://onespace-api-hkdi.onrender.com/api`
   - `VITE_WS_BASE_URL`: `wss://onespace-api-hkdi.onrender.com/ws/uploads`
4. Click **Deploy**. Vercel will build the frontend with automatic SPA rewrites using [`frontend/vercel.json`](frontend/vercel.json).

### 3. Configure OAuth Authorized Origins
- In [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**:
  - Add your Vercel URL (e.g. `https://onespace-web.vercel.app`) to **Authorized JavaScript origins**.
  - Keep the backend redirect URI (e.g. `https://onespace-api-hkdi.onrender.com/api/accounts/google/callback`) in **Authorized redirect URIs**.

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- **Go**: 1.24 or higher
- **Node.js**: v20 or higher
- **npm**: v9 or higher

### 2. Clone & Install
```bash
git clone https://github.com/chandanraj-03/OneSpace.git
cd OneSpace
npm install
```

### 3. Environment Configuration
Create `backend/.env` from the provided template:
```bash
# Windows PowerShell
copy backend\.env.example backend\.env

# Linux / macOS
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your credentials:
```env
PORT=8787
APP_MODE=local

CORS_ORIGIN=http://localhost:5173
FRONTEND_URL=http://localhost:5173

SYNC_INTERVAL_MINUTES=5
ONESPACE_SECRET_HALF=change-this-to-a-random-secret
AUTH_SECRET=change-this-to-a-random-auth-secret

# Optional: MongoDB Atlas URI for persistent cloud storage locally
MONGODB_URI=

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:8787/api/accounts/google/callback

DROPBOX_CLIENT_ID=your_dropbox_key
DROPBOX_CLIENT_SECRET=your_dropbox_secret
DROPBOX_REDIRECT_URI=http://localhost:8787/api/accounts/dropbox/callback
```

### 4. Run Development Servers
Start both the Go backend API and the Vite frontend dev server concurrently:
```bash
npm run dev
```

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:8787](http://localhost:8787)
- **Health Check**: [http://localhost:8787/api/health](http://localhost:8787/api/health)

---

## 📌 Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Runs both Vite frontend and Go backend concurrently |
| `npm run build` | Builds frontend production bundle and compiles Go backend binary |
| `npm run build:web` | Builds frontend production bundle (`frontend/dist`) |
| `npm run build:api` | Compiles the Go binary into `backend/bin/server` |
| `npm run dev:web` | Starts only the Vite frontend dev server |
| `npm run dev:api` | Starts only the Go API server with `go run ./cmd/server` |
| `npm start` | Runs the compiled Go production server |

---

## 🔌 API Reference Overview

### 🔐 Authentication
- `GET /api/auth/me`: Retrieve current session and user profile.
- `GET /api/auth/google/url`: Generate Google OAuth 2.0 authorization URL for 1-click sign-in.
- `GET /api/auth/google/callback`: Handle Google OAuth callback and session creation.
- `POST /api/auth/logout`: Invalidate current session and clear auth cookies.

### ☁️ Cloud Accounts & Synchronization
- `GET /api/accounts`: List all connected cloud accounts and their storage quotas.
- `DELETE /api/accounts/:id`: Disconnect and remove a cloud account.
- `GET /api/accounts/google/connect`: Initiate OAuth connection for Google Drive.
- `GET /api/accounts/google-photos/connect`: Initiate OAuth connection for Google Photos.
- `GET /api/accounts/dropbox/connect`: Initiate OAuth connection for Dropbox.
- `POST /api/accounts/mega/connect`: Connect MEGA account with email and password.
- `POST /api/sync/run`: Trigger immediate delta synchronization across all connected accounts.
- `GET /api/sync/status`: Check current sync status, scan metrics, and account diagnostics.

### 🗃️ Virtual Files & Folders
- `GET /api/files?path=/`: List files and folders in a virtual directory.
- `GET /api/files?recent=1`: List recently modified or uploaded files.
- `GET /api/files?starred=1`: List starred files.
- `GET /api/files/:id`: Get file metadata and download link.
- `POST /api/files/folders`: Create a new virtual folder.
- `PATCH /api/files/:id/rename`: Rename a file or folder across its cloud provider.
- `PATCH /api/files/:id/star`: Toggle starred state.
- `DELETE /api/files/:id`: Delete a file from its target cloud provider.
- `POST /api/files/bulk/delete`: Bulk delete multiple files and folders.
- `GET /api/files/:id/download`: Stream file download directly to client.
- `GET /api/files/:id/preview`: Inline preview for images, documents, and media.

### ⬆️ Uploads & Storage Allocation
- `POST /api/uploads/initiate`: Initiate upload session and determine target cloud account.
- `POST /api/uploads/:uploadId/stream`: Stream file data directly to the target cloud provider.
- `GET /ws/uploads?uploadId=...`: Real-time WebSocket connection for live upload progress.
- `GET /api/allocation`: Get active storage allocation strategy.
- `PATCH /api/allocation`: Update allocation strategy (`most_free`, `least_used`, `round_robin`).

---

## 🔒 Security & Data Privacy

- **Zero Plaintext Secrets**: Credentials and refresh tokens are encrypted at rest with AES-256-GCM.
- **Cross-Site Cookie Security**: In hosted mode, auth tokens are transmitted via `HttpOnly`, `SameSite=None`, `Secure` cookies.
- **Verified Sign-In**: Hosted mode enforces Google OAuth 2.0 to prevent spam accounts and unauthorized registration.

---

## 👤 Author

**Chandan Raj**
- GitHub: [@chandanraj-03](https://github.com/chandanraj-03)
- Repository: [chandanraj-03/OneSpace](https://github.com/chandanraj-03/OneSpace)

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).
