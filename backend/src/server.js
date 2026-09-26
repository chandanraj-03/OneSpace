// OneSpace Backend API Server
import http from 'http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { LOCAL_USER_ID, initMongoDatabase } from './config/database.js';
import { registerUploadSocket, unregisterUploadSocket } from './services/websocketHub.js';
import { runDeltaSync, scheduleSync } from './services/syncService.js';

function isNonFatalBackgroundError(error) {
	const message = error?.message || String(error || '');
	return /invalid or expired.*(token|session|authorization)|\b(401|403|409|429)\b|ESID|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ENOTFOUND|rate limit|temporar(?:y|ily)|busy|congestion|server malfunction|utype/i.test(message);
}

process.on('unhandledRejection', (reason) => {
	if (isNonFatalBackgroundError(reason)) {
		console.error('Ignored non-fatal background provider error:', reason);
		return;
	}

	console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
	if (isNonFatalBackgroundError(error)) {
		console.error('Ignored non-fatal background provider error:', error);
		return;
	}

	console.error('Uncaught exception:', error);
});

const app = createApp();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/uploads' });

wss.on('connection', (socket, request) => {
	const url = new URL(request.url, `http://${request.headers.host}`);
	const uploadId = url.searchParams.get('uploadId');

	if (!uploadId) {
		socket.close(1008, 'uploadId is required');
		return;
	}

	registerUploadSocket(uploadId, socket);

	socket.send(
		JSON.stringify({
			type: 'socket:ready',
			uploadId,
			status: 'connected',
		}),
	);

	socket.on('close', () => {
		unregisterUploadSocket(uploadId, socket);
	});
});

scheduleSync();
if (env.appMode === 'local') {
	runDeltaSync(LOCAL_USER_ID).catch((error) => {
		console.error('Initial sync failed:', error);
	});
}

await initMongoDatabase(env.mongodbUri);

server.listen(env.port, () => {
	console.log(`OneSpace API listening on http://localhost:${env.port}`);
});
