import EventEmitter from "events";
import Promise from "bluebird";
import FtpClient from "ftp";
import JobsQueue from "./JobsQueue.js";
import parseNsml from "./inewsStoryParser.js";
import NestedMap from "./NestedMap.js";

Promise.config({
	cancellation: true
});

class InewsConnectionClient extends EventEmitter {
	constructor(config) {
		super();

		this._pendingPromises = new NestedMap();

		// Set config
		this.config = Object.assign({
			timeout: 60000, // 1 minute
			reconnectTimeout: 5000, // 5 seconds
			maxRunning: 10,
			maxAttempts: 5,
			maxReconnectAttempts: null,
			debug: false,
			rootDir: ''
		}, config);

		// Set status
		this.status = 'disconnected';

		if(!Array.isArray(this.config.hosts) && typeof this.config.host === 'string')
			this.config.hosts = [this.config.host];

		if(!Array.isArray(this.config.hosts) || this.config.hosts.length === 0)
			throw new Error(`Missing hosts option`);
		if(!this.config.hasOwnProperty('user'))
			throw new Error(`Missing user option`);
		if(!this.config.hasOwnProperty('password'))
			throw new Error(`Missing password option`);

		// Map FTP events to status updates
		this._ftpConn = new FtpClient();

		const mappedFtpEvents = new Map([
			['ready', 'connected'],
			['error', 'error'],
			['close', 'disconnected'],
			['end', 'disconnected']
		]);

		mappedFtpEvents.forEach((clientStatus, ftpEventName) => {
			this._ftpConn.on(ftpEventName, () => {
				this.status = clientStatus; // Emit status
				this.emit.apply(this, [ftpEventName].concat(Array.prototype.slice.call(arguments))); // Re-emit event
			});
		});

		// Remove current directory on disconnect
		this.on('disconnected', () => {
			this._currentDir = null;
		});

		this._jobsQueue = new JobsQueue();

		this._jobsQueue.on('queued', (queuedJobs) => {
			this.emit('queued', queuedJobs);
		});

		this._jobsQueue.on('running', (runningJobs) => {
			this.emit('running', runningJobs);
		});

		this._jobsQueue.on('requests', (totalJobs) => {
			this.emit('requests', totalJobs);
		});

		this._jobsQueue.on('error', (error) => {
			this.emit('error', error);
		});

		this.on('error', error => {
			this._debug(error);
		})

	}

	get lastDirectory() {
		return this._lastDirectory;
	}

	get connected() {
		return (this._ftpConn !== null && this._ftpConn.connected);
	}

	get queued() {
		return this._jobsQueue.queued.size;
	}

	get running() {
		return this._jobsQueue.running.size;
	}

	get requests() {
		return (this.queued + this.running);
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

	get host() {
		return (this.hasOwnProperty('_ftpConnConfig') && typeof this._ftpConnConfig === 'object') ? this._ftpConnConfig.host : undefined;
	}

	connect(forceDisconnect = false) {
		const delay = (ms) => {
			return new Promise((resolve) => {
				setTimeout(() => {
					resolve();
				}, ms);
			});
		}

		const connectFtp = (ftpConnConfig) => {
			this.status = 'connecting';

			return new Promise((resolve, reject) => {
				let returned = false;

				const onReady = () => {
					if(!returned) {
						returned = true;
						this._currentDir = null;
						removeListeners();
						resolve(this._ftpConn);
					}
				}

				const onError = (error) => {
					if(!returned) {
						returned = true;
						removeListeners();
						reject(error);
					}
				}

				const removeListeners = () => {
					this._ftpConn.removeListener('ready', onReady);
					this._ftpConn.removeListener('error', onError);
				}

				this._ftpConn.once('ready', onReady);
				this._ftpConn.once('error', onError);
				this._ftpConn.connect(ftpConnConfig);
			});
		}

		return new Promise(async (resolve, reject) => {
			if(this.status === 'connected' && !forceDisconnect)
				resolve(this._ftpConn);
			else if(typeof this._connectionInProgress === 'undefined' || !this._connectionInProgress) { // change to status
				this._connectionInProgress = true;
				this._currentDir = null;

				// Retry as many times as allowed (may be infinite)
				for(let reconnectsAttempted = 0; (typeof this.config.maxReconnectAttempts !== 'number' || this.config.maxReconnectAttempts < 0 || reconnectsAttempted < this.config.maxReconnectAttempts); reconnectsAttempted++) {
					if(forceDisconnect || reconnectsAttempted > 0)
						await this.disconnect();

					this._ftpConnConfig = {
						host: this.config.hosts[reconnectsAttempted % this.config.hosts.length], // cycle through server
						user: this.config.user,
						password: this.config.password
					};

					this._debug('Connecting to', this._ftpConnConfig.host);

					if(reconnectsAttempted > 0 && typeof this.config.reconnectTimeout === 'number' && this.config.reconnectTimeout > 0)
						await delay(this.config.reconnectTimeout);

					try {
						await connectFtp(this._ftpConnConfig);
						this._debug('Connected to', this._ftpConnConfig.host);
						delete this._connectionInProgress;
						resolve(this._ftpConn);
						return;
					}
					catch(error) {
						this.emit('error', error);
					}
				}

				this.emit('error', 'max_reconnect_attempts');
				reject('max_reconnect_attempts');
			}
		});


	}

	disconnect() {
		return new Promise((resolve, reject) => {
			if(this._ftpConn.connected) {
				this.once('end', () => {
					resolve();
				});
				this._ftpConn.end();
			}
			else
				resolve();
		});
	}

	async destroy() {
		await this.disconnect();
		await this._jobsQueue.destroy();
		this.removeAllListeners(); // remove all listeners (garbage collection)
	}

	story(directory, file) {
		return this.storyNsml(directory, file).then(storyNsml => {
			return parseNsml(storyNsml);
		});
	}

	storyNsml(directory, file) {
		const promisePath = ['storyNsml', directory, file];

		if(this._pendingPromises.has(promisePath))
			return this._pendingPromises.get(promisePath);
		else {
			this._lastDirectory = directory;
			let operationAttempts = 0;
			const jobPromise = this._jobsQueue.enqueue({
				start: () => {
					return this.connect()
						.then(() => this._cwd(directory))
						.then(() => this._get(file));
				},
				startFilter: () => {
					return this.canStartNextJob(directory);
				},
				retryFilter: (error) => {
					operationAttempts++;
					return (operationAttempts < this.config.maxAttempts && error.message !== 'cwd_failed' && !error.message.includes('no such story') && !error.message.includes('invalid story identifier'));
				},
				timeout: this.config.timeout
			}).finally(() => {
				this._pendingPromises.delete(promisePath);
			});

			this._pendingPromises.set(promisePath, jobPromise);
			return jobPromise;
		}
	}

	list(directory) {
		const promisePath = ['list', directory];

		const delay = (ms) => {
			return new Promise((resolve) => {
				setTimeout(() => {
					resolve();
				}, ms);
			});
		}

		const connectFtp = (ftpConnConfig) => {
			this.status = 'connecting';

			return new Promise((resolve, reject) => {
				let returned = false;

				const onReady = () => {
					if(!returned) {
						returned = true;
						this._currentDir = null;
						removeListeners();
						resolve(this._ftpConn);
					}
				}

				const onError = (error) => {
					if(!returned) {
						returned = true;
						removeListeners();
						reject(error);
					}
				}

				const removeListeners = () => {
					this._ftpConn.removeListener('ready', onReady);
					this._ftpConn.removeListener('error', onError);
				}

				this._ftpConn.once('ready', onReady);
				this._ftpConn.once('error', onError);
				this._ftpConn.connect(ftpConnConfig);
			});
		}

		if(this._pendingPromises.has(promisePath))
			return this._pendingPromises.get(promisePath);
		else {
			this._lastDirectory = directory;
			let operationAttempts = 0;
			const jobPromise = this._jobsQueue.enqueue({
				start: () => {
					return this.connect()
						.then(() => this._cwd(directory))
						.then(() => new Promise((resolve, reject) => {
							this._ftpConn.list((error, list) => {
								if (error)
									reject(error);
								else {
									let fileNames = [];
									if (Array.isArray(list)) {
										list.forEach((listItem) => {
											let file = InewsConnectionClient.fileFromListItem(listItem);
											if (typeof file !== 'undefined')
												fileNames.push(file);
										});
									}
									resolve(fileNames);
								}
							});
						}));

				},
				startFilter: () => {
					return this.canStartNextJob(directory);
				},
				retryFilter: (error) => {
					operationAttempts++;
					return (operationAttempts < this.config.maxAttempts && !error.message.includes('No such directory'));
				},
				timeout: this.config.timeout
			}).finally(() => {
				this._pendingPromises.delete(promisePath);
			});

			this._pendingPromises.set(promisePath, jobPromise);
			return jobPromise;
		}
	}

	canStartNextJob(directory) {
		// In directory already, directory is requested, or not started
		return (this.running === 0 || (((this._currentDir === directory && typeof this._requestedDir !== 'string') || this._requestedDir === directory || (typeof this._currentDir !== 'string' && typeof this._requestedDir !== 'string')) && this.status === 'connected' && this.running < this.config.maxRunning));
	}

	_cwd(requestedDir) {
		if(requestedDir === this._currentDir) { // Already in dir
			return new Promise((resolve, reject) => {
				resolve(this._currentDir);
			})
		}
		else if(requestedDir === this._requestedDir) // CWD to same directory in progress
			return this._cwdPromise;
		else if(this._requestedDir !== undefined) { // CWD in progress to different directory
			return new Promise((resolve, reject) => {
				reject('cwd_in_progress');
			});
		}
		else { // change directory
			this._requestedDir = requestedDir;
			this._cwdPromise = new Promise((resolve, reject) => {
				this._ftpConn.cwd(requestedDir, (error, currentDir) => {
					delete this._requestedDir;

					if(error) {
						this._currentDir = null;
						this.emit('error', error);
						reject(error);
					}
					else {
						this._currentDir = currentDir;
						resolve(currentDir);
					}

					this.emit('cwd', this._currentDir);
				});
			});
			return this._cwdPromise;
		}
	}

	_get(file) {
		return new Promise((resolve, reject, onCancel) => {

			this._ftpConn.get(file, (error, stream) => {
				this.emit('stream');
				onCancel(() => {
					try {
						stream.destroy();
					}
					catch(error) {
						this.emit('error', error);
					}
				});

				if (error)
					reject(error);
				else if (stream) {
					let storyXml = '';

					stream.setEncoding('utf8');

					stream.on('error', () => {
						reject('stream_error');
					});

					stream.on('data', (chunk) => {
						storyXml += chunk;
					});

					stream.once('close', () => {
						resolve(storyXml);
					});
				}
				else
					reject('no_stream');
			});
		});
	}

	_debug() {
		if(this.config.debug)
			console.log.apply(console, [(new Date()).toISOString()].concat(Array.prototype.slice.call(arguments)));
	}

	static listItemIsQueue(listItem) {
		return listItem.indexOf('d---------') === 0;
	}

	static listItemIsFile(listItem) {
		return InewsConnectionClient.filenameFromListItem(listItem) !== undefined;
	}

	static fileFromListItem(listItem) {
		let file = null;
		if(InewsConnectionClient.listItemIsFile(listItem)) {
			let fileName = InewsConnectionClient.filenameFromListItem(listItem);
			if(fileName !== undefined)
				file = {fileType: InewsConnectionClient.FILETYPES.STORY, fileName: fileName};
			else
				file = {};

			file.identifier = InewsConnectionClient.storyIdentifierFromFilename(fileName);
			file.locator = InewsConnectionClient.storyLocatorFromFilename(fileName);
			file.storyName = InewsConnectionClient.storyNameFromListItem(listItem);
		}
		else if(InewsConnectionClient.listItemIsQueue(listItem)) {
			let fileName = InewsConnectionClient.queueFromListItem(listItem);
			if(fileName !== undefined)
				file = {fileType: InewsConnectionClient.FILETYPES.DIRECTORY, fileName: fileName};
		}

		if(file !== null) {
			let fileDate = InewsConnectionClient.dateFromListItem(listItem);
			if(typeof fileDate !== 'undefined')
				file.modified = fileDate;

			file.flags = InewsConnectionClient.flagsFromListItem(listItem);

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
		return fileParts[0].toUpperCase();
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
		return `${fileParts[1]}:${fileParts[2]}`.toUpperCase();
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
		return Array.isArray(listItemParts) && listItemParts.length > 1 ? listItemParts[1] : null;
	}

	static get FILETYPES() {
		return Object.freeze({
			STORY: 'STORY',
			DIRECTORY: 'DIRECTORY'
		});
	}
}

export default InewsConnectionClient;
