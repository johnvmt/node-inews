import EventEmitter from 'wolfy87-eventemitter';
import FtpClient from 'ftp';

import JobsQueue from './JobsQueue';
import parseNsml from './inewsStoryParser';

class InewsClient extends EventEmitter {
	constructor(config) {
		super();

		const self = this;

		// Set config
		const configDefault = {
			timeout: 60000, // 1 minute
			reconnectTimeout: 5000, // 5 seconds
			maxRunning: 10,
			maxAttempts: 5,
			maxReconnectAttempts: null
		};

		self.config = Object.assign(configDefault, config);

		// Set status
		self.status = 'disconnected';

		if(!Array.isArray(self.config.hosts) && typeof self.config.host === 'string')
			self.config.hosts = [self.config.host];

		// Map FTP events to status updates
		self._ftpConn = new FtpClient();

		const mappedFtpEvents = new Map([
			['ready', 'connected'],
			['error', 'error'],
			['close', 'disconnected'],
			['end', 'disconnected']
		]);

		mappedFtpEvents.forEach((clientStatus, ftpEventName) => {
			self._ftpConn.on(ftpEventName, () => {
				self.status = clientStatus; // Emit status
				self.emit.apply(self, [ftpEventName].concat(Array.prototype.slice.call(arguments))); // Re-emit event
			});
		});

		// Remove current directory on disconnect
		self.on('disconnected', function() {
			self._currentDir = null;
		});

		self._jobsQueue = new JobsQueue();

		self._jobsQueue.on('queued', (queuedJobs) => {
			self.emit('queued', queuedJobs)
		});

		self._jobsQueue.on('running', (runningJobs) => {
			self.emit('running', runningJobs)
		});

		self._jobsQueue.on('error', (error) => {
			self.emit('error', error)
		});

	}

	get queued() {
		return this._jobsQueue.queued.size;
	}

	get running() {
		return this._jobsQueue.running.size;
	}

	set status(status) {
		if(status !== this._status) {
			this._status = status;
			this.emit('status', status);
		}
	}

	get status() {
		return this._status;
	}

	async connect(forceDisconnect = false) {
		const self = this;

		if(self._ftpConn !== null && self._ftpConn.connected && !forceDisconnect)
			return self._ftpConn;
		else if(typeof self._connectionInProgress === 'undefined' || !self._connectionInProgress) { // change to status
			self._connectionInProgress = true;
			self._currentDir = null;

			// Retry as many times as allowed (may be infinite)
			for(let reconnectsAttempted = 0; (typeof self.config.maxReconnectAttempts !== 'number' || self.config.maxReconnectAttempts < 0 || reconnectsAttempted < self.config.maxReconnectAttempts); reconnectsAttempted++) {
				if(forceDisconnect || reconnectsAttempted > 0)
					await self.disconnect();

				let ftpConnConfig = {
					host: self.config.hosts[reconnectsAttempted % self.config.hosts.length], // cycle through server
					user: self.config.user,
					password: self.config.password
				};

				if(reconnectsAttempted > 0 && typeof self.config.reconnectTimeout === 'number' && self.config.reconnectTimeout > 0)
					await delay(self.config.reconnectTimeout);

				try {
					await connectFtp(ftpConnConfig);
					delete self._connectionInProgress;
					return self._ftpConn;
				}
				catch(error) {
					self.emit('error', error);
				}
			}

			self.emit('error', 'max_reconnect_attempts');
			throw new Error('max_reconnect_attempts');
		}

		function delay(ms) {
			return new Promise((resolve) => {
				setTimeout(() => {
					resolve();
				}, ms);
			});
		}

		function connectFtp(ftpConnConfig) {
			self.status = 'connecting';

			return new Promise((resolve, reject) => {
				let returned = false;

				function onReady() {
					if(!returned) {
						returned = true;
						self._currentDir = null;
						removeListeners();
						resolve(self._ftpConn);
					}
				}

				function onError(error) {
					if(!returned) {
						returned = true;
						removeListeners();
						reject(error);
					}
				}

				function removeListeners() {
					self._ftpConn.removeListener('ready', onReady);
					self._ftpConn.removeListener('error', onError);
				}

				self._ftpConn.once('ready', onReady);
				self._ftpConn.once('error', onError);
				self._ftpConn.connect(ftpConnConfig);
			});
		}
	}

	disconnect() {
		const self = this;

		return new Promise((resolve, reject) => {
			if(self._ftpConn.connected) {
				self.once('end', function() {
					resolve();
				});
				self._ftpConn.end();
			}
			else
				resolve();
		});
	}

	story(directory, file) {
		const self = this;
		let operationAttempts = 0;

		return self._jobsQueue.enqueue({
			start: async () => {
				// Job goes here
				await self.connect();
				await self.cwd(directory);
				const storyNsml = await self._get(file);
				return await parseNsml(storyNsml);
			},
			startFilter: () => {
				return self.canStartNextJob(directory);
			},
			retryFilter: (error) => {
				operationAttempts++;
				return (operationAttempts < self.config.maxAttempts && error !== 'cwd_failed' && !error.message.includes('no such story') && !error.message.includes('invalid story identifier'));
			},
			timeout: self.config.timeout
		});
	}

	canStartNextJob(directory) {
		// In directory already, directory is requested, or not started
		return (this.running === 0 || (((this._currentDir === directory && typeof this._requestedDir !== 'string') || this._requestedDir === directory || (typeof this._currentDir !== 'string' && typeof this._requestedDir !== 'string')) && this.running < this.config.maxRunning));
	}

	storyNsml(directory, file) {
		const self = this;
		let operationAttempts = 0;

		return self._jobsQueue.enqueue({
			start: async () => {
				// Job goes here
				await self.connect();
				await self.cwd(directory);
				return await self._get(file);
			},
			startFilter: () => {
				return self.canStartNextJob(directory);
			},
			retryFilter: (error) => {
				operationAttempts++;
				return (operationAttempts < self.config.maxAttempts && error !== 'cwd_failed' && !error.message.includes('no such story') && !error.message.includes('invalid story identifier'));
			},
			timeout: self.config.timeout
		});
	}

	list(directory) {
		const self = this;
		let operationAttempts = 0;

		return self._jobsQueue.enqueue({
			start: () => {
				return new Promise(async (resolve, reject) => {
					try {
						await self.connect();
						await self.cwd(directory);

						self._ftpConn.list((error, list) => {
							if (error)
								reject(error);
							else {
								let fileNames = [];
								if(Array.isArray(list)) {
									list.forEach(function (listItem) {
										let file = InewsClient.fileFromListItem(listItem);
										if (typeof file !== 'undefined')
											fileNames.push(file);
									});
								}
								resolve(fileNames);
							}
						});
					}
					catch(error) {
						reject(error);
					}
				});
			},
			startFilter: () => {
				return self.canStartNextJob(directory);
			},
			retryFilter: (error) => {
				operationAttempts++;
				return (operationAttempts < self.config.maxAttempts && error !== 'cwd_failed');
			},
			timeout: self.config.timeout
		});
	}

	cwd(requestedDir) {
		const self = this;

		return new Promise((resolve, reject) => {
			if(self._currentDir === requestedDir)
				resolve(requestedDir);
			else {
				if(typeof self._requestedDir === 'string' && self._requestedDir !== requestedDir)
					reject(self._requestedDir);
				else {
					self.once('cwd', (currentDir) => {
						if(requestedDir === currentDir)
							resolve(requestedDir);
						else
							reject('cwd_failed');
					});

					if(typeof self._requestedDir !== 'string') {
						self._requestedDir = requestedDir;

						self._ftpConn.cwd(requestedDir, (error, currentDir) => {
							delete self._requestedDir;

							if(error) {
								self._currentDir = null;
								self.emit('error', error);
							}
							else
								self._currentDir = currentDir;

							self.emit('cwd', self._currentDir);
						});
					}
				}
			}
		});
	}

	_get(file) {
		const self = this;

		return new Promise((resolve, reject) => {
			self._ftpConn.get(file, function (error, stream) {
				if (error)
					reject(error);
				else if (stream) {
					let storyXml = '';

					stream.setEncoding('utf8');

					stream.on('error', function () {
						reject('stream_error');
					});

					stream.on('data', function (chunk) {
						storyXml += chunk;
					});

					stream.once('close', function () {
						resolve(storyXml);
					});
				}
				else
					reject('no_stream');
			});
		});
	}

	static listItemIsQueue(listItem) {
		return listItem.indexOf('d---------') === 0;
	}

	static listItemIsFile(listItem) {
		return InewsClient.filenameFromListItem(listItem) !== undefined;
	}

	static fileFromListItem(listItem) {
		let file = null;
		if(InewsClient.listItemIsFile(listItem)) {
			let fileName = InewsClient.filenameFromListItem(listItem);
			if(fileName !== undefined)
				file = {filetype: 'file', file: fileName};
			else
				file = {};

			file.identifier = InewsClient.storyIdentifierFromFilename(fileName);
			file.locator = InewsClient.storyLocatorFromFilename(fileName);
			file.storyName = InewsClient.storyNameFromListItem(listItem);
		}
		else if(InewsClient.listItemIsQueue(listItem)) {
			let fileName = InewsClient.queueFromListItem(listItem);
			if(fileName !== undefined)
				file = {filetype: 'queue', file: fileName};
		}

		if(file !== null) {
			let fileDate = InewsClient.dateFromListItem(listItem);
			if(typeof fileDate !== 'undefined')
				file.modified = fileDate;

			file.flags = InewsClient.flagsFromListItem(listItem);

			return file;
		}
		else
			return undefined;
	};

	/**
	 * Get the story ID from the fileName (in XXXXXX:YYYYYY:ZZZZZZ, it will return XXXXXX)
	 * http://resources.avid.com/SupportFiles/attach/Broadcast/inews-ftp-server.pdf
	 * @param fileName
	 * @returns {*}
	 * @private
	 */
	static storyIdentifierFromFilename(fileName) {
		let fileParts = fileName.split(':');
		return fileParts[0];
	}

	/**
	 * Get the story locator from the fileName (in XXXXXX:YYYYYY:ZZZZZZ, it will return YYYYYY:ZZZZZZ)
	 * http://resources.avid.com/SupportFiles/attach/Broadcast/inews-ftp-server.pdf
	 * @param fileName
	 * @returns {*}
	 * @private
	 */
	static storyLocatorFromFilename(fileName) {
		let fileParts = fileName.split(':');
		return fileParts[1] + ':' + fileParts[2];
	};

	static flagsFromListItem(listItem) {
		let flags = {};
		const pattern = /([^\s]+)/i;
		const flagParts = listItem.match(pattern);

		flags.floated = (flagParts[0][1] === 'f');

		return flags;
	}

	static dateFromListItem(listItem) {
		const pattern = / ([A-Za-z]{3,4})[ ]+([0-9]{1,2})[ ]+([0-9]{4}|([0-9]{1,2}):([0-9]{2}))/i;
		const dateParts = listItem.match(pattern);

		try {
			if(typeof dateParts[4] !== 'undefined') {
				let dateNow = new Date();
				let dateModified = new Date(dateParts[1] + " " + dateParts[2] + " " + dateNow.getFullYear() + " " + dateParts[3]);
				if(dateModified.getMonth() > dateNow.getMonth()) // change to last year if the date would fall in the future
					dateModified.setFullYear(dateNow.getFullYear() - 1);
				return dateModified;
			}
			else
				return new Date(dateParts[0]);
		}
		catch(error) {
			return undefined;
		}
	};

	static queueFromListItem(listItem) {
		const pattern = /.([A-Za-z0-9\-]*)$/;
		const matchParts = listItem.match(pattern);
		return matchParts === null ? undefined : matchParts[1];
	};

	static filenameFromListItem(listItem) {
		const pattern = /[A-Z0-9]{8}:[A-Z0-9]{8}:[A-Z0-9]{8}/i;
		const matchParts = listItem.match(pattern);
		return matchParts === null ? undefined : matchParts[0];
	}

	static storyNameFromListItem(listItem) {
		const pattern = /(?:[0-9A-F]{8}:?){3} (.+?)$/;
		const listItemParts = listItem.match(pattern);
		return Array.isArray(listItemParts) && listItemParts.length > 1 ? listItemParts[1] : '';
	}
}

export default InewsClient;
