module.exports = function(config) {
	return new InewsClient(config);
};

var FtpClient = require('ftp');
var parseNsml = require('./inewsStoryParser');

function InewsClient(config) {
	this.config = config;
	this._ftpConn = new FtpClient();
}

InewsClient.prototype.connect = function(callback) {
	if(this._ftpConn.connected)
		callback(null, this._ftpConn);
	else {
		this._ftpConn.on('ready', function() {
			callback(null, this);
		});

		this._ftpConn.on('error', function(error) {
			callback(error, this);
		});

		this._ftpConn.connect(this.config);
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
		return file;
	}
	else
		return undefined;
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
	var pattern = /.([A-Za-z0-9]*)$/;
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