var EventEmitter = require('wolfy87-eventemitter');
var FtpClient = require('ftp');
var JobsQueue = require('jobs-queue');
var parseNsml = require('./inewsStoryParser');

function InewsClient(config) {
	var self = this;
	var configDefault = {
		timeout: 60000, // 1 minute
		reconnectTimeout: 5000, // 5 seconds
		maxOperations: 5,
		maxOperationAttempts: 5
	};

	self.config = self._objectMerge(configDefault, config);

	if(!Array.isArray(self.config.hosts) && typeof self.config.host === 'string')
		self.config.hosts = [self.config.host];

	self._queue = JobsQueue();
	self._lastDirectory = null;
	self._connectionCallbacks = [];
	self._connectionInProgress = false;

	self._ftpConn = new FtpClient();

	// Capture FTP connection events
	self.status = 'disconnected';
	self._objectForEach({ready: 'connected', error: 'error', close: 'disconnected', end: 'disconnected'}, function(eventStatus, eventName) {
		// Re-emit event
		self._ftpConn.on(eventName, function() {
			self._setStatus(eventStatus); // Emit status
			self.emit.apply(self, [eventName].concat(Array.prototype.slice.call(arguments))); // Re-emit event
		});
	});

	// Remove current directory on disconnect
	self.on('disconnected', function() {
		self._currentDir = null;
	});
}

InewsClient.prototype.__proto__ = EventEmitter.prototype;

InewsClient.prototype.connect = function(callback, forceDisconnect) {
	var self = this;

	if(typeof callback === 'function')
		self._connectionCallbacks.push(callback);

	forceDisconnect = (typeof forceDisconnect === 'boolean') ? forceDisconnect : false;

	if(self._ftpConn !== null && self._ftpConn.connected && !forceDisconnect)
		callbackSafe(null, self._ftpConn);
	else if(!self._connectionInProgress){
		self._connectionInProgress = true;
		self._currentDir = null;
		var reconnectAttempts = 0;

		attemptReconnect();

		function attemptReconnect() {
			if(forceDisconnect || reconnectAttempts > 0) {
				self.disconnect(function() {
					connect(connectResult);
				});
			}
			else
				connect(connectResult);
		}

		function connect(connectResult) {
			self._setStatus('connecting');

			var returned = false;

			function onReady() {
				if(!returned) {
					returned = true;
					self._currentDir = null;
					removeListeners();
					connectResult(null, self._ftpConn);
				}
			}

			function onError(error) {
				if(!returned) {
					returned = true;
					removeListeners();
					connectResult(error, self._ftpConn);
				}
			}

			function removeListeners() {
				self._ftpConn.removeListener('ready', onReady);
				self._ftpConn.removeListener('error', onError);
			}

			var ftpConnConfig = {
				host: self.config.hosts[reconnectAttempts % self.config.hosts.length], // cycle through server
				user: self.config.user,
				password: self.config.password
			};

			self._ftpConn.once('ready', onReady);
			self._ftpConn.once('error', onError);
			self._ftpConn.connect(ftpConnConfig);
		}

		function connectResult(error, ftpConn) {
			reconnectAttempts++;

			if(error && (typeof self.config.reconnectAttempts !== 'number' || self.config.reconnectAttempts < 0 || reconnectAttempts < self.config.reconnectAttempts)) {
				if(typeof self.config.reconnectTimeout != 'number' || self.config.reconnectTimeout <= 0)
					attemptReconnect();
				else
					setTimeout(attemptReconnect, self.config.reconnectTimeout);
			}
			else
				callbackSafe(error, ftpConn);
		}
	}

	function callbackSafe(error, response) {
		self._connectionInProgress = false;
		while(self._connectionCallbacks.length) {
			var connectionCallback = self._connectionCallbacks.shift();
			if(typeof connectionCallback == 'function')
				connectionCallback(error, response);
		}
	}
};

InewsClient.prototype.disconnect = function(callback) {
	var self = this;
	if(self._ftpConn.connected) {
		self.once('end', function() {
			callbackSafe(null, true);
		});
		self._ftpConn.end();
	}
	else
		callback(null, true);

	function callbackSafe(error, success) {
		if(typeof callback == 'function')
			callback(error, success);
	}
};

InewsClient.prototype.list = function(directory, callback) {
	var self = this;

	var maxOperations = (self._lastDirectory == directory) ? self.config.maxOperations : 1;
	self._lastDirectory = directory;

	// Return job controller
	return self._connectedEnqueue(function(jobComplete) {
		self.connect(function(error, ftpConnection) {
			if(error)
				jobComplete(error, null);
			else {
				self._cwd(directory, function(error, success) {
					if(error)
						jobComplete(error, null);
					else {
						self._ftpConn.list(function(error, list) {
							if (error)
								jobComplete(error, null);
							else {
								var fileNames = [];
								if(Array.isArray(list)) {
									list.forEach(function (listItem) {
										var file = self._fileFromListItem(listItem);
										if (typeof file !== 'undefined')
											fileNames.push(file);
									});
								}
								jobComplete(null, fileNames);
							}
						});
					}
				});
			}
		});

	}, {maxSimultaneous: maxOperations}, callbackSafe);

	function callbackSafe(error, result) {
		if(typeof callback === 'function')
			callback(error, result);
	}
};

InewsClient.prototype.story = function(directory, file, callback) {
	// Return job controller
	return this.storyNsml(directory, file, function(error, storyNsml) {
		if(error)
			callback(error, storyNsml);
		else
			parseNsml(storyNsml, callback);
	});
};

InewsClient.prototype._connectedEnqueue = function(operation, options, callback) {

	// Calculate max operations

	var jobController = this.enqueue(operation, this.config.maxOperationAttempts, this.config.timeout, function(error, operationContinue) {
		// On failure
		// If disconnected, wait for ready, then restart
		operationContinue();

	}, function(error, result) {
		callback(error, result);

	}, options);

	return jobController;
};

InewsClient.prototype.storyNsml = function(directory, file, callback) {
	var self = this;

	var maxOperations = (self._lastDirectory == directory) ? self.config.maxOperations : 1;
	self._lastDirectory = directory;

	// Return job controller
	return self._connectedEnqueue(function(jobComplete) {
		self.connect(function(error, ftpConnection) {
			if(error)
				jobComplete(error, null);
			else {
				self._cwd(directory, function(error, success) {
					if(error)
						jobComplete(error, null);
					else
						self._get(file, jobComplete);
				});
			}
		});

	}, {maxSimultaneous: maxOperations}, callbackSafe);

	function callbackSafe(error, result) {
		if(typeof callback === 'function')
			callback(error, result);
	}
};

InewsClient.prototype.queueLength = function() {
	return this._queue.queued;
};

InewsClient.prototype._setStatus = function(status) {
	if(this.status !== status) {
		this.status = status;
		this.emit('status', this.status);
	}
};

InewsClient.prototype._cwd = function(requestPath, cwdComplete) {
	var self = this;
	if(self._currentDir === requestPath) // already in this directory
		cwdComplete(null, requestPath);
	else {
		self._ftpConn.cwd(requestPath, function(error, cwdPath) {
			if(!error)
				self._currentDir = cwdPath;
			cwdComplete(error, cwdPath);
		});
	}
};

InewsClient.prototype._get = function(file, getComplete) {
	var self = this;

	self._ftpConn.get(file, function(error, stream) {
		if (error)
			getComplete(error, null);
		else if(stream) {
			var storyXml = "";

			stream.setEncoding('utf8');

			stream.on('error', function() {
				console.log("STREAM-ERROR 2")
			});

			stream.on('data', function (chunk) {
				storyXml += chunk;
			});
			stream.once('close', function () {
				getComplete(null, storyXml);
			});
		}
		else
			getComplete("no_stream", null);
	});
};

InewsClient.prototype._listItemIsQueue = function(listItem) {
	return listItem.indexOf('d---------') === 0;
};

InewsClient.prototype._listItemIsFile = function(listItem) {
	return this._filenameFromListItem(listItem) !== undefined;
};

InewsClient.prototype._fileFromListItem = function(listItem) {
	if(this._listItemIsFile(listItem)) {
		var fileName = this._filenameFromListItem(listItem);
		if(typeof fileName !== 'undefined')
			var file = {filetype: 'file', file: fileName};

		file['identifier'] = this._storyIdentifierFromFilename(fileName);
		file['locator'] = this._storyLocatorFromFilename(fileName);
		file['storyName'] = this._storyNameFromListItem(listItem);
	}
	else if(this._listItemIsQueue(listItem)) {
		var fileName = this._queueFromListItem(listItem);
		if(typeof fileName !== 'undefined')
			var file = {filetype: 'queue', file: fileName};
	}

	if(typeof file !== 'undefined') {
		var fileDate = this._dateFromListItem(listItem);
		if(typeof fileDate !== 'undefined')
			file['modified'] = fileDate;

		file['flags'] = this._flagsFromListItem(listItem);

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
InewsClient.prototype._storyIdentifierFromFilename = function(fileName) {
	var fileParts = fileName.split(':');
	return fileParts[0];
};

/**
 * Get the story locator from the fileName (in XXXXXX:YYYYYY:ZZZZZZ, it will return YYYYYY:ZZZZZZ)
 * http://resources.avid.com/SupportFiles/attach/Broadcast/inews-ftp-server.pdf
 * @param fileName
 * @returns {*}
 * @private
 */
InewsClient.prototype._storyLocatorFromFilename = function(fileName) {
	var fileParts = fileName.split(':');
	return fileParts[1] + ':' + fileParts[2];
};
InewsClient.prototype._storyNameFromListItem = function(listItem) {
	var pattern = /[0-9A-F]{8}:[0-9A-F]{8}:[0-9A-F]{8} (.+?)$/;
	var listItemParts = listItem.match(pattern);
	return Array.isArray(listItemParts) && listItemParts.length > 1 ? listItemParts[1] : '';
}

InewsClient.prototype._flagsFromListItem = function(listItem) {
	var flags = {};
	var pattern = /([^\s]+)/i;
	var flagParts = listItem.match(pattern);

	flags.floated = (flagParts[0][1] == 'f');

	return flags;
};

InewsClient.prototype._dateFromListItem = function(listItem) {
	var pattern = / ([A-Za-z]{3,4})[ ]+([0-9]{1,2})[ ]+([0-9]{4}|([0-9]{1,2}):([0-9]{2}))/i;
	var dateParts = listItem.match(pattern);

	try {
		if(typeof dateParts[4] !== 'undefined') {
			var dateNow = new Date();
			var dateModified = new Date(dateParts[1] + " " + dateParts[2] + " " + dateNow.getFullYear() + " " + dateParts[3]);
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

InewsClient.prototype._queueFromListItem = function(listItem) {
	var pattern = /.([A-Za-z0-9\-]*)$/;
	var matchParts = listItem.match(pattern);
	return matchParts === null ? undefined : matchParts[1];
};

InewsClient.prototype._filenameFromListItem = function(listItem) {
	var pattern = /[A-Z0-9]{8}:[A-Z0-9]{8}:[A-Z0-9]{8}/i;
	var matchParts = listItem.match(pattern);
	return matchParts === null ? undefined : matchParts[0];
};

InewsClient.prototype.enqueue = function(operation, maxOperationAttempts, operationTimeout, errorCallback, finalCallback, options) {
	var self = this;
	var operationComplete = false;

	var jobController = self._queue.enqueue(jobOperation, options);

	return {
		cancel: function() {
			operationComplete = true;
			jobController.cancel();
		},
		complete: function() {
			operationComplete = true;
			jobController.complete();
		},
		restart: function() {
			jobController.restart();
		}
	};

	function jobOperation(next) {
		self._attemptOperation(timedOperation, maxOperationAttempts, errorCallback, function(error, result) {
			callbackSafe(error, result);
			next();
		});
	}

	function timedOperation(callback) {
		self._timedOperation(operation, operationTimeout, function(error, result) {
			if(!operationComplete) // Only continue if not canceled
				callback(error, result);
		});
	}

	function callbackSafe(error, result) {
		if(!operationComplete) {
			operationComplete = true;
			if(typeof finalCallback === 'function')
				finalCallback(error, result);
		}
	}
};

InewsClient.prototype._attemptOperation = function(operation, maxAttempts, errorCallback, finalCallback) {
	var currentAttempt = 0;
	attemptOperation();

	function attemptOperation() {
		currentAttempt++;
		var operationAttempt = currentAttempt;
		operation(function (error, result) {
			if(error && (typeof maxAttempts !== 'number' || maxAttempts < 0 || currentAttempt < maxAttempts)) {
				errorCallback(error, function(continueError) {
					if(continueError)
						callbackSafe(operationAttempt, continueError, result);
					else
						attemptOperation();
				});
			}
			else
				callbackSafe(operationAttempt, error, result);
		});
	}

	function callbackSafe(operationAttempt, error, result) {
		if(operationAttempt === currentAttempt) {
			if(typeof finalCallback === 'function')
				finalCallback(error, result);
		}
	}
};

InewsClient.prototype._timedOperation = function(operation, timeout, callback) {
	var self = this;

	var operationTimeout = setTimeout(function() {
		callback('operation_timeout', null);
	}, timeout);

	operation(function() {
		clearTimeout(operationTimeout);
		callback.apply(self, Array.prototype.slice.call(arguments));
	});
};



InewsClient.prototype._objectMerge = function() {
	var merged = {};
	this._objectForEach(arguments, function(argument) {
		for (var attrname in argument) {
			if(argument.hasOwnProperty(attrname))
				merged[attrname] = argument[attrname];
		}
	});
	return merged;
};

InewsClient.prototype._objectForEach = function(object, callback) {
	// run function on each property (child) of object
	var property;
	for(property in object) { // pull keys before looping through?
		if (object.hasOwnProperty(property))
			callback(object[property], property, object);
	}
};

module.exports = function(config) {
	return new InewsClient(config);
};