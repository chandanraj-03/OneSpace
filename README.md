<p align="center">
  <img src="frontend/src/assets/logo.webp" alt="OneSpace Logo" width="192">
</p>

# OneSpace

[![Go](https://img.shields.io/badge/Go-1.24+-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://golang.org/) [![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/) [![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/) [![MongoDB Atlas](https://img.shields.io/badge/MongoDB_Atlas-Cloud-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/atlas) [![Render](https://img.shields.io/badge/Render-Hosted-000000?style=for-the-badge&logo=render&logoColor=white)](https://render.com/) [![WebSocket](https://img.shields.io/badge/WebSocket-Live_Streams-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

**OneSpace** is a high-performance, edge-accelerated multi-cloud drive aggregation platform that unifies multiple cloud storage accounts into a single, cohesive, intuitive workspace. Powered by a lightning-fast native **Go** backend hosted on Render and a sleek, responsive **Vite** web frontend distributed globally over Vercel Edge CDN, OneSpace empowers users to browse, upload, stream, search, and manage files seamlessly across disparate cloud providers from one unified dashboard.

---

## ✨ Key Features & UX Innovations

### ☁️ Multi-Provider Cloud Storage Aggregation
- **Unified Cloud Pool**: Connect multiple cloud storage accounts across **Google Drive**, **Dropbox**, and **MEGA** into a single aggregated storage quota.
- **Unified Adapter Layer**: Normalizes disparate vendor APIs into a standard filesystem interface with automatic token refreshes and background delta reconciliation.
- **Client-Side Encrypted Storage**: Zero plaintext secrets. Tokens and credentials are protected with **AES-256-GCM** encryption using persistent environment secrets.

### 🗂️ Unified Virtual Workspace
- **Virtual Path Navigation**: Browse nested folders and directory structures across all accounts as if they resided on a single local disk.
- **Dedicated Workspaces**: `Home` command center, `My Drive` tree explorer, `Recent` file stream, `Starred` collection, and `Storage Quota` dashboard.
- **Dynamic Filtering & Search**: Instant real-time search with provider filtering, size sorting, and folder hierarchy navigation.

### 🔍 File Inspector Slide-Over Drawer
- **Deep Item Insights**: Press <kbd>Alt</kbd> + <kbd>I</kbd> or right-click to inspect any file's metadata in a dedicated slide-over panel.
- **Rich File Diagnostics**: View file size, MIME type, direct virtual path, cloud account owner, and formatted modification timestamps.
- **One-Click Actions**: Quick download, copy direct stream link, generate mobile QR code, rename, star, or delete without leaving the current view.

### 🖼️ Preview Carousel & Quick Look
- **Quick Look (<kbd>Space</kbd>)**: Instantly preview documents, images, audio, and video files inline with zero full-file download latency.
- **Carousel Navigation**: Seamlessly navigate between files using the on-screen stage arrows or keyboard <kbd>&larr;</kbd> / <kbd>&rarr;</kbd> arrow keys without closing the preview dialog.
- **Persistent Header Controls**: Toggle between items, trigger direct downloads, or inspect mobile QR codes while previewing media.

### 📱 Instant Mobile QR Direct Download
- **Cross-Device Transfer**: Generate high-resolution QR codes for any stored file in seconds.
- **Zero Friction**: Scan with any smartphone camera or QR reader to initiate direct streaming downloads to mobile devices without logging into the web app.

### ⌨️ Power-User Keyboard Shortcuts
- **Speed & Accessibility**: Navigate and manage your entire cloud ecosystem without touching the mouse.
- **Interactive Cheat Sheet**: Press <kbd>?</kbd> or click the keyboard icon in the header to view all shortcuts:
  - <kbd>Ctrl</kbd> + <kbd>K</kbd>: Global Search Bar
  - <kbd>Space</kbd>: Quick Look / Preview
  - <kbd>Enter</kbd>: Open Folder or Launch Preview
  - <kbd>&larr;</kbd> / <kbd>&rarr;</kbd>: Previous / Next item in preview modal
  - <kbd>&uarr;</kbd> / <kbd>&darr;</kbd>: Navigate list selection
  - <kbd>Shift</kbd> + Click: Contiguous range selection
  - <kbd>Ctrl</kbd> + <kbd>A</kbd>: Select all items in current folder
  - <kbd>F2</kbd>: Rename selected file or folder
  - <kbd>Del</kbd>: Delete selected items
  - <kbd>Alt</kbd> + <kbd>I</kbd>: Toggle File Inspector Drawer
  - <kbd>Esc</kbd>: Close modal or deselect all

### 🏷️ Custom Cloud Drive Nicknames (Aliases)
- **Personalized Drive Labels**: Assign custom friendly names (e.g., *"Work Drive"*, *"Personal Vault"*, *"Client Backups"*) to any connected account.
- **Visual Badges**: Connected accounts and files clearly display custom drive badges for immediate recognition across your storage pool.

### 🖱️ Desktop-Grade Context Menu
- **Right-Click Everywhere**: Full desktop-style context menu for files, folders, and workspace views with keyboard shortcut labels and danger indicators.

### ⬆️ High-Speed Streaming Uploads & Drag-and-Drop
- **Fullscreen Drag-and-Drop**: Drag files or entire nested directory folders anywhere onto the window to initiate instant uploads.
- **Zero-Copy Streaming**: Files stream directly from client to the target cloud provider with real-time WebSocket progress tracking.
- **Smart Allocation Engine**: Dynamically balances uploads across cloud providers using strategies like `most_free`, `least_used`, or `round_robin`.

### 🚀 High-Performance Go Backend Engine
- **Ultra-Lightweight (~15–25 MB RAM)**: Native Go binary eliminating memory bloat and out-of-memory crashes on free-tier containers.
- **Chunked MongoDB Atlas Persistence**: High-throughput delta synchronization engine persists files in batches (up to 2,000 items) to prevent database write locks.
- **Auto-Wakeup & Keep-Alive**: Automatically pings sleeping Render free-tier containers upon initial frontend page load with live status badges (`Render Active` / `Waking Up`).
- **Self-Healing Index**: Automatically purges stale metadata if remote cloud files are deleted externally or return 404 on access.

### 👤 Frictionless Authentication & Cross-Domain Security
- **Google 1-Click Sign-In**: Multi-user hosted mode with Google OAuth 2.0 and offline access scopes.
- **Automatic Drive Auto-Link**: Signing in with Google automatically connects the user's primary Google Drive as an active cloud drive in OneSpace.
- **Resilient Dual Auth**: Supports secure `HttpOnly` cookies, `Authorization: Bearer` headers, and `X-Session-Token` headers for seamless cross-domain operation across browsers that restrict third-party cookies (Safari, Brave, Chrome Incognito).

---

## ☁️ Supported Cloud Providers

| Provider | Status | Integration Model | Capabilities |
| :--- | :---: | :--- | :--- |
| **Google Drive** | ✅ Active | OAuth 2.0 (Google Drive API v3) | Full virtual hierarchy, auto-linking on sign-in, upload, stream download, rename, star, delete |
| **Dropbox** | ✅ Active | OAuth 2.0 (Dropbox API v2) | File management, chunked uploads, rename, delete, direct streaming |
| **MEGA** | ✅ Active | Direct account connection | Client-side encrypted cloud storage, file tree, uploads, streaming downloads |

> 📖 **Setup Guide**: Detailed instructions to configure developer credentials for all providers are documented in [`provider-setup.md`](provider-setup.md).

---

## 🏗️ Architecture & Data Flow

```mermaid
flowchart TD
    U[User Browser] --> F[Frontend Web UI<br/>Vercel Edge CDN + Vite SPA]
    F -->|REST / WebSocket requests| B[Backend API<br/>Render Web Service + Go Chi Router]

    subgraph Frontend Workspace (Vercel Edge)
        F1[Google 1-Click Auth + Token Header Sync]
        F2[Account Manager + Custom Nicknames]
        F3[Virtual File Explorer + Inspector Drawer]
        F4[Preview Carousel + Mobile QR Modal]
        F5[Drag-and-Drop & Streaming Upload Hub]
        F6[Backend Auto-Wake & Status Indicator]
    end

    F --> F1
    F --> F2
    F --> F3
    F --> F4
    F --> F5
    F --> F6

    subgraph Backend Engine (Render)
        B --> A[Cloud Adapter Registry]
        A --> G[Google Drive Adapter]
        A --> D[Dropbox Adapter]
        A --> M[MEGA Adapter]

        B --> AL[Smart Allocation Engine<br/>most_free / least_used / round_robin]
        B --> SY[Delta Sync Engine<br/>Goroutines + Chunked Batch Persistence]
        B --> WS[WebSocket Upload Progress Hub]
    end

    subgraph External Cloud APIs
        G --> C1[Google Drive API v3]
        D --> C2[Dropbox API v2]
        M --> C3[MEGA Cloud API]
    end

    subgraph Persistence Layer
        B --> MEM[In-Memory Query Cache]
        MEM <-->|Chunked Batch Upsert / Hydration| MONGO[(MongoDB Atlas<br/>Production Database)]
    end

    WS -->|Live Progress Stream| F
```

---

## ⌨️ Keyboard Shortcuts Reference

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| <kbd>?</kbd> | Global | Open Keyboard Shortcuts Cheat Sheet modal |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> | Global | Focus global search bar |
| <kbd>Space</kbd> | File Selected | Quick Look / Open file preview |
| <kbd>Enter</kbd> | File / Folder Selected | Open selected folder or launch file preview |
| <kbd>&larr;</kbd> / <kbd>&rarr;</kbd> | Preview Modal | Navigate to previous / next file |
| <kbd>&uarr;</kbd> / <kbd>&darr;</kbd> | File Grid / List | Move active item selection |
| <kbd>Ctrl</kbd> + <kbd>A</kbd> | File View | Select all files in active folder |
| <kbd>Shift</kbd> + Click | File View | Select range between clicked items |
| <kbd>Alt</kbd> + <kbd>I</kbd> | File Selected | Toggle File Inspector Slide-over Drawer |
| <kbd>F2</kbd> | File Selected | Rename selected item |
| <kbd>Del</kbd> | Selection Active | Delete selected items |
| <kbd>Esc</kbd> | Global | Close active modal / drawer or clear selection |

---

## 🚀 Cloud Deployment

Deploy OneSpace in minutes using **Render** for the Go backend API and **Vercel** for the edge-optimized web frontend.

### 1. Backend: Deploy to Render (Go API)
1. Fork or push this repository to your GitHub account.
2. In [Render](https://render.com/), click **New +** → **Blueprint**.
3. Select your repository. Render automatically reads [`render.yaml`](render.yaml) to provision the `onespace-api` Web Service.
4. Set the following environment variables:
   - `MONGODB_URI`: Your MongoDB Atlas connection string.
   - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: Your Google Cloud OAuth credentials.
   - `DROPBOX_CLIENT_ID` & `DROPBOX_CLIENT_SECRET`: Your Dropbox API credentials.
   - `CORS_ORIGIN`: Your frontend URL (e.g. `https://onespace-web.vercel.app`).
   - `FRONTEND_URL`: Your frontend URL.
5. Click **Apply**. Render will compile and launch the Go service.

### 2. Frontend: Deploy to Vercel (Edge UI)
1. In [Vercel](https://vercel.com/new), import your `OneSpace` repository.
2. Configure Project Settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Add Environment Variables:
   - `VITE_API_BASE_URL`: `https://onespace-api-hkdi.onrender.com/api`
   - `VITE_WS_BASE_URL`: `wss://onespace-api-hkdi.onrender.com/ws/uploads`
4. Click **Deploy**. Vercel will build the frontend with SPA routing rewrites configured via [`frontend/vercel.json`](frontend/vercel.json).

### 3. Google OAuth Redirect Configuration
- In [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**:
  - Add your Vercel URL (e.g. `https://onespace-web.vercel.app`) to **Authorized JavaScript origins**.
  - Add your backend redirect callback (e.g. `https://onespace-api-hkdi.onrender.com/api/accounts/google/callback`) to **Authorized redirect URIs**.

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

Edit `backend/.env` with your development credentials:
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
Start both the Go backend API and Vite frontend dev server concurrently:
```bash
npm run dev
```

- **Frontend Application**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:8787](http://localhost:8787)
- **Health Check Endpoint**: [http://localhost:8787/api/health](http://localhost:8787/api/health)

---

## 📌 Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Runs both Vite frontend and Go backend concurrently |
| `npm run build` | Builds frontend production bundle and compiles Go backend binary |
| `npm run build:web` | Builds frontend production bundle into `frontend/dist` |
| `npm run build:api` | Compiles the Go binary into `backend/bin/server` |
| `npm run dev:web` | Starts only the Vite frontend dev server |
| `npm run dev:api` | Starts only the Go API server with `go run ./cmd/server` |
| `npm start` | Runs the compiled Go production server executable |

---

## 🔌 API Reference Overview

### 🔐 Authentication
- `GET /api/auth/me`: Retrieve current session, user profile, and session token.
- `GET /api/auth/google/url`: Generate Google OAuth 2.0 authorization URL for 1-click sign-in and auto-drive linking.
- `GET /api/auth/google/callback`: Handle Google OAuth callback, issue session cookies/tokens, and initialize drive sync.
- `POST /api/auth/logout`: Invalidate session and clear authentication cookies.

### ☁️ Cloud Accounts & Synchronization
- `GET /api/accounts`: List all connected cloud accounts, storage quotas, and custom nicknames.
- `DELETE /api/accounts/:id`: Disconnect and remove a cloud account.
- `GET /api/accounts/google/connect`: Initiate OAuth connection for Google Drive.
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
- `DELETE /api/files/:id`: Delete a file or folder from its target cloud provider.
- `POST /api/files/bulk/delete`: Bulk delete multiple files and folders in parallel.
- `GET /api/files/:id/download`: Stream file download directly to client with self-healing 404 cleanup.
- `GET /api/files/:id/preview`: Inline preview for images, documents, audio, and video streams.

### ⬆️ Uploads & Storage Allocation
- `POST /api/uploads/initiate`: Initiate upload session and calculate optimal target cloud account.
- `POST /api/uploads/:uploadId/stream`: Stream file data directly to the target cloud provider.
- `GET /ws/uploads?uploadId=...`: Real-time WebSocket connection for live upload progress tracking.
- `GET /api/allocation`: Get active storage allocation strategy.
- `PATCH /api/allocation`: Update allocation strategy (`most_free`, `least_used`, `round_robin`).

---

## 🔒 Security & Data Privacy

- **AES-256-GCM Credential Encryption**: Cloud provider tokens and passwords are encrypted at rest using persistent environment keys.
- **Cross-Domain Session Isolation**: Supports both secure `SameSite=None; Secure; HttpOnly` cookies and standard `Authorization: Bearer <token>` / `X-Session-Token` headers for seamless authentication across third-party cookie restrictions.
- **Verified Sign-In**: Hosted mode enforces Google OAuth 2.0 to protect against unauthorized account registration.
- **Zero Local Plaintext Cache**: File contents are streamed directly to and from cloud providers without saving temporary unencrypted copies on the server.

---

## 👤 Author

**Chandan Raj**
- GitHub: [@chandanraj-03](https://github.com/chandanraj-03)
- Repository: [chandanraj-03/OneSpace](https://github.com/chandanraj-03/OneSpace)

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).
