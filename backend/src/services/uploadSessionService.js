import { randomUUID } from 'crypto';

const sessions = new Map();

export function createUploadSession(payload) {
	const id = randomUUID();
	const session = {
		id,
		...payload,
		token: randomUUID(),
		status: 'pending',
		createdAt: new Date().toISOString(),
	};

	sessions.set(id, session);
	return session;
}

export function getUploadSession(id) {
	return sessions.get(id);
}

export function getUploadSessionForUser(userId, id) {
	const session = sessions.get(id);
	if (!session || session.user_id !== userId) return null;
	return session;
}

export function updateUploadSession(id, patch) {
	const session = sessions.get(id);
	if (!session) return null;
	const next = { ...session, ...patch };
	sessions.set(id, next);
	return next;
}

export function removeUploadSession(id) {
	sessions.delete(id);
}
