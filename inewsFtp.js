var EventEmitter = require('wolfy87-eventemitter');
var FtpClient = require('ftp');
var parseNsml = require('./inewsStoryParser');
var IndexedLinkedList = require('./IndexedLinkedList');

function InewsClient(config) {
	var self = this;
	var configDefault = {
		timeout: 60000 // 1 minute
	};

	self.config = self._objectMerge(configDefault, config);
	self._ftpConn = new FtpClient();
	self._queue = this._callbackQueue();

	var events = ['ready', 'error', 'close', 'end'];

	events.forEach(function(event) {
		self._ftpConn.on(event, function() {
			self.emit.apply(self, [event].concat(Array.prototype.slice.call(arguments)));
		});
	});
}

InewsClient.prototype.__proto__ = EventEmitter.prototype;

InewsClient.prototype.connect = function(callback) {
	var self = this;
	if(self._ftpConn.connected)
		callbackSafe(null, self._ftpConn);
	else {
		var returned = false;
		self._ftpConn.once('ready', function() {
			if(!returned)
				callbackSafe(null, self._ftpConn);
			returned = true;
		});

		self._ftpConn.once('error', function(error) {
			if(!returned)
				callbackSafe(error, self._ftpConn);
			returned = true;
		});

		self._ftpConn.connect(self.config);
	}

	function callbackSafe(error, response) {
		if(typeof callback == 'function')
			callback(error, response);
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

// Reconnect
InewsClient.prototype.reconnect = function(callback) {
	var self = this;
	self.disconnect(function() {
		self.connect(callbackSafe);
	});

	function callbackSafe(error, success) {
		if(typeof callback == 'function')
			callback(error, success);
	}
};

InewsClient.prototype.list = function(directory, callback) {
	var self = this;
	self._queue.add(function(next) {
		self._cwd(directory, function(error, success) {
			if(error)
				callbackSafe(error, null);
			else {
				self.connect(function(error, ftpConn) {
					ftpConn.list(function (error, list) {
						if (error)
							callbackSafe(error, null);
						else {
							var fileNames = [];
							list.forEach(function (listItem) {
								var file = self._fileFromListItem(listItem);
								if (typeof file !== 'undefined')
									fileNames.push(file);
							});
							callbackSafe(null, fileNames);
						}
					});
				})
			}
		});

		function callbackSafe(error, result) {
			if(typeof callback === 'function')
				callback(error, result);
			next();
		}
	});
};

InewsClient.prototype.story = function(directory, file, callback) {
	this.storyNsml(directory, file, function(error, storyNsml) {
		if(error)
			callback(error, storyNsml);
		else
			parseNsml(storyNsml, callback);
	});
};

InewsClient.prototype.storyNsml = function(directory, file, callback) {
	var self = this;
	this._queue.add(function(next) {
		self._cwd(directory, function(error, success) {
			if(error)
				callbackNext(error, null);
			else
				self._get(file, callbackNext);
		});

		function callbackNext(error, result) {
			if(typeof callback === 'function')
				callback(error, result);
			next();
		}
	});
};

InewsClient.prototype.queueLength = function() {
	return this._queue.length();
};

InewsClient.prototype._cwd = function(requestPath, callback) {
	var self = this;
	self.connect(function(error, ftpConn) {
		if(error)
			callback(error, null);
		else if(self._currentDir === requestPath) // already in this directory
			callback(null, requestPath);
		else {
			ftpConn.cwd(requestPath, function(error, cwdPath) {
				if(!error)
					self._currentDir = cwdPath;
				callback(error, cwdPath);
			});
		}
	});
};

InewsClient.prototype._get = function(file, callback) {
	var self = this;
	self.connect(function(error, ftpConn) {
		if(error)
			callback(error, null);
		else {
			ftpConn.get(file, function(error, stream) {
				if (error)
					callback(error, null);
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
						callback(null, storyXml);
					});
				}
				else
					callback("no_stream", null);
			});
		}
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
			var file = {type: 'file', file: fileName};

		file['identifier'] = this._storyIdentifierFromFilename(fileName);
		file['locator'] = this._storyLocatorFromFilename(fileName);
	}
	else if(this._listItemIsQueue(listItem)) {
		var fileName = this._queueFromListItem(listItem);
		if(typeof fileName !== 'undefined')
			var file = {type: 'queue', file: fileName};
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

InewsClient.prototype._callbackQueue = function() {
	var self = this;
	var callbackQueue = IndexedLinkedList();
	var functionTimeout = null;
	return {
		add: function(functionCallback, functionArguments) {
			var functionIndex = uniqueId();
			callbackQueue.enqueue(functionIndex, {functionCallback: functionCallback, functionArguments: functionArguments, functionComplete: function() {
				if(callbackQueue.remove(functionIndex))
					queueStartNext();
			}});
			queueNextSafe();
			return functionIndex;
		},
		remove: function(functionIndex) {
			return callbackQueue.remove(functionIndex);
		},
		length: function() {
			return callbackQueue.length;
		}
	};

	function queueNextSafe() {
		if(callbackQueue.length && functionTimeout === null)
			queueStartNext();
	}

	function queueStartNext() {
		clearTimeout(functionTimeout);
		functionTimeout = null;
		if(callbackQueue.length) {
			var nextCallback = callbackQueue.head.data; // TODO add head()/peek() function
			if(typeof nextCallback.functionCallback === 'function') {

				functionTimeout = setTimeout(function() {
					console.log("TIMED OUT");
					self.reconnect(function(error, success) {
						if(error)
							console.log("RECONNECT ERROR");
						else
							queueStartNext(); // Restart current function
					});
				}, self.config.timeout);

				var funcArgs = (Array.isArray(nextCallback.functionArguments)) ? nextCallback.functionCallback : [];
				funcArgs.push(nextCallback.functionComplete);
				nextCallback.functionCallback.apply(this, funcArgs);
			}
		}
	}

	function uniqueId() {
		function s4() {
			return Math.floor((1 + Math.random()) * 0x10000)
				.toString(16)
				.substring(1);
		}
		return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
			s4() + '-' + s4() + s4() + s4();
	}
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