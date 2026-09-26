import { randomUUID } from 'crypto';
import { db, LOCAL_USER_EMAIL, LOCAL_USER_ID } from '../config/database.js';

function mapUser(row) {
	if (!row) return null;
	return {
		...row,
		is_local: Boolean(row.is_local),
	};
}

export function getUserById(id) {
	return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function getUserByEmail(email) {
	return mapUser(db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email));
}

export function createUser({ email, passwordHash, isLocal = false, id = randomUUID() }) {
	db.prepare(`
		INSERT INTO users (id, email, password_hash, is_local)
		VALUES (?, ?, ?, ?)
	`).run(id, email.trim().toLowerCase(), passwordHash, isLocal ? 1 : 0);

	return getUserById(id);
}

export function getOrCreateLocalUser() {
	const existing = getUserById(LOCAL_USER_ID);
	if (existing) return existing;

	return createUser({
		id: LOCAL_USER_ID,
		email: LOCAL_USER_EMAIL,
		passwordHash: '',
		isLocal: true,
	});
}

export function serializeUser(user) {
	if (!user) return null;
	return {
		id: user.id,
		email: user.email,
		isLocal: Boolean(user.is_local),
	};
}