const uploadSockets = new Map();

export function registerUploadSocket(uploadId, socket) {
	if (!uploadSockets.has(uploadId)) {
		uploadSockets.set(uploadId, new Set());
	}

	uploadSockets.get(uploadId).add(socket);
}

export function unregisterUploadSocket(uploadId, socket) {
	const sockets = uploadSockets.get(uploadId);
	if (!sockets) return;
	sockets.delete(socket);
	if (!sockets.size) {
		uploadSockets.delete(uploadId);
	}
}

export function emitUploadEvent(uploadId, event) {
	const sockets = uploadSockets.get(uploadId);
	if (!sockets) return;

	for (const socket of sockets) {
		if (socket.readyState === 1) {
			socket.send(JSON.stringify(event));
		}
	}
}
