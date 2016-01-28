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
		callback();
	else {
		this._ftpConn.on('ready', callback);
		this._ftpConn.connect(this.config);
	}
};

InewsClient.prototype.list = function(callback) {
	var self = this;
	var ftpConn = this._ftpConn;
	this.connect(function() {
		ftpConn.list(function(error, list) {
			if(error)
				callback(error, null);
			else {
				var fileNames = [];

				list.forEach(function(listItem) {
					if(self._listItemIsFile(listItem)) {
						var file = self._filenameFromListItem(listItem);
						if(typeof file !== 'undefined')
							fileNames.push({type: 'file', file: file});
					}
					else if(self._listItemIsQueue(listItem)) {
						var file = self._queueFromListItem(listItem);
						if (typeof file !== 'undefined')
							fileNames.push({type: 'queue', file: file});
					}
				});
				callback(null, fileNames);
			}
		});
	});
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

InewsClient.prototype._parseNsml = function(nsml, callback) {
	parseNsml(nsml, callback);
};

InewsClient.prototype.getStory = function(file, callback) {
	var self = this;
	this.get(file, function(error, storyXml) {
		if(error)
			callback(error, null);
		else
			self._parseNsml(storyXml, callback);
	});
};

InewsClient.prototype.get = function(file, callback) {
	var ftpConn = this._ftpConn;
	this.connect(function() {
		ftpConn.get(file, function(error, stream) {
			if(error)
				callback(error, null);
			else {
				var storyXml = "";
				stream.setEncoding('utf8');
				stream.on('data', function(chunk) {
					storyXml += chunk;
				});
				stream.once('close', function() {
					callback(null, storyXml);
				});
			}
		});
	});
};

InewsClient.prototype.cwd = function(path, callback) {
	var ftpConn = this._ftpConn;
	this.connect(function() {
		ftpConn.cwd(path, callback);
	});
};
