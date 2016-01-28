# node-inews #
Connects to an Avid iNews server and allows operations over FTP

## Examples ##

	var Inews = require('inews');

### Connect ###
Will not connect unless a function that requires the connection (eg: cwd, list) is called

	var conn = Inews({
		'host': "inews-hostname",
		'user': "inews-username",
		'password': "inews-password"
	});

### Change Directory ###

	conn.cwd("PATH.TO.INEWS.CUE", function(error, directory) {

	});

### Get and parse a story into parts ###

	 conn.getStory('FILENAME:FILENAME:FILENAME', function(error, story) {
	 
	 });
	 
### Get a story's raw NSML ###

	 conn.get('FILENAME:FILENAME:FILENAME', function(error, story) {
	 
	 });
