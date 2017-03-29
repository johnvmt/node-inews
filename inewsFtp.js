var EventEmitter = require('wolfy87-eventemitter');
var FtpClient = require('ftp');
var parseNsml = require('./inewsStoryParser');

function InewsClient(config) {
	var self = this;
	self.config = config;
	self._ftpConn = new FtpClient();

	var events = ['ready', 'error', 'close', 'end'];

	events.forEach(function(event) {
		self._ftpConn.on(event, function() {
			self.emit.apply(self, [event].concat(Array.prototype.slice.call(arguments)));
		});
	});
}

InewsClient.prototype.__proto__ = EventEmitter.prototype;

InewsClient.prototype.disconnect = function(callback) {
	var self = this;
	if(self._ftpConn.connected) {
		if(typeof callback == 'function') {
			self.once('end', function() {
				callback(null, true);
			})	;
		}
		self._ftpConn.end();
	}

};

InewsClient.prototype.connect = function(callback) {
	var self = this;
	if(self._ftpConn.connected)
		callbackSafe(null, self._ftpConn);
	else {
		var returned = false;
		self._ftpConn.once('ready', function() {
			if(!returned)
				callbackSafe(null, self);
			returned = true;
		});

		self._ftpConn.once('error', function(error) {
			if(!returned)
				callbackSafe(error, self);
			returned = true;
		});

		self._ftpConn.connect(self.config);
	}

	function callbackSafe(error, response) {
		if(typeof callback == 'function')
			callback(error, response);
	}
};

InewsClient.prototype.cwd = function(path, callback) {
	this.connect(function(error, ftpConn) {
		if(error)
			callback(error, null);
		else
			ftpConn.cwd(path, callback);
	});
};

InewsClient.prototype.list = function(callback) {
	var self = this;
	self.connect(function(error, ftpConn) {
		if(error)
			callback(error, null);
		else {
			ftpConn.list(function (error, list) {
				if (error)
					callback(error, null);
				else {
					var fileNames = [];
					 list.forEach(function (listItem) {
						var file = self._fileFromListItem(listItem);
						if (typeof file !== 'undefined')
							fileNames.push(file);
					});
					callback(null, fileNames);
				}
			});
		}
	});
};

InewsClient.prototype.get = function(file, callback) {
	this.connect(function(error, ftpConn) {
		if(error)
			callback(error, null);
		else {
			ftpConn.get(file, function(error, stream) {
				if (error)
					callback(error, null);
				else {
					var storyXml = "";
					stream.setEncoding('utf8');
					stream.on('data', function (chunk) {
						storyXml += chunk;
					});
					stream.once('close', function () {
						callback(null, storyXml);
					});
				}
			});
		}
	});
};

InewsClient.prototype.getStory = function(file, callback) {
	var self = this;
	self.get(file, function(error, storyXml) {
		if(error)
			callback(error, null);
		else
			self.parseNsml(storyXml, callback);
	});
};

InewsClient.prototype.parseNsml = function(nsml, callback) {
	parseNsml(nsml, callback);
};

InewsClient.prototype._fileFromListItem = function(listItem) {
	if(this._listItemIsFile(listItem)) {
		var fileName = this._filenameFromListItem(listItem);
		if(typeof fileName !== 'undefined')
			var file = {type: 'file', file: fileName};
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

InewsClient.prototype._listItemIsQueue = function(listItem) {
	return listItem.indexOf('d---------') === 0;
};

InewsClient.prototype._queueFromListItem = function(listItem) {
	var pattern = /.([A-Za-z0-9\-]*)$/;
	var matchParts = listItem.match(pattern);
	return matchParts === null ? undefined : matchParts[1];
};

InewsClient.prototype._listItemIsFile = function(listItem) {
	return this._filenameFromListItem(listItem) !== undefined;
};

InewsClient.prototype._filenameFromListItem = function(listItem) {
	var pattern = /[A-Z0-9]{8}:[A-Z0-9]{8}:[A-Z0-9]{8}/i;
	var matchParts = listItem.match(pattern);
	return matchParts === null ? undefined : matchParts[0];
};

module.exports = function(config) {
	return new InewsClient(config);
};