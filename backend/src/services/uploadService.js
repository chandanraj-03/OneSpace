import Busboy from 'busboy';
import { PassThrough } from 'stream';
import { createAdapter } from './adapterRegistry.js';
import { getAccountById, markAccountStatus, updateAccountUsage } from './accountService.js';
import { createFileMetadata, getFileByRemoteId } from './fileService.js';
import { emitUploadEvent } from './websocketHub.js';
import { getUploadSessionForUser, updateUploadSession, removeUploadSession } from './uploadSessionService.js';
import { syncAccount } from './syncService.js';
import { isAuthError } from '../utils/providerErrors.js';

async function pipeUpload({ req, session }) {
	return new Promise((resolve, reject) => {
		const busboy = Busboy({ headers: req.headers });
		let settled = false;
		let fileReceived = false;

		const complete = (callback, value) => {
			if (settled) return;
			settled = true;
			removeUploadSession(session.id);
			callback(value);
		};

		busboy.on('file', async (_field, file, info) => {
			fileReceived = true;
			const streamBuffer = new PassThrough();
			file.pipe(streamBuffer);

			let activeAccountId = session.cloud_account_id;
			const tried = new Set();

			const attemptUpload = async (accountId) => {
				tried.add(accountId);
				const account = getAccountById(session.user_id, accountId);
				if (!account) {
					throw new Error('Target upload account not found');
				}
				const adapter = createAdapter(account);

				const result = await adapter.uploadStream({
					stream: streamBuffer,
					size: session.size,
					fileName: info.filename,
					mimeType: info.mimeType,
					virtualPath: session.virtual_path,
					remoteParentId: session.remote_parent_id,
					onProgress: (bytes) => {
						const percent = Math.min(100, Math.round((bytes / session.size) * 100));
						emitUploadEvent(session.id, {
							type: 'upload:progress',
							uploadId: session.id,
							bytes,
							percent,
							status: 'uploading',
						});
					},
				});

				return { result, account };
			};

			try {
				let uploadResponse;
				let account;

				try {
					({ result: uploadResponse, account } = await attemptUpload(activeAccountId));
				} catch (error) {
					if (isAuthError(error)) {
						markAccountStatus(session.user_id, activeAccountId, 'invalid_token');
					}
					const fallbackId = session.fallback_chain.find((id) => !tried.has(id));
					if (!fallbackId) {
						throw error;
					}
					activeAccountId = fallbackId;
					({ result: uploadResponse, account } = await attemptUpload(activeAccountId));
				}

				const usedSpace = Number(account.used_space) + Number(session.size);
				updateAccountUsage(session.user_id, account.id, usedSpace);

				let metadata = createFileMetadata({
					user_id: session.user_id,
					virtual_path: session.virtual_path,
					file_name: info.filename,
					is_folder: false,
					size: session.size,
					mime_type: info.mimeType,
					cloud_account_id: account.id,
					remote_file_id: uploadResponse.remoteFileId,
					remote_parent_id: uploadResponse.remoteParentId,
				});

				await syncAccount(session.user_id, account);
				metadata = getFileByRemoteId(session.user_id, account.id, uploadResponse.remoteFileId) || metadata;

				updateUploadSession(session.id, { status: 'completed', cloud_account_id: account.id });
				emitUploadEvent(session.id, {
					type: 'upload:complete',
					uploadId: session.id,
					percent: 100,
					status: 'completed',
					file: metadata,
				});
				complete(resolve, metadata);
			} catch (error) {
				updateUploadSession(session.id, { status: 'failed' });
				emitUploadEvent(session.id, {
					type: 'upload:error',
					uploadId: session.id,
					status: 'failed',
					message: error.message,
				});
				complete(reject, error);
			}
		});

		busboy.on('error', (error) => complete(reject, error));
		busboy.on('finish', () => {
			if (!fileReceived) {
				complete(reject, new Error('No file payload received'));
			}
		});

		req.pipe(busboy);
	});
}

export async function handleUpload(req, uploadId) {
	const session = getUploadSessionForUser(req.user.id, uploadId);

	if (!session) {
		throw new Error('Upload session not found');
	}

	updateUploadSession(uploadId, { status: 'uploading' });
	emitUploadEvent(uploadId, {
		type: 'upload:started',
		uploadId,
		percent: 0,
		status: 'uploading',
	});

	return pipeUpload({ req, session });
}
