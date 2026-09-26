import { MongoClient } from 'mongodb';
import dns from 'dns';
import { randomUUID } from 'crypto';

// Setup Google & Cloudflare DNS to avoid Windows ISP SRV lookup failures
try {
	dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch {
	// Custom DNS not supported in some sandboxes
}

export const LOCAL_USER_ID = 'local-default-user';
export const LOCAL_USER_EMAIL = 'local@onespace.local';

// In-Memory Document Collections (Single source of truth in RAM, synced with MongoDB Atlas)
const tables = {
	users: new Map(),
	auth_sessions: new Map(),
	cloud_accounts: new Map(),
	file_metadata: new Map(),
	user_settings: new Map(),
};

let mongoClient = null;
let mongoDb = null;
let isConnected = false;

// Initialize default local user in memory
tables.users.set(LOCAL_USER_ID, {
	id: LOCAL_USER_ID,
	email: LOCAL_USER_EMAIL,
	password_hash: '',
	is_local: 1,
	created_at: new Date().toISOString(),
	updated_at: new Date().toISOString(),
});

// Async write-behind helper to persist documents to MongoDB Atlas
function persistDocument(tableName, doc) {
	if (!isConnected || !mongoDb) return;
	mongoDb
		.collection(tableName)
		.updateOne({ id: doc.id }, { $set: doc }, { upsert: true })
		.catch((err) => {
			console.error(`[MongoDB] Write error on ${tableName}:`, err.message);
		});
}

function deleteMongoDocument(tableName, filter) {
	if (!isConnected || !mongoDb) return;
	mongoDb
		.collection(tableName)
		.deleteMany(filter)
		.catch((err) => {
			console.error(`[MongoDB] Delete error on ${tableName}:`, err.message);
		});
}

// Connect to MongoDB Atlas and hydrate collections
export async function initMongoDatabase(uri) {
	if (!uri) {
		console.log('[MongoDB] MONGODB_URI not provided. Operating with in-memory persistence.');
		return;
	}

	try {
		console.log('[MongoDB] Connecting to MongoDB Atlas...');
		mongoClient = new MongoClient(uri, {
			serverSelectionTimeoutMS: 8000,
			connectTimeoutMS: 8000,
		});
		await mongoClient.connect();
		mongoDb = mongoClient.db('onespace');
		isConnected = true;
		console.log('[MongoDB] Connected to MongoDB Atlas (onespace) successfully!');

		// Hydrate collections from MongoDB Atlas into memory
		for (const tableName of Object.keys(tables)) {
			const collection = mongoDb.collection(tableName);
			const docs = await collection.find({}).toArray();

			if (docs && docs.length > 0) {
				console.log(`[MongoDB] Hydrated ${docs.length} records into ${tableName}`);
				for (const doc of docs) {
					const { _id, ...fields } = doc;
					tables[tableName].set(fields.id, fields);
				}
			}
		}

		// Ensure default local user exists in MongoDB Atlas
		const localUser = tables.users.get(LOCAL_USER_ID);
		if (localUser) {
			persistDocument('users', localUser);
		}

		// Periodic sync check every 30s
		setInterval(() => {
			if (isConnected && mongoDb) {
				for (const [tableName, map] of Object.entries(tables)) {
					const collection = mongoDb.collection(tableName);
					const allDocs = Array.from(map.values());
					if (allDocs.length > 0) {
						const ops = allDocs.map((doc) => ({
							updateOne: {
								filter: { id: doc.id },
								update: { $set: doc },
								upsert: true,
							},
						}));
						collection.bulkWrite(ops, { ordered: false }).catch(() => {});
					}
				}
			}
		}, 30000);
	} catch (err) {
		console.error('[MongoDB] Failed to connect to MongoDB Atlas:', err.message);
	}
}

// ==========================================================================
// Pure JavaScript Query Engine for OneSpace Services
// ==========================================================================

export const db = {
	pragma() {
		return this;
	},

	exec() {
		return this;
	},

	transaction(fn) {
		return (...args) => fn(...args);
	},

	prepare(sql) {
		const normalized = sql.replace(/\s+/g, ' ').trim();

		return {
			get(...args) {
				// users
				if (normalized.includes('FROM users WHERE id = ?')) {
					const user = tables.users.get(args[0]);
					return user ? { ...user } : null;
				}
				if (normalized.includes('FROM users WHERE lower(email) = lower(?)')) {
					const targetEmail = String(args[0] || '').toLowerCase();
					for (const u of tables.users.values()) {
						if (String(u.email || '').toLowerCase() === targetEmail) {
							return { ...u };
						}
					}
					return null;
				}

				// auth_sessions with user join
				if (normalized.includes('FROM auth_sessions s') && normalized.includes('INNER JOIN users u')) {
					const tokenHash = args[0];
					for (const s of tables.auth_sessions.values()) {
						if (s.token_hash === tokenHash) {
							const user = tables.users.get(s.user_id);
							if (user) {
								return {
									session_id: s.id,
									user_id: s.user_id,
									expires_at: s.expires_at,
									...user,
								};
							}
						}
					}
					return null;
				}

				// cloud_accounts
				if (normalized.includes('FROM cloud_accounts WHERE user_id = ? AND id = ?')) {
					const [userId, id] = args;
					const acc = tables.cloud_accounts.get(id);
					return acc && acc.user_id === userId ? { ...acc } : null;
				}
				if (normalized.includes('FROM cloud_accounts WHERE user_id = ? AND provider = ? AND email = ?')) {
					const [userId, provider, email] = args;
					for (const a of tables.cloud_accounts.values()) {
						if (a.user_id === userId && a.provider === provider && a.email === email) {
							return { ...a };
						}
					}
					return null;
				}

				// file_metadata single gets
				if (normalized.includes('FROM file_metadata fm') && normalized.includes('WHERE fm.user_id = ? AND fm.id = ?')) {
					const [userId, id] = args;
					const fm = tables.file_metadata.get(id);
					if (fm && fm.user_id === userId) {
						const ca = tables.cloud_accounts.get(fm.cloud_account_id);
						if (ca && ca.status === 'active') {
							return { ...fm, provider: ca.provider, email: ca.email };
						}
					}
					return null;
				}
				if (normalized.includes('FROM file_metadata fm') && normalized.includes('fm.remote_file_id = ?')) {
					const [userId, cloudAccountId, remoteFileId] = args;
					for (const fm of tables.file_metadata.values()) {
						if (fm.user_id === userId && fm.cloud_account_id === cloudAccountId && fm.remote_file_id === remoteFileId) {
							const ca = tables.cloud_accounts.get(fm.cloud_account_id);
							if (ca && ca.status === 'active') {
								return { ...fm, provider: ca.provider, email: ca.email };
							}
						}
					}
					return null;
				}
				if (normalized.includes('FROM file_metadata WHERE user_id = ? AND virtual_path = ? AND file_name = ?')) {
					const [userId, vPath, fName] = args;
					for (const fm of tables.file_metadata.values()) {
						if (fm.user_id === userId && fm.virtual_path === vPath && fm.file_name === fName) {
							return { ...fm };
						}
					}
					return null;
				}

				// user_settings
				if (normalized.includes('FROM user_settings WHERE user_id = ? AND key = ?')) {
					const [userId, key] = args;
					for (const s of tables.user_settings.values()) {
						if (s.user_id === userId && s.key === key) {
							return { ...s };
						}
					}
					return null;
				}

				return null;
			},

			all(...args) {
				// cloud_accounts
				if (normalized.includes('FROM cloud_accounts WHERE user_id = ? ORDER BY provider, email')) {
					const userId = args[0];
					const list = [];
					for (const a of tables.cloud_accounts.values()) {
						if (a.user_id === userId) list.push({ ...a });
					}
					return list.sort((a, b) => {
						const pCmp = (a.provider || '').localeCompare(b.provider || '');
						return pCmp !== 0 ? pCmp : (a.email || '').localeCompare(b.email || '');
					});
				}
				if (normalized.includes("FROM cloud_accounts WHERE user_id = ? AND status = 'active'")) {
					const userId = args[0];
					const list = [];
					for (const a of tables.cloud_accounts.values()) {
						if (a.user_id === userId && a.status === 'active') list.push({ ...a });
					}
					return list;
				}

				// file_metadata listing by path
				if (normalized.includes('WHERE fm.user_id = ? AND fm.virtual_path = ? AND ca.status = \'active\'')) {
					const [userId, vPath] = args;
					const list = [];
					for (const fm of tables.file_metadata.values()) {
						if (fm.user_id === userId && fm.virtual_path === vPath) {
							const ca = tables.cloud_accounts.get(fm.cloud_account_id);
							if (ca && ca.status === 'active') {
								list.push({ ...fm, provider: ca.provider, email: ca.email });
							}
						}
					}
					return list.sort((a, b) => {
						if (Boolean(b.is_folder) !== Boolean(a.is_folder)) {
							return b.is_folder ? 1 : -1;
						}
						return (a.file_name || '').localeCompare(b.file_name || '', undefined, { sensitivity: 'base' });
					});
				}

				// searchFiles
				if (normalized.includes('fm.file_name LIKE ?')) {
					const userId = args[0];
					const term = String(args[1] || '').replace(/%/g, '').toLowerCase();
					const limit = Number(args[args.length - 1]) || 50;
					const list = [];
					for (const fm of tables.file_metadata.values()) {
						if (fm.user_id === userId) {
							const ca = tables.cloud_accounts.get(fm.cloud_account_id);
							if (ca && ca.status === 'active') {
								if (String(fm.file_name || '').toLowerCase().includes(term)) {
									list.push({ ...fm, provider: ca.provider, email: ca.email });
								}
							}
						}
					}
					return list.slice(0, limit);
				}

				// listStarredFiles
				if (normalized.includes('COALESCE(fm.is_starred, 0) = 1')) {
					const userId = args[0];
					const list = [];
					for (const fm of tables.file_metadata.values()) {
						if (fm.user_id === userId && Boolean(fm.is_starred)) {
							const ca = tables.cloud_accounts.get(fm.cloud_account_id);
							if (ca && ca.status === 'active') {
								list.push({ ...fm, provider: ca.provider, email: ca.email });
							}
						}
					}
					return list;
				}

				// listRecentFiles
				if (normalized.includes('fm.is_folder = 0') && normalized.includes('ca.status = \'active\'')) {
					const userId = args[0];
					const list = [];
					for (const fm of tables.file_metadata.values()) {
						if (fm.user_id === userId && !fm.is_folder) {
							const ca = tables.cloud_accounts.get(fm.cloud_account_id);
							if (ca && ca.status === 'active') {
								list.push({ ...fm, provider: ca.provider, email: ca.email });
							}
						}
					}
					return list.sort((a, b) => {
						const dateA = a.remote_modified_time || a.remote_created_time || a.created_at || '';
						const dateB = b.remote_modified_time || b.remote_created_time || b.created_at || '';
						return String(dateB).localeCompare(String(dateA));
					}).slice(0, 50);
				}

				// listAllFiles
				if (normalized.includes('FROM file_metadata WHERE user_id = ?')) {
					const userId = args[0];
					const list = [];
					for (const fm of tables.file_metadata.values()) {
						if (fm.user_id === userId) list.push({ ...fm });
					}
					return list;
				}

				// user_settings
				if (normalized.includes('FROM user_settings WHERE user_id = ?')) {
					const userId = args[0];
					const list = [];
					for (const s of tables.user_settings.values()) {
						if (s.user_id === userId) list.push({ ...s });
					}
					return list;
				}

				return [];
			},

			run(...args) {
				const now = new Date().toISOString();

				// INSERT INTO users
				if (normalized.includes('INSERT INTO users') || normalized.includes('INSERT OR IGNORE INTO users')) {
					const [id, email, password_hash, is_local] = args;
					const user = {
						id,
						email: String(email).trim().toLowerCase(),
						password_hash,
						is_local: is_local ? 1 : 0,
						created_at: now,
						updated_at: now,
					};
					tables.users.set(id, user);
					persistDocument('users', user);
					return { changes: 1 };
				}

				// auth_sessions
				if (normalized.includes('INSERT INTO auth_sessions')) {
					const [id, user_id, token_hash, expires_at] = args;
					const session = {
						id,
						user_id,
						token_hash,
						expires_at,
						created_at: now,
						last_used_at: now,
					};
					tables.auth_sessions.set(id, session);
					persistDocument('auth_sessions', session);
					return { changes: 1 };
				}
				if (normalized.includes('DELETE FROM auth_sessions WHERE token_hash = ?')) {
					const tokenHash = args[0];
					for (const [id, s] of tables.auth_sessions.entries()) {
						if (s.token_hash === tokenHash) {
							tables.auth_sessions.delete(id);
						}
					}
					deleteMongoDocument('auth_sessions', { token_hash: tokenHash });
					return { changes: 1 };
				}
				if (normalized.includes('UPDATE auth_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?')) {
					const id = args[0];
					const s = tables.auth_sessions.get(id);
					if (s) {
						s.last_used_at = now;
						persistDocument('auth_sessions', s);
					}
					return { changes: 1 };
				}
				if (normalized.includes('DELETE FROM auth_sessions WHERE user_id = ?')) {
					const userId = args[0];
					for (const [id, s] of tables.auth_sessions.entries()) {
						if (s.user_id === userId) {
							tables.auth_sessions.delete(id);
						}
					}
					deleteMongoDocument('auth_sessions', { user_id: userId });
					return { changes: 1 };
				}

				// cloud_accounts
				if (normalized.includes('INSERT INTO cloud_accounts')) {
					const record = args[0] || {};
					let existingId = record.id || randomUUID();
					// Check conflict on user_id, provider, email
					for (const a of tables.cloud_accounts.values()) {
						if (a.user_id === record.user_id && a.provider === record.provider && a.email === record.email) {
							existingId = a.id;
							break;
						}
					}
					const doc = {
						...record,
						id: existingId,
						created_at: tables.cloud_accounts.get(existingId)?.created_at || now,
						updated_at: now,
					};
					tables.cloud_accounts.set(existingId, doc);
					persistDocument('cloud_accounts', doc);
					return { changes: 1 };
				}
				if (normalized.includes('UPDATE cloud_accounts SET used_space = ?')) {
					const [usedSpace, userId, id] = args;
					const acc = tables.cloud_accounts.get(id);
					if (acc && acc.user_id === userId) {
						acc.used_space = usedSpace;
						acc.updated_at = now;
						persistDocument('cloud_accounts', acc);
					}
					return { changes: 1 };
				}
				if (normalized.includes('UPDATE cloud_accounts SET total_space = ?')) {
					const [totalSpace, usedSpace, userId, id] = args;
					const acc = tables.cloud_accounts.get(id);
					if (acc && acc.user_id === userId) {
						acc.total_space = totalSpace;
						acc.used_space = usedSpace;
						acc.updated_at = now;
						persistDocument('cloud_accounts', acc);
					}
					return { changes: 1 };
				}
				if (normalized.includes('UPDATE cloud_accounts SET status = ?')) {
					const [status, userId, id] = args;
					const acc = tables.cloud_accounts.get(id);
					if (acc && acc.user_id === userId) {
						acc.status = status;
						acc.updated_at = now;
						persistDocument('cloud_accounts', acc);
					}
					return { changes: 1 };
				}
				if (normalized.includes('UPDATE cloud_accounts SET encrypted_credentials = ?')) {
					const [encrypted_credentials, userId, id] = args;
					const acc = tables.cloud_accounts.get(id);
					if (acc && acc.user_id === userId) {
						acc.encrypted_credentials = encrypted_credentials;
						acc.updated_at = now;
						persistDocument('cloud_accounts', acc);
					}
					return { changes: 1 };
				}
				if (normalized.includes('DELETE FROM cloud_accounts WHERE user_id = ? AND id = ?')) {
					const [userId, id] = args;
					const acc = tables.cloud_accounts.get(id);
					if (acc && acc.user_id === userId) {
						tables.cloud_accounts.delete(id);
						deleteMongoDocument('cloud_accounts', { id, user_id: userId });
					}
					return { changes: 1 };
				}

				// file_metadata
				if (normalized.includes('INSERT INTO file_metadata')) {
					const record = args[0] || {};
					const id = record.id || randomUUID();
					const doc = {
						...record,
						id,
						created_at: tables.file_metadata.get(id)?.created_at || now,
						updated_at: now,
					};
					tables.file_metadata.set(id, doc);
					persistDocument('file_metadata', doc);
					return { changes: 1 };
				}
				if (normalized.includes('UPDATE file_metadata SET file_name = ?')) {
					const [newName, userId, id] = args;
					const fm = tables.file_metadata.get(id);
					if (fm && fm.user_id === userId) {
						fm.file_name = newName;
						fm.updated_at = now;
						persistDocument('file_metadata', fm);
					}
					return { changes: 1 };
				}
				if (normalized.includes('UPDATE file_metadata SET is_starred = ?') && normalized.includes('WHERE user_id = ? AND id = ?')) {
					const [isStarred, userId, id] = args;
					const fm = tables.file_metadata.get(id);
					if (fm && fm.user_id === userId) {
						fm.is_starred = isStarred;
						fm.updated_at = now;
						persistDocument('file_metadata', fm);
					}
					return { changes: 1 };
				}
				if (normalized.includes('UPDATE file_metadata SET is_starred = ?') && normalized.includes('WHERE user_id = ? AND cloud_account_id = ? AND remote_file_id = ?')) {
					const [isStarred, userId, cloudAccountId, remoteFileId] = args;
					for (const fm of tables.file_metadata.values()) {
						if (fm.user_id === userId && fm.cloud_account_id === cloudAccountId && fm.remote_file_id === remoteFileId) {
							fm.is_starred = isStarred;
							fm.updated_at = now;
							persistDocument('file_metadata', fm);
						}
					}
					return { changes: 1 };
				}
				if (normalized.includes('DELETE FROM file_metadata WHERE user_id = ? AND id = ?')) {
					const [userId, id] = args;
					const fm = tables.file_metadata.get(id);
					if (fm && fm.user_id === userId) {
						tables.file_metadata.delete(id);
						deleteMongoDocument('file_metadata', { id, user_id: userId });
					}
					return { changes: 1 };
				}
				if (normalized.includes('DELETE FROM file_metadata WHERE user_id = ? AND cloud_account_id = ?')) {
					const [userId, cloudAccountId] = args;
					for (const [id, fm] of tables.file_metadata.entries()) {
						if (fm.user_id === userId && fm.cloud_account_id === cloudAccountId) {
							tables.file_metadata.delete(id);
						}
					}
					deleteMongoDocument('file_metadata', { user_id: userId, cloud_account_id: cloudAccountId });
					return { changes: 1 };
				}
				if (normalized.includes('DELETE FROM file_metadata WHERE user_id = ? AND (virtual_path = ? OR virtual_path LIKE ?)')) {
					const [userId, exactPath, prefixPath] = args;
					const prefix = prefixPath.replace(/%/g, '');
					for (const [id, fm] of tables.file_metadata.entries()) {
						if (fm.user_id === userId && (fm.virtual_path === exactPath || fm.virtual_path.startsWith(prefix))) {
							tables.file_metadata.delete(id);
						}
					}
					deleteMongoDocument('file_metadata', {
						user_id: userId,
						$or: [
							{ virtual_path: exactPath },
							{ virtual_path: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } },
						],
					});
					return { changes: 1 };
				}

				// user_settings
				if (normalized.includes('INSERT INTO user_settings')) {
					const [userId, key, value] = args;
					let targetId = randomUUID();
					for (const s of tables.user_settings.values()) {
						if (s.user_id === userId && s.key === key) {
							targetId = s.id;
							break;
						}
					}
					const doc = {
						id: targetId,
						user_id: userId,
						key,
						value,
						updated_at: now,
					};
					tables.user_settings.set(targetId, doc);
					persistDocument('user_settings', doc);
					return { changes: 1 };
				}

				return { changes: 0 };
			},
		};
	},
};
