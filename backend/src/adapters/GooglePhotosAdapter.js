import { google } from 'googleapis';
import { Readable } from 'stream';
import { BaseCloudAdapter } from './BaseCloudAdapter.js';
import { decryptJson } from '../utils/crypto.js';

export class GooglePhotosAdapter extends BaseCloudAdapter {
	getCapabilities() {
		return {
			starred: false,
			rename: false,
			delete: false,
		};
	}

	createOAuthClient() {
		const credentials = decryptJson(this.account.encrypted_credentials);
		const oauthClient = new google.auth.OAuth2(
			credentials.clientId,
			credentials.clientSecret,
			credentials.redirectUri,
		);

		oauthClient.setCredentials({
			refresh_token: credentials.refreshToken || undefined,
			access_token: credentials.accessToken || undefined,
			expiry_date: credentials.expiryDate || undefined,
			scope: credentials.scope || undefined,
			token_type: credentials.tokenType || undefined,
		});

		return oauthClient;
	}

	async getValidAccessToken() {
		const oauthClient = this.createOAuthClient();
		const tokenResponse = await oauthClient.getAccessToken();
		return tokenResponse?.token || oauthClient.credentials?.access_token;
	}

	async fetchStructure() {
		const files = [];

		try {
			const accessToken = await this.getValidAccessToken();
			if (!accessToken) {
				console.warn('[GooglePhotosAdapter] No valid access token available');
				return [];
			}

			const headers = {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			};

			// Ensure root Google Photos virtual folder is present
			files.push({
				virtual_path: '/',
				file_name: 'Google Photos',
				is_folder: true,
				is_starred: 0,
				size: 0,
				mime_type: 'application/vnd.google-apps.folder',
				remote_file_id: 'google_photos_root',
				remote_parent_id: 'root',
				remote_created_time: new Date().toISOString(),
				remote_modified_time: new Date().toISOString(),
			});

			// 1. Fetch Google Photos Albums
			try {
				const albumsRes = await fetch('https://photoslibrary.googleapis.com/v1/albums?pageSize=50', { headers });
				if (albumsRes.ok) {
					const albumsData = await albumsRes.json();
					const albums = albumsData.albums || [];

					for (const album of albums) {
						if (!album.title) continue;
						files.push({
							virtual_path: '/Google Photos/',
							file_name: album.title,
							is_folder: true,
							is_starred: 0,
							size: 0,
							mime_type: 'application/vnd.google-apps.folder',
							remote_file_id: album.id,
							remote_parent_id: 'google_photos_root',
							remote_created_time: null,
							remote_modified_time: null,
						});

						// Fetch up to 50 items for this album
						try {
							const albumItemsRes = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
								method: 'POST',
								headers,
								body: JSON.stringify({ albumId: album.id, pageSize: 50 }),
							});
							if (albumItemsRes.ok) {
								const albumItemsData = await albumItemsRes.json();
								const albumMedia = albumItemsData.mediaItems || [];
								for (const item of albumMedia) {
									const width = Number(item.mediaMetadata?.width || 1920);
									const height = Number(item.mediaMetadata?.height || 1080);
									// Estimate uncompressed raster / JPEG file size
									const estimatedBytes = Math.round(width * height * 0.45);

									files.push({
										virtual_path: `/Google Photos/${album.title}/`,
										file_name: item.filename || `Photo_${item.id.slice(0, 8)}.jpg`,
										is_folder: false,
										is_starred: 0,
										size: estimatedBytes,
										mime_type: item.mimeType || 'image/jpeg',
										remote_file_id: item.id,
										remote_parent_id: album.id,
										remote_created_time: item.mediaMetadata?.creationTime || null,
										remote_modified_time: item.mediaMetadata?.creationTime || null,
									});
								}
							}
						} catch (albumSearchErr) {
							console.warn(`[GooglePhotosAdapter] Error searching album ${album.title}:`, albumSearchErr.message);
						}
					}
				}
			} catch (albumsErr) {
				console.warn('[GooglePhotosAdapter] Albums fetch warning:', albumsErr.message);
			}

			// 2. Fetch Recent Media Items (Library Root)
			try {
				const mediaRes = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=100', { headers });
				if (mediaRes.ok) {
					const mediaData = await mediaRes.json();
					const mediaItems = mediaData.mediaItems || [];

					for (const item of mediaItems) {
						// Don't duplicate if already listed in an album
						if (files.some((f) => f.remote_file_id === item.id)) continue;

						const width = Number(item.mediaMetadata?.width || 1920);
						const height = Number(item.mediaMetadata?.height || 1080);
						const estimatedBytes = Math.round(width * height * 0.45);

						files.push({
							virtual_path: '/Google Photos/',
							file_name: item.filename || `Photo_${item.id.slice(0, 8)}.jpg`,
							is_folder: false,
							is_starred: 0,
							size: estimatedBytes,
							mime_type: item.mimeType || 'image/jpeg',
							remote_file_id: item.id,
							remote_parent_id: 'google_photos_root',
							remote_created_time: item.mediaMetadata?.creationTime || null,
							remote_modified_time: item.mediaMetadata?.creationTime || null,
						});
					}
				} else {
					const errorJson = await mediaRes.json().catch(() => ({}));
					console.warn('[GooglePhotosAdapter] Media items API response status:', mediaRes.status, errorJson?.error?.message || '');
				}
			} catch (mediaErr) {
				console.warn('[GooglePhotosAdapter] Media items fetch warning:', mediaErr.message);
			}
		} catch (outerErr) {
			console.error('[GooglePhotosAdapter] Error in fetchStructure:', outerErr.message);
		}

		return files;
	}

	async getDownloadStream(fileRecord) {
		const accessToken = await this.getValidAccessToken();
		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		// 1. Fetch the mediaItem to get a fresh baseUrl
		const itemRes = await fetch(`https://photoslibrary.googleapis.com/v1/mediaItems/${fileRecord.remote_file_id}`, { headers });
		if (!itemRes.ok) {
			throw new Error(`Failed to fetch Google Photos media item metadata (status: ${itemRes.status})`);
		}

		const itemData = await itemRes.json();
		const baseUrl = itemData.baseUrl;
		if (!baseUrl) {
			throw new Error('Google Photos media item did not return a valid download baseUrl');
		}

		// Appending '=d' requests the full original binary download from Google Photos
		const downloadUrl = `${baseUrl}=d`;
		const binaryRes = await fetch(downloadUrl);
		if (!binaryRes.ok) {
			throw new Error(`Failed to download media stream from Google Photos (status: ${binaryRes.status})`);
		}

		return Readable.fromWeb(binaryRes.body);
	}

	async getFileDetails(fileRecord) {
		try {
			const accessToken = await this.getValidAccessToken();
			const itemRes = await fetch(`https://photoslibrary.googleapis.com/v1/mediaItems/${fileRecord.remote_file_id}`, {
				headers: { Authorization: `Bearer ${accessToken}` },
			});

			if (itemRes.ok) {
				const item = await itemRes.json();
				return {
					name: fileRecord.file_name,
					mime_type: fileRecord.mime_type,
					size: fileRecord.size,
					virtual_path: fileRecord.virtual_path,
					remote_file_id: fileRecord.remote_file_id,
					provider: 'google_photos',
					owner_email: this.account.email,
					createdTime: item.mediaMetadata?.creationTime || fileRecord.remote_created_time,
					modifiedTime: item.mediaMetadata?.creationTime || fileRecord.remote_modified_time,
					productUrl: item.productUrl,
					previewUrl: `${item.baseUrl}=w2048-h2048`,
				};
			}
		} catch (err) {
			console.warn('[GooglePhotosAdapter] Details fetch error:', err.message);
		}

		return {
			name: fileRecord.file_name,
			mime_type: fileRecord.mime_type,
			size: fileRecord.size,
			virtual_path: fileRecord.virtual_path,
			remote_file_id: fileRecord.remote_file_id,
			provider: 'google_photos',
			owner_email: this.account.email,
			createdTime: fileRecord.remote_created_time,
			modifiedTime: fileRecord.remote_modified_time,
		};
	}
}
